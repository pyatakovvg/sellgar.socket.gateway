import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqp-connection-manager';
import { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validateOrReject } from 'class-validator';
import { hostname } from 'node:os';

import { REALTIME_DELIVERY_DISPATCH_PATTERN } from '@/realtime/contracts/realtime.constants';
import { RealtimeDeliveryRequestedDto } from '@/realtime/contracts/realtime-delivery.dto';
import { RealtimeGateway } from '@/realtime/gateway/realtime.gateway';
import { rabbitUrl } from './rabbit-url';

export class RealtimeDispatchBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeDispatchBridgeService.name);
  private connection?: AmqpConnectionManager;
  private consumer?: ChannelWrapper;
  private publisher?: ChannelWrapper;

  constructor(
    private readonly config: ConfigService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = amqp.connect([rabbitUrl(this.config)]);
    const exchange = this.config.getOrThrow<string>('AMQP_SOCKET_GATEWAY_DISPATCH_EXCHANGE');

    this.publisher = this.connection.createChannel({
      json: true,
      setup: async (channel: ConfirmChannel) => {
        await channel.assertExchange(exchange, 'topic', { durable: true });
      },
    });

    this.consumer = this.connection.createChannel({
      setup: async (channel: ConfirmChannel) => {
        await channel.assertExchange(exchange, 'topic', { durable: true });
        const instanceId = this.config.get<string>('SOCKET_INSTANCE_ID') || hostname();
        const queue = await channel.assertQueue(`socket_gateway.node.${instanceId}`, {
          autoDelete: true,
          durable: false,
          exclusive: true,
        });
        await channel.bindQueue(queue.queue, exchange, REALTIME_DELIVERY_DISPATCH_PATTERN);
        await channel.prefetch(this.config.getOrThrow<number>('AMQP_PREFETCH_COUNT'));
        await channel.consume(queue.queue, (message) => {
          void this.consume(channel, message);
        });
      },
    });

    await Promise.all([this.publisher.waitForConnect(), this.consumer.waitForConnect()]);
  }

  async publish(event: RealtimeDeliveryRequestedDto): Promise<void> {
    if (!this.publisher) {
      throw new Error('Realtime dispatch publisher is not initialized');
    }
    await this.publisher.publish(
      this.config.getOrThrow<string>('AMQP_SOCKET_GATEWAY_DISPATCH_EXCHANGE'),
      REALTIME_DELIVERY_DISPATCH_PATTERN,
      event,
      { contentType: 'application/json', persistent: true },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.close();
    await this.publisher?.close();
    await this.connection?.close();
  }

  private async consume(channel: ConfirmChannel, message: ConsumeMessage | null): Promise<void> {
    if (!message) {
      return;
    }
    try {
      const payload: unknown = JSON.parse(message.content.toString('utf8'));
      const event = plainToInstance(RealtimeDeliveryRequestedDto, payload);
      await validateOrReject(event, { forbidNonWhitelisted: true, whitelist: true });
      this.gateway.dispatch(event);
      channel.ack(message);
    } catch (error) {
      const invalid = Array.isArray(error) && error.every((item) => item instanceof ValidationError);
      this.logger.error('Failed to dispatch realtime event', error instanceof Error ? error.stack : undefined);
      channel.nack(message, false, !invalid);
    }
  }
}
