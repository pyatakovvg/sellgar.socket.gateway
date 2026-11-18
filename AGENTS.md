# @gateway/socket

`sellgar.socket.gateway` is the independently deployable realtime delivery edge.
It persists transport-neutral delivery requests, fans them out to running
instances and routes them through authenticated physical Socket.IO connections.

## Structure

- Feature code belongs in `src/api/v1/<feature>`.
- A feature is split into `controller`, `gateway`, `repository` and `service`
  folders, following the surrounding Sellgar backend repositories.
- Keep DTOs under the layer that owns the contract.
- Keep TypeORM models and the Nest module at the feature root.
- Keep schema changes in `src/migrations`; never enable `synchronize`.

## Boundaries and guarantees

- Domain ownership stays in producer services. This gateway owns persistence,
  connection authentication, transport-path routing, replay and delivery transport.
- Keep domain streams on explicit server-owned Socket.IO paths. Never accept an
  arbitrary channel or room from an untrusted socket client.
- RabbitMQ ingress uses manual acknowledgement. ACK only after the PostgreSQL
  transaction has persisted both `delivery_event` and `delivery_outbox`.
- PostgreSQL is the replay source of truth. Per-instance Rabbit queues are
  transient cluster fanout, not durable client storage.
- Delivery is at least once within configured retention. Preserve `deliveryId`
  and per-channel `sequence`; do not claim exactly-once semantics.
- Do not add HTTP business APIs. HTTP is limited to operational endpoints.
- Do not expose outbox retry without authentication and audit logging.

## Verification

```bash
yarn build
yarn test --runInBand
yarn migration:show
```

## Категории Store

Канал categories доставляется по /socket.io/categories через CategoriesConnectionGateway.
Использует общий authenticated ticket, durable delivery, replay и ACK; отдельной
бизнес-обработки категорий на socket edge нет.

## Приватные корзины

Канал carts использует /socket.io/carts. ownerUuid обязателен для carts и запрещен
для broadcast; хранится delivery_event.owner_uuid и проверяется одинаково в SQL
watermark/replay и в live/pending/emit. Routing owner не пересылается браузеру.
Cart-only ticket имеет sub/sid/oid/scope=carts/exp; обычный admin ticket не открывает
carts, Cart ticket не открывает admin каналы. Identity session.check проверяет
client_gw-сессию при handshake и перед private replay/live; при отказе/недоступности
доставка прекращается и соединение закрывается, cursor не продвигается.
Срок Cart ticket проверяется только в handshake. Отдельного Cart таймера нет: используется общий lifecycle соединения. Актуальные status/owner/user/expiresAt Identity проверяются перед private replay/live; истёкшая сессия не получает данные. Пассивная проверка не продлевает сессию. Авторизованные аккаунты используют
существующий user-bound cursor per session/channel; гость использует тот же session/channel cursor с user_uuid=null.
Guest ticket без sub допускается только для owner-bound Cart scope после проверки Identity; admin broadcast требует пользователя.
Применить также GuestSessionCursors1794870001000. Пассивные проверки не продлевают гостевой срок.
Применить PrivateCartDelivery1794850000000. Tests: yarn test:integration создает
только случайные socket_cart_test_* schemas.
