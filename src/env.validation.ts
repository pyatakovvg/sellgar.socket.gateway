type EnvConfig = Record<string, unknown>;

const requiredStringKeys = [
  'ORIGINS',
  'DATABASE_HOST',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
  'DATABASE_DATABASE_NAME',
  'AMQP_HOSTNAME',
  'AMQP_USERNAME',
  'AMQP_PASSWORD',
  'AMQP_SOCKET_GATEWAY_DELIVERY_QUEUE',
  'AMQP_SOCKET_GATEWAY_EVENT_EXCHANGE',
  'AMQP_SOCKET_GATEWAY_DISPATCH_EXCHANGE',
  'AMQP_SOCKET_GATEWAY_DEAD_LETTER_EXCHANGE',
  'SOCKET_TICKET_SECRET',
  'SOCKET_TICKET_AUDIENCE',
] as const;

const requiredNumberKeys = [
  'PORT',
  'DATABASE_PORT',
  'AMQP_PORT',
  'AMQP_PREFETCH_COUNT',
  'DELIVERY_RETENTION_HOURS',
  'DELIVERY_REPLAY_BATCH_SIZE',
  'DELIVERY_REPLAY_PENDING_MAX',
  'DELIVERY_OUTBOX_POLL_INTERVAL_MS',
  'DELIVERY_OUTBOX_BATCH_SIZE',
  'DELIVERY_OUTBOX_MAX_ATTEMPTS',
  'DELIVERY_OUTBOX_RETRY_BASE_MS',
  'DELIVERY_OUTBOX_PROCESSING_TIMEOUT_MS',
  'DELIVERY_CLEANUP_INTERVAL_MS',
] as const;

function requireString(config: EnvConfig, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function requireNumber(config: EnvConfig, key: string): number {
  const value = config[key];
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return numberValue;
}

export function validateEnv(config: EnvConfig): EnvConfig {
  const result: EnvConfig = { ...config };

  for (const key of requiredStringKeys) {
    result[key] = requireString(config, key);
  }
  for (const key of requiredNumberKeys) {
    result[key] = requireNumber(config, key);
    if (Number(result[key]) <= 0) {
      throw new Error(`Environment variable ${key} must be greater than zero`);
    }
  }

  const origins = String(result.ORIGINS)
    .split(';')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error('Environment variable ORIGINS must contain at least one origin');
  }
  const secret = String(result.SOCKET_TICKET_SECRET);
  if (secret.length < 32) {
    throw new Error('Environment variable SOCKET_TICKET_SECRET must contain at least 32 characters');
  }
  return result;
}
