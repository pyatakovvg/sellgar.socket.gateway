import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqp-connection-manager';
import { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { hostname } from 'node:os';

import { DeliveryMessage, parseDeliveryMessage } from '../delivery.entity';
import { rabbitUrl } from './rabbit-url';

const CLUSTER_ROUTING_KEY = 'socket.delivery.v1';

type DeliveryListener = (message: DeliveryMessage) => Promise<void> | void;

@Injectable()
export class ClusterGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterGateway.name);
  private readonly listeners = new Set<DeliveryListener>();
  private connection?: AmqpConnectionManager;
  private consumer?: ChannelWrapper;
  private publisher?: ChannelWrapper;

  constructor(private readonly config: ConfigService) {}

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
        await channel.bindQueue(queue.queue, exchange, CLUSTER_ROUTING_KEY);
        await channel.prefetch(this.config.getOrThrow<number>('AMQP_PREFETCH_COUNT'));
        await channel.consume(queue.queue, (message) => void this.consume(channel, message));
      },
    });

    await Promise.all([this.publisher.waitForConnect(), this.consumer.waitForConnect()]);
  }

  async publish(message: DeliveryMessage): Promise<void> {
    if (!this.publisher) {
      throw new Error('Cluster publisher is not initialized');
    }

    await this.publisher.publish(
      this.config.getOrThrow<string>('AMQP_SOCKET_GATEWAY_DISPATCH_EXCHANGE'),
      CLUSTER_ROUTING_KEY,
      message,
      {
        contentType: 'application/json',
        messageId: message.deliveryId,
        persistent: false,
      },
    );
  }

  subscribe(listener: DeliveryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

    let delivery: DeliveryMessage;
    try {
      delivery = parseDeliveryMessage(JSON.parse(message.content.toString('utf8')) as unknown);
    } catch (error) {
      this.logger.error('Rejected invalid cluster delivery', error instanceof Error ? error.stack : undefined);
      channel.nack(message, false, false);
      return;
    }

    try {
      await Promise.all([...this.listeners].map((listener) => listener(delivery)));
      channel.ack(message);
    } catch (error) {
      this.logger.error('Failed to consume cluster delivery', error instanceof Error ? error.stack : undefined);
      channel.nack(message, false, true);
    }
  }
}
