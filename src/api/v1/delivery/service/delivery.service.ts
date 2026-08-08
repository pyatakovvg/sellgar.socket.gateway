import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DeliveryRequestDto } from '../controller/dto/delivery-request.dto';
import { DeliveryMessage } from '../delivery.entity';
import { DeliveryChannel } from '../delivery.constants';
import { DeliveryRepository } from '../repository/delivery.repository';

@Injectable()
export class DeliveryService {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: DeliveryRepository,
  ) {}

  accept(event: DeliveryRequestDto): Promise<'accepted' | 'duplicate' | 'expired'> {
    const retentionLimit = new Date(
      Date.now() + this.config.getOrThrow<number>('DELIVERY_RETENTION_HOURS') * 60 * 60 * 1000,
    );
    const requestedExpiration = event.expiresAt ? new Date(event.expiresAt) : retentionLimit;
    const expiresAt = requestedExpiration < retentionLimit ? requestedExpiration : retentionLimit;

    if (expiresAt.getTime() <= Date.now()) {
      return Promise.resolve('expired');
    }

    return this.repository.accept(event, expiresAt);
  }

  cursor(sessionUuid: string, userUuid: string, channel: DeliveryChannel): Promise<string> {
    return this.repository.getOrCreateCursor(sessionUuid, userUuid, channel);
  }

  acknowledge(sessionUuid: string, userUuid: string, channel: DeliveryChannel, sequence: string): Promise<unknown> {
    return this.repository.acknowledge(sessionUuid, userUuid, channel, sequence);
  }

  highWatermark(channel: DeliveryChannel): Promise<string> {
    return this.repository.highWatermark(channel);
  }

  replay(channel: DeliveryChannel, after: string, upTo: string): Promise<DeliveryMessage[]> {
    return this.repository.replay(
      channel,
      after,
      upTo,
      this.config.getOrThrow<number>('DELIVERY_REPLAY_BATCH_SIZE'),
    );
  }
}
