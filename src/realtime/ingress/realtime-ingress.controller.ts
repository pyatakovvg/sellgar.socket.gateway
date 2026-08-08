import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validateOrReject } from 'class-validator';

import { REALTIME_DELIVERY_REQUESTED_PATTERN } from '@/realtime/contracts/realtime.constants';
import { RealtimeDeliveryRequestedDto } from '@/realtime/contracts/realtime-delivery.dto';
import { RealtimeDeliveryService } from './realtime-delivery.service';

@Controller()
export class RealtimeIngressController {
  private readonly logger = new Logger(RealtimeIngressController.name);

  constructor(private readonly delivery: RealtimeDeliveryService) {}

  @EventPattern(REALTIME_DELIVERY_REQUESTED_PATTERN)
  async handle(@Payload() payload: unknown, @Ctx() context: RmqContext): Promise<void> {
    const channel = context.getChannelRef();
    const message = context.getMessage();

    try {
      const event = plainToInstance(RealtimeDeliveryRequestedDto, payload);
      await validateOrReject(event, { forbidNonWhitelisted: true, whitelist: true });
      await this.delivery.accept(event);
      channel.ack(message);
    } catch (error) {
      const invalid = Array.isArray(error) && error.every((item) => item instanceof ValidationError);
      this.logger.error(
        invalid ? 'Rejected invalid realtime event' : 'Failed to accept realtime event',
        error instanceof Error ? error.stack : undefined,
      );
      channel.nack(message, false, !invalid);
    }
  }
}
