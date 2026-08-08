import { validateEnv } from './env.validation';

const validConfig = {
  AMQP_HOSTNAME: 'localhost',
  AMQP_PASSWORD: 'admin',
  AMQP_PORT: '5672',
  AMQP_PREFETCH_COUNT: '20',
  AMQP_SOCKET_GATEWAY_DEAD_LETTER_EXCHANGE: 'socket_gateway.dead-letter.exchange',
  AMQP_SOCKET_GATEWAY_DISPATCH_EXCHANGE: 'socket_gateway.dispatch.exchange',
  AMQP_SOCKET_GATEWAY_EVENT_EXCHANGE: 'event.exchange',
  AMQP_SOCKET_GATEWAY_EVENT_QUEUE: 'socket_gateway.event.queue',
  AMQP_USERNAME: 'admin',
  DATABASE_DATABASE_NAME: 'socket_srv',
  DATABASE_HOST: 'localhost',
  DATABASE_PASSWORD: 'admin',
  DATABASE_PORT: '5432',
  DATABASE_USERNAME: 'admin',
  DELIVERY_CLEANUP_INTERVAL_MS: '3600000',
  DELIVERY_OUTBOX_BATCH_SIZE: '100',
  DELIVERY_OUTBOX_MAX_ATTEMPTS: '20',
  DELIVERY_OUTBOX_POLL_INTERVAL_MS: '250',
  DELIVERY_OUTBOX_PROCESSING_TIMEOUT_MS: '30000',
  DELIVERY_OUTBOX_RETRY_BASE_MS: '1000',
  DELIVERY_REPLAY_BATCH_SIZE: '200',
  DELIVERY_REPLAY_PENDING_MAX: '2000',
  DELIVERY_RETENTION_HOURS: '168',
  ORIGINS: 'http://localhost:3000;http://localhost:3010',
  PORT: '4040',
  SOCKET_TICKET_AUDIENCE: 'realtime',
  SOCKET_TICKET_SECRET: 'a-secret-that-is-longer-than-32-characters',
};

describe(validateEnv.name, () => {
  it('normalizes numbers and preserves the semicolon-delimited origins contract', () => {
    const result = validateEnv(validConfig);

    expect(result.PORT).toBe(4040);
    expect(result.AMQP_PORT).toBe(5672);
    expect(result.DATABASE_PORT).toBe(5432);
    expect(result.ORIGINS).toBe(validConfig.ORIGINS);
  });

  it('rejects a missing required gateway variable', () => {
    const { AMQP_SOCKET_GATEWAY_EVENT_QUEUE: _, ...config } = validConfig;

    expect(() => validateEnv(config)).toThrow(
      'Missing required environment variable: AMQP_SOCKET_GATEWAY_EVENT_QUEUE',
    );
  });
});
