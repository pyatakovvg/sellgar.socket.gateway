import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validateOrReject } from 'class-validator';

import { DELIVERY_REQUESTED_PATTERN } from '../delivery.constants';
import { DeliveryService } from '../service/delivery.service';
import { DeliveryRequestDto } from './dto/delivery-request.dto';

@Controller()
export class DeliveryController {
  private readonly logger = new Logger(DeliveryController.name);

  constructor(private readonly delivery: DeliveryService) {}

  @EventPattern(DELIVERY_REQUESTED_PATTERN)
  async handle(@Payload() payload: unknown, @Ctx() context: RmqContext): Promise<void> {
    const channel = context.getChannelRef();
    const message = context.getMessage();

    try {
      const event = plainToInstance(DeliveryRequestDto, payload);
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
