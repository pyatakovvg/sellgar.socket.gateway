import 'reflect-metadata';
import { GuestSessionCursors1794870001000 } from '../src/migrations/1794870001000-guest-session-cursors';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DeliveryRepository } from '../src/api/v1/delivery/repository/delivery.repository';
import { DurableDelivery1786200000000 } from '../src/migrations/1786200000000-durable-delivery';
import { BroadcastDelivery1786201000000 } from '../src/migrations/1786201000000-broadcast-delivery';
import { ChannelDelivery1786202000000 } from '../src/migrations/1786202000000-channel-delivery';
import { NormalizedRealtimeDelivery1786347000000 } from '../src/migrations/1786347000000-normalized-realtime-delivery';
import { PrivateCartDelivery1794850000000 } from '../src/migrations/1794850000000-private-cart-delivery';

if (existsSync('.env')) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
describe('Private Cart PostgreSQL delivery', () => {
  const schema = 'socket_cart_test_' + randomUUID().replace(/-/g, '');
  let db: DataSource, repository: DeliveryRepository;
  const a = randomUUID(),
    b = randomUUID(),
    sessionA = randomUUID(),
    sessionB = randomUUID();
  const options = () => ({
    type: 'postgres' as const,
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_DATABASE_NAME,
  });
  const expires = () => new Date(Date.now() + 3600000);
  const event = (ownerUuid: string) => ({
    eventUuid: randomUUID(),
    eventType: 'cart.updated',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    channel: 'carts' as const,
    ownerUuid,
    payload: { cartUuid: randomUUID() },
  });
  beforeAll(async () => {
    const control = await new DataSource(options()).initialize();
    try {
      await control.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await control.destroy();
    }
    db = await new DataSource({
      ...options(),
      schema,
      extra: { options: `-c search_path=${schema},public` },
      entities: [],
      migrations: [
        DurableDelivery1786200000000,
        BroadcastDelivery1786201000000,
        ChannelDelivery1786202000000,
        NormalizedRealtimeDelivery1786347000000,
        PrivateCartDelivery1794850000000,
        GuestSessionCursors1794870001000,
      ],
    }).initialize();
    await db.runMigrations();
    repository = new DeliveryRepository(db);
  });
  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.destroy();
    }
  });
  beforeEach(async () => {
    await db.query('TRUNCATE delivery_event,delivery_cursor CASCADE');
  });
  it('filters watermark and replay by owner and stores an atomic outbox receipt', async () => {
    const own = event(a),
      foreign = event(b);
    await repository.accept(own, expires());
    await repository.accept(foreign, expires());
    const high = await repository.highWatermark('carts', a);
    const replay = await repository.replay('carts', '0', '9999999', 100, a);
    expect(replay.map((v) => v.deliveryId)).toEqual([own.eventUuid]);
    expect(replay[0].ownerUuid).toBe(a);
    expect(replay[0].sequence).toBe(high);
    expect(await repository.replay('carts', '0', '9999999', 100, randomUUID())).toEqual([]);
    expect(await repository.replay('carts', '0', '9999999', 100)).toEqual([]);
    expect((await db.query('SELECT count(*)::int n FROM delivery_outbox'))[0].n).toBe(2);
    await expect(repository.accept(own, expires())).resolves.toBe('duplicate');
    expect((await db.query('SELECT count(*)::int n FROM delivery_outbox'))[0].n).toBe(2);
  });
  it('enforces a private audience in PostgreSQL even when validation is bypassed', async () => {
    await expect(repository.accept({ ...event(a), ownerUuid: undefined }, expires())).rejects.toThrow();
    await expect(repository.accept({ ...event(a), channel: 'products' }, expires())).rejects.toThrow();
    expect((await db.query('SELECT count(*)::int n FROM delivery_event'))[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM delivery_outbox'))[0].n).toBe(0);
  });
  it('keeps cursors independent for sessions of the same account and rejects ownership changes', async () => {
    expect(await repository.getOrCreateCursor(sessionA, a, 'carts')).toBe('0');
    expect(await repository.getOrCreateCursor(sessionB, a, 'carts')).toBe('0');
    await repository.acknowledge(sessionA, a, 'carts', '10');
    expect(await repository.getOrCreateCursor(sessionA, a, 'carts')).toBe('10');
    expect(await repository.getOrCreateCursor(sessionB, a, 'carts')).toBe('0');
    await expect(repository.getOrCreateCursor(sessionA, b, 'carts')).rejects.toThrow('another user');
  });
  it('persists guest ACKs with no fake user and refuses to rebind their session to an account', async () => {
    const sessionUuid = randomUUID();
    expect(await repository.getOrCreateCursor(sessionUuid, null, 'carts')).toBe('0');
    await repository.acknowledge(sessionUuid, null, 'carts', '12');
    expect(await repository.getOrCreateCursor(sessionUuid, null, 'carts')).toBe('12');
    await expect(repository.getOrCreateCursor(sessionUuid, a, 'carts')).rejects.toThrow('another user');
  });

  it('does not block another owner behind a dead private stream', async () => {
    const dead = event(a),
      later = event(a),
      foreign = event(b);
    await repository.accept(dead, expires());
    await repository.accept(later, expires());
    await repository.accept(foreign, expires());
    await db.query("UPDATE delivery_outbox SET status='dead' WHERE event_uuid=$1", [dead.eventUuid]);
    const claimed = await repository.claimOutbox(100, 20, 30000);
    expect(claimed.map((v) => v.deliveryId)).toEqual([foreign.eventUuid]);
    expect(claimed[0].ownerUuid).toBe(b);
  });
});
