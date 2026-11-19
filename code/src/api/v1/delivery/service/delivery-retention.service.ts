import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DeliveryRepository } from '../repository/delivery.repository';

@Injectable()
export class DeliveryRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryRetentionService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly repository: DeliveryRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => this.kick(),
      this.config.getOrThrow<number>('DELIVERY_CLEANUP_INTERVAL_MS'),
    );
    this.timer.unref();
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
    this.running = this.repository
      .cleanupExpired()
      .then((deleted) => {
        if (deleted > 0) {
          this.logger.log(`Deleted ${deleted} expired delivery events`);
        }
      })
      .catch((error: unknown) => {
        this.logger.error('Delivery retention cleanup failed', error instanceof Error ? error.stack : undefined);
      })
      .finally(() => {
        this.running = undefined;
      });
  }
}
