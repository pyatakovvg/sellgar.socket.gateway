import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from '@/app.module';
import { RealtimeIoAdapter } from '@/realtime/platform/realtime-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('SocketGateway');
  const origins = config
    .getOrThrow<string>('ORIGINS')
    .split(';')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableShutdownHooks();
  app.enableCors({ credentials: true, origin: origins });
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, origins));
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [
        {
          hostname: config.getOrThrow<string>('AMQP_HOSTNAME'),
          port: config.getOrThrow<number>('AMQP_PORT'),
          username: config.getOrThrow<string>('AMQP_USERNAME'),
          password: config.getOrThrow<string>('AMQP_PASSWORD'),
        },
      ],
      exchange: config.getOrThrow<string>('AMQP_SOCKET_GATEWAY_EVENT_EXCHANGE'),
      exchangeType: 'topic',
      queue: config.getOrThrow<string>('AMQP_SOCKET_GATEWAY_EVENT_QUEUE'),
      queueOptions: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': config.getOrThrow<string>(
            'AMQP_SOCKET_GATEWAY_DEAD_LETTER_EXCHANGE',
          ),
        },
      },
      noAck: false,
      persistent: true,
      prefetchCount: config.getOrThrow<number>('AMQP_PREFETCH_COUNT'),
      wildcards: true,
    },
  });

  await app.startAllMicroservices();
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
  logger.log(`Socket gateway listening on port ${port}`);
}

void bootstrap();
