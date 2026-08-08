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
  ORIGINS: 'http://localhost:3000;http://localhost:3010',
  PORT: '4040',
  REALTIME_DEDUPE_MAX_ENTRIES: '10000',
  SOCKET_TICKET_AUDIENCE: 'realtime',
  SOCKET_TICKET_SECRET: 'a-secret-that-is-longer-than-32-characters',
};

describe(validateEnv.name, () => {
  it('normalizes numbers and preserves the semicolon-delimited origins contract', () => {
    const result = validateEnv(validConfig);

    expect(result.PORT).toBe(4040);
    expect(result.AMQP_PORT).toBe(5672);
    expect(result.ORIGINS).toBe(validConfig.ORIGINS);
  });

  it('rejects a missing required gateway variable', () => {
    const { AMQP_SOCKET_GATEWAY_EVENT_QUEUE: _, ...config } = validConfig;

    expect(() => validateEnv(config)).toThrow(
      'Missing required environment variable: AMQP_SOCKET_GATEWAY_EVENT_QUEUE',
    );
  });
});
