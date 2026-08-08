import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validateOrReject } from 'class-validator';

import { DELIVERY_REQUESTED_PATTERN, PRODUCT_UPDATED_PATTERN } from '../delivery.constants';
import { DeliveryService } from '../service/delivery.service';
import { DeliveryRequestDto } from './dto/delivery-request.dto';
import { ProductUpdatedEventDto } from './dto/product-updated-event.dto';

@Controller()
export class DeliveryController {
  private readonly logger = new Logger(DeliveryController.name);

  constructor(private readonly delivery: DeliveryService) {}

  @EventPattern(DELIVERY_REQUESTED_PATTERN)
  async handle(@Payload() payload: unknown, @Ctx() context: RmqContext): Promise<void> {
    await this.consume(context, async () => {
      const event = plainToInstance(DeliveryRequestDto, payload);
      await validateOrReject(event, { forbidNonWhitelisted: true, whitelist: true });
      await this.delivery.accept(event);
    });
  }

  @EventPattern(PRODUCT_UPDATED_PATTERN)
  async handleProductUpdated(@Payload() payload: unknown, @Ctx() context: RmqContext): Promise<void> {
    await this.consume(context, async () => {
      const event = plainToInstance(ProductUpdatedEventDto, payload);
      await validateOrReject(event, { forbidNonWhitelisted: true, whitelist: true });

      await this.delivery.accept(
        plainToInstance(DeliveryRequestDto, {
          eventUuid: event.eventUuid,
          eventType: event.eventType,
          schemaVersion: event.schemaVersion,
          occurredAt: event.occurredAt,
          audience: { type: 'broadcast' },
          payload: {
            productUuid: event.aggregateUuid,
            version: event.aggregateVersion,
          },
        }),
      );
    });
  }

  private async consume(context: RmqContext, operation: () => Promise<void>): Promise<void> {
    const channel = context.getChannelRef();
    const message = context.getMessage();

    try {
      await operation();
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
