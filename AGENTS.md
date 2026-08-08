# @gateway/socket

`sellgar.socket.gateway` is the independently deployable realtime delivery edge.
It accepts transport-neutral delivery requests from RabbitMQ and routes them to
authenticated Socket.IO rooms.

## Boundaries

- Keep domain ownership in producer services. This gateway owns connection,
  room routing and delivery transport only.
- Never accept arbitrary room membership from an untrusted socket client.
- RabbitMQ ingress messages use manual acknowledgement. Acknowledge only after
  the delivery request has been accepted by the next durable/confirmed stage.
- The in-memory inbox is development scaffolding, not a production durability
  guarantee. Production delivery requires PostgreSQL inbox/outbox/event storage
  and reconnect replay.
- Do not add HTTP business APIs here. HTTP is limited to operational endpoints.

## Verification

```bash
yarn build
yarn test --runInBand
```
