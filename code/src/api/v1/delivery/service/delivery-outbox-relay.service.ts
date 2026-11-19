import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClusterGateway } from '../gateway/cluster.gateway';
import { ClaimedDelivery, DeliveryRepository } from '../repository/delivery.repository';

@Injectable()
export class DeliveryOutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryOutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly cluster: ClusterGateway,
    private readonly config: ConfigService,
    private readonly repository: DeliveryRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => this.kick(),
      this.config.getOrThrow<number>('DELIVERY_OUTBOX_POLL_INTERVAL_MS'),
    );
    this.timer.unref();
    this.kick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
    }
    await this.running;
  }

  private kick(): void {
    if (this.running) {
      return;
    }
    this.running = this.flush()
      .catch((error: unknown) => {
        this.logger.error('Delivery outbox flush failed', error instanceof Error ? error.stack : undefined);
      })
      .finally(() => {
        this.running = undefined;
      });
  }

  private async flush(): Promise<void> {
    const events = await this.repository.claimOutbox(
      this.config.getOrThrow<number>('DELIVERY_OUTBOX_BATCH_SIZE'),
      this.config.getOrThrow<number>('DELIVERY_OUTBOX_MAX_ATTEMPTS'),
      this.config.getOrThrow<number>('DELIVERY_OUTBOX_PROCESSING_TIMEOUT_MS'),
    );

    for (const event of events) {
      await this.publish(event);
    }
  }

  private async publish(event: ClaimedDelivery): Promise<void> {
    try {
      const { attempts, ...message } = event;
      await this.cluster.publish(message);
      await this.repository.markPublished(event.deliveryId, attempts);
    } catch (error) {
      const retryBaseMs = this.config.getOrThrow<number>('DELIVERY_OUTBOX_RETRY_BASE_MS');
      const retryAt = new Date(Date.now() + retryBaseMs * 2 ** Math.min(event.attempts, 10));
      const terminal = event.attempts + 1 >= this.config.getOrThrow<number>('DELIVERY_OUTBOX_MAX_ATTEMPTS');
      await this.repository.markFailed(event.deliveryId, event.attempts, retryAt, error, terminal);
      this.logger.warn(
        terminal
          ? `Cluster publish failed for ${event.deliveryId}; moved to dead state`
          : `Cluster publish failed for ${event.deliveryId}; retry scheduled`,
      );
    }
  }
}
