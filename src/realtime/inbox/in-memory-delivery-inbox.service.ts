import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DeliveryInbox } from './delivery-inbox';

@Injectable()
export class InMemoryDeliveryInboxService implements DeliveryInbox {
  private readonly completed = new Map<string, true>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly maxEntries: number;

  constructor(config: ConfigService) {
    this.maxEntries = config.getOrThrow<number>('REALTIME_DEDUPE_MAX_ENTRIES');
  }

  async runOnce(
    eventUuid: string,
    operation: () => Promise<void>,
  ): Promise<'accepted' | 'duplicate'> {
    if (this.completed.has(eventUuid)) {
      return 'duplicate';
    }

    const current = this.inFlight.get(eventUuid);
    if (current) {
      await current;
      return 'duplicate';
    }

    const execution = operation();
    this.inFlight.set(eventUuid, execution);
    try {
      await execution;
      this.remember(eventUuid);
      return 'accepted';
    } finally {
      this.inFlight.delete(eventUuid);
    }
  }

  private remember(eventUuid: string): void {
    this.completed.set(eventUuid, true);
    while (this.completed.size > this.maxEntries) {
      const oldest = this.completed.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.completed.delete(oldest);
    }
  }
}
