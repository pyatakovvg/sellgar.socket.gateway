import { ConfigService } from '@nestjs/config';

export function rabbitUrl(config: ConfigService): string {
  const username = encodeURIComponent(config.getOrThrow<string>('AMQP_USERNAME'));
  const password = encodeURIComponent(config.getOrThrow<string>('AMQP_PASSWORD'));
  const hostname = config.getOrThrow<string>('AMQP_HOSTNAME');
  const port = config.getOrThrow<number>('AMQP_PORT');
  return `amqp://${username}:${password}@${hostname}:${port}`;
}
