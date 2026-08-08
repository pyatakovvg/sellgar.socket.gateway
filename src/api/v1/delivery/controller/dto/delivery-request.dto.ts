import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { BROADCAST_ROOM } from '../../delivery.constants';

export const DELIVERY_AUDIENCE_TYPES = ['broadcast', 'user', 'tenant', 'shop', 'job'] as const;
export type DeliveryAudienceType = (typeof DELIVERY_AUDIENCE_TYPES)[number];

export class DeliveryAudienceDto {
  @IsIn(DELIVERY_AUDIENCE_TYPES)
  type!: DeliveryAudienceType;

  @ValidateIf((audience: DeliveryAudienceDto) => audience.type !== 'broadcast')
  @IsUUID()
  uuid?: string;
}

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

  @ValidateNested()
  @Type(() => DeliveryAudienceDto)
  audience!: DeliveryAudienceDto;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export function audienceRoom(audience: DeliveryAudienceDto): string {
  return audience.type === 'broadcast' ? BROADCAST_ROOM : `${audience.type}:${audience.uuid}`;
}
