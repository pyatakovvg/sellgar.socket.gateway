import { IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Min, Validate } from 'class-validator';
import { DeliveryOwnerConstraint } from './delivery-owner.constraint';

import { DELIVERY_CHANNELS, DeliveryChannel } from '../../delivery.constants';

export class DeliveryRequestDto {
  @IsUUID()
  eventUuid!: string;

  @IsString()
  eventType!: string;

  @IsInt()
  @Min(1)
  schemaVersion!: number;

  @IsISO8601()
  occurredAt!: string;

  @IsIn(DELIVERY_CHANNELS)
  channel!: DeliveryChannel;

  @Validate(DeliveryOwnerConstraint)
  ownerUuid?: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
