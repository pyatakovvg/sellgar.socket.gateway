type EnvConfig = Record<string, unknown>;

const requiredStringKeys = [
  'ORIGINS',
  'AMQP_HOSTNAME',
  'AMQP_USERNAME',
  'AMQP_PASSWORD',
  'AMQP_SOCKET_GATEWAY_EVENT_QUEUE',
  'AMQP_SOCKET_GATEWAY_EVENT_EXCHANGE',
  'AMQP_SOCKET_GATEWAY_DISPATCH_EXCHANGE',
  'AMQP_SOCKET_GATEWAY_DEAD_LETTER_EXCHANGE',
  'SOCKET_TICKET_SECRET',
  'SOCKET_TICKET_AUDIENCE',
] as const;

const requiredNumberKeys = [
  'PORT',
  'AMQP_PORT',
  'AMQP_PREFETCH_COUNT',
  'REALTIME_DEDUPE_MAX_ENTRIES',
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
