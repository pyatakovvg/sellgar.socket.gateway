# @gateway/socket

`sellgar.socket.gateway` is the independently deployable realtime delivery edge.
It persists transport-neutral delivery requests, fans them out to running
instances and routes them to authenticated Socket.IO rooms.

## Structure

- Feature code belongs in `src/api/v1/<feature>`.
- A feature is split into `controller`, `gateway`, `repository` and `service`
  folders, following the surrounding Sellgar backend repositories.
- Keep DTOs under the layer that owns the contract.
- Keep TypeORM models and the Nest module at the feature root.
- Keep schema changes in `src/migrations`; never enable `synchronize`.

## Boundaries and guarantees

- Domain ownership stays in producer services. This gateway owns persistence,
  connection authentication, room routing, replay and delivery transport.
- Never accept arbitrary room membership from an untrusted socket client.
- RabbitMQ ingress uses manual acknowledgement. ACK only after the PostgreSQL
  transaction has persisted both `delivery_event` and `delivery_outbox`.
- PostgreSQL is the replay source of truth. Per-instance Rabbit queues are
  transient cluster fanout, not durable client storage.
- Delivery is at least once within configured retention. Preserve `deliveryId`
  and per-room `sequence`; do not claim exactly-once semantics.
- Do not add HTTP business APIs. HTTP is limited to operational endpoints.
- Do not expose outbox retry without authentication and audit logging.

## Verification

```bash
yarn build
yarn test --runInBand
yarn migration:show
```
