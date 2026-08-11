# Sellgar Socket Gateway

Отдельный NestJS-сервис realtime-доставки. Он не содержит бизнес-логику доменных
сервисов: принимает события из RabbitMQ, сохраняет их в PostgreSQL, распределяет
по экземплярам gateway и доставляет авторизованным Socket.IO-клиентам по отдельным
физическим transport-соединениям.

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
2. Producer-outbox публикует доменное событие в RabbitMQ.
3. Владелец клиентской read model преобразует его в `realtime.delivery.requested.v1`.
4. Socket gateway принимает только готовый delivery request с manual ACK.
5. В одной транзакции `socket_srv` создаются `delivery_event` и
   `delivery_outbox`. Повторный `eventUuid` безопасно игнорируется.
6. Только после commit gateway отправляет RabbitMQ ACK.
7. Relay выбирает outbox-записи через `FOR UPDATE SKIP LOCKED`, публикует их в
   cluster exchange с publisher confirm и фиксирует `published`.
8. Каждый экземпляр gateway имеет собственную временную очередь cluster fanout
   и отправляет событие только своим локальным соединениям.
9. Клиент подтверждает обработку. Cursor хранится отдельно для каждой пары
   `session_uuid + channel`.
10. После reconnect gateway фиксирует high-watermark выбранного transport-канала,
   восстанавливает его события из PostgreSQL и затем выпускает накопившиеся
   live-события.

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
`dead`. Более поздние события того же канала не обходят такую запись: это сохраняет
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

Владелец клиентской read model публикует `realtime.delivery.requested.v1` после
валидации и нормализации доменного события:

```json
{
  "eventUuid": "5a943eb6-4d4f-4c11-9962-08cf45e1697e",
  "eventType": "product.import.progressed.v1",
  "schemaVersion": 1,
  "occurredAt": "2026-08-08T12:00:00.000Z",
  "channel": "products",
  "payload": {
    "progress": 50
  }
}
```

Сейчас поддерживаются каналы `products` и `offers`. Producer не знает socket IDs
и публикует только имя канала; все клиенты соответствующего transport-соединения
получают событие.

Для admin frontend события `product.updated` и `store.product.updated`
нормализует Admin Gateway. Payload имеет тот же admin-facing entity contract,
что и соответствующий HTTP-ответ. Socket Gateway не знает доменные envelopes,
snapshots и правила сборки read model; он принимает только единый delivery
contract. RabbitMQ ACK отправляется только после фиксации delivery и
gateway-outbox в `socket_srv`.

Ingress использует очередь `AMQP_SOCKET_GATEWAY_DELIVERY_QUEUE`. Это отдельная
очередь готовых delivery requests: прежняя domain-event очередь не
переиспользуется, потому что её durable bindings сохраняются в RabbitMQ после
удаления handlers из приложения.

## Socket.IO contract

Используются два независимых Engine.IO path, каждый со своим физическим WebSocket,
Socket.IO Manager, cursor, replay и ACK:

- products: `ws://<host>/socket.io/products?EIO=4&transport=websocket`;
- store/offers: `ws://<host>/socket.io/store?EIO=4&transport=websocket`.

Namespace-мультиплексирование между этими каналами не используется.

Клиент передаёт короткоживущий JWT в `handshake.auth.ticket`. Обязательные
claims: user UUID в `sub`, стабильный UUID сессии в `sid`, audience из
`SOCKET_TICKET_AUDIENCE`:

```json
{
  "sub": "3a4752e0-c56d-4d72-8976-28438f680fb8",
  "sid": "09edcfbd-b192-4fc9-a703-f5bf84a67386",
  "aud": "realtime",
  "exp": 1786190460
}
```

Ticket выдаёт защищённый `POST /v1/auth/socket-ticket` административного gateway
только после проверки текущей identity-сессии. Socket gateway проверяет ticket в
handshake middleware и отклоняет соединение до события `connect`, если ticket
отсутствует, просрочен или имеет неверную подпись. Session cookie напрямую между
gateway-сервисами не разделяется.

Каждое успешно авторизованное соединение получает все события своего канала.
Rooms и клиентская подписка для текущих продуктового и офферного потоков не нужны.

События протокола:

- server `realtime.event.v1` — delivery envelope;
- client `realtime.ack.v1` — `{ "sequence": "42" }`;
- server `realtime.ready.v1` — `{ "channel": "products", "cursor": "41", "watermark": "42" }`;
- server `realtime.error.v1` — соединение или replay невозможно продолжить.

ACK кумулятивный в пределах transport-канала текущего соединения. Gateway не принимает
ACK выше реально отправленного sequence.

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
