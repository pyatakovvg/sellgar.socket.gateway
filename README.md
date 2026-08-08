# Sellgar Socket Gateway

Отдельный NestJS-сервис realtime-доставки. Он не содержит бизнес-логику доменных
сервисов: принимает адресованные события из RabbitMQ, сохраняет их в PostgreSQL,
распределяет по экземплярам gateway и доставляет авторизованным Socket.IO-клиентам.

## Структура

Код организован так же, как остальные backend-сервисы Sellgar:

```text
src/
├── api/
│   ├── health/
│   └── v1/
│       └── delivery/
│           ├── controller/   # RabbitMQ ingress и его DTO
│           ├── gateway/      # Socket.IO и RabbitMQ adapters
│           ├── repository/   # PostgreSQL delivery/outbox/cursors
│           ├── service/      # use cases, relay, retention, tickets
│           ├── *.model.ts    # TypeORM models
│           └── delivery.module.ts
├── migrations/
├── app.module.ts
├── data-source.ts
├── env.validation.ts
└── main.ts
```

`delivery` — единый функциональный модуль. Папки внутри него разделяют не
предметную область, а роли файлов: входной transport, adapters, repository и
application services.

## Гарантия доставки

Система даёт **at-least-once delivery в пределах retention**, а не exactly-once.
Повтор допустим при падении между публикацией в RabbitMQ и фиксацией результата
в PostgreSQL. Клиент должен обрабатывать `deliveryId` идемпотентно.

Полный путь события:

1. Доменный сервис в одной бизнес-транзакции изменяет свои данные и создаёт
   запись в своём producer-outbox.
2. Producer-outbox публикует `realtime.delivery.requested.v1` в RabbitMQ.
3. Socket gateway принимает сообщение с manual ACK.
4. В одной транзакции `socket_srv` создаются `delivery_event` и
   `delivery_outbox`. Повторный `eventUuid` безопасно игнорируется.
5. Только после commit gateway отправляет RabbitMQ ACK.
6. Relay выбирает outbox-записи через `FOR UPDATE SKIP LOCKED`, публикует их в
   cluster exchange с publisher confirm и фиксирует `published`.
7. Каждый экземпляр gateway имеет собственную временную очередь cluster fanout
   и отправляет событие только своим локальным соединениям.
8. Клиент подтверждает обработку. Cursor хранится отдельно для каждой пары
   `session_uuid + audience_room`.
9. После reconnect gateway сначала присоединяет socket к rooms, фиксирует
   high-watermark, восстанавливает события из PostgreSQL и затем выпускает
   накопившиеся live-события.

Временная node-queue специально не durable: PostgreSQL является источником
истины для replay, а очередь нужна только для быстрого fanout между живыми
экземплярами.

### Outbox states

- `pending` — ожидает первую публикацию;
- `processing` — захвачен одним relay worker;
- `failed` — будет повторён с exponential backoff;
- `published` — RabbitMQ подтвердил публикацию;
- `dead` — исчерпан лимит попыток, требуется вмешательство.

Зависшая `processing`-запись автоматически возвращается в retry после
`DELIVERY_OUTBOX_PROCESSING_TIMEOUT_MS`. При достижении лимита она становится
`dead`. Более поздние события той же room не обходят такую запись: это сохраняет
порядок, а `GET /health` переходит в `degraded` и показывает счётчики outbox.

На первом этапе dead-записями управляют через защищённый доступ к БД:

```sql
SELECT event_uuid, attempts, last_error, created_at
FROM delivery_outbox
WHERE status = 'dead'
ORDER BY created_at;

UPDATE delivery_outbox
SET status = 'failed',
    attempts = 0,
    next_attempt_at = NOW(),
    processing_started_at = NULL,
    last_error = NULL
WHERE event_uuid = '<event uuid>'
  AND status = 'dead';
```

Публичный HTTP retry endpoint намеренно не добавлен. Когда появится общий
операционный контур, эти операции следует вынести в авторизованный admin API с
audit log.

## RabbitMQ contract

Producer публикует `realtime.delivery.requested.v1` через собственный
transactional outbox:

```json
{
  "eventUuid": "5a943eb6-4d4f-4c11-9962-08cf45e1697e",
  "eventType": "product.import.progressed.v1",
  "schemaVersion": 1,
  "occurredAt": "2026-08-08T12:00:00.000Z",
  "audience": {
    "type": "user",
    "uuid": "3a4752e0-c56d-4d72-8976-28438f680fb8"
  },
  "payload": {
    "progress": 50
  }
}
```

Допустимые audience: `user`, `tenant`, `shop`, `job`. Доменный сервис не знает
socket IDs и не формирует room membership.

## Socket.IO contract

Namespace: `/realtime`, transport: WebSocket.

Клиент передаёт короткоживущий JWT в `handshake.auth.ticket`. Обязательные
claims: user UUID в `sub`, стабильный UUID сессии в `sid`, audience из
`SOCKET_TICKET_AUDIENCE`. Дополнительные rooms подписываются issuer-ом ticket:

```json
{
  "sub": "3a4752e0-c56d-4d72-8976-28438f680fb8",
  "sid": "09edcfbd-b192-4fc9-a703-f5bf84a67386",
  "rooms": ["tenant:cb447bf9-6d67-47da-8d42-a950648668ab"],
  "aud": "realtime",
  "exp": 1786190460
}
```

События протокола:

- server `realtime.event.v1` — delivery envelope;
- client `realtime.ack.v1` — `{ "room": "user:<uuid>", "sequence": "42" }`;
- server `realtime.ready.v1` — replay закончен, live stream готов;
- server `realtime.error.v1` — соединение или replay невозможно продолжить.

ACK кумулятивный в пределах одной room. Gateway не принимает ACK выше реально
отправленного sequence и не принимает ACK для неавторизованной room.

## Локальный запуск

Создайте PostgreSQL database `socket_srv`, заполните `.env`, затем выполните:

```bash
cp .env.example .env
yarn install
yarn migration:run
yarn build
yarn start:dev
```

Health endpoint: `http://localhost:4040/health`.

`SOCKET_INSTANCE_ID` должен быть уникальным для одновременно работающих
экземпляров. В контейнерах можно не задавать его и использовать hostname;
`local-1` предназначен только для одного локального процесса.

## Проверка

```bash
yarn build
yarn test --runInBand
yarn migration:show
```
