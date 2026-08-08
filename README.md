# Sellgar Socket Gateway

Standalone NestJS realtime edge for Sellgar. It consumes delivery requests from
RabbitMQ, fans them out through a dedicated RabbitMQ exchange and emits them to
authenticated local Socket.IO rooms.

## Current foundation

- WebSocket-only Socket.IO namespace;
- short-lived signed socket-ticket verification;
- server-controlled `user:*`, `tenant:*`, `shop:*` and `job:*` rooms;
- durable RabbitMQ ingress queue with manual ACK;
- publisher-confirmed fan-out exchange;
- exclusive auto-delete dispatch queue per running instance;
- bounded in-memory duplicate suppression;
- HTTP `GET /health` endpoint.

The in-memory inbox prevents duplicates only during the lifetime of one
process. It does **not** provide offline delivery, crash-safe idempotency or
reconnect replay. The next durability stage must replace it with PostgreSQL
inbox/outbox/event storage. Rabbit ingress should then be acknowledged after the
database transaction, and clients should reconnect with their last persisted
event cursor.

## Event contract

Producers publish `realtime.delivery.requested.v1` through their transactional
outbox:

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

Domain services specify the audience but do not know Socket.IO room names or
socket IDs.

## Authentication

The client passes a short-lived JWT in `handshake.auth.ticket`. The token must
have audience configured by `SOCKET_TICKET_AUDIENCE`, a user UUID in `sub`, an
optional session UUID in `sid`, and optional signed rooms:

```json
{
  "sub": "3a4752e0-c56d-4d72-8976-28438f680fb8",
  "sid": "09edcfbd-b192-4fc9-a703-f5bf84a67386",
  "rooms": ["tenant:cb447bf9-6d67-47da-8d42-a950648668ab"],
  "aud": "realtime",
  "exp": 1786190460
}
```

The ticket issuer is intentionally outside this repository.

## Local setup

```bash
cp .env.example .env
yarn install
yarn build
yarn start:dev
```

Default HTTP health URL: `http://localhost:4040/health`.

`SOCKET_INSTANCE_ID` must be unique for every concurrently running instance.
In container platforms the hostname-based default is preferred; the fixed
`local-1` value is intended only for a single local process.
