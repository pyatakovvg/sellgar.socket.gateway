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
  ValidateNested,
} from 'class-validator';

export const REALTIME_AUDIENCE_TYPES = ['user', 'tenant', 'shop', 'job'] as const;
export type RealtimeAudienceType = (typeof REALTIME_AUDIENCE_TYPES)[number];

export class RealtimeAudienceDto {
  @IsIn(REALTIME_AUDIENCE_TYPES)
  type!: RealtimeAudienceType;

  @IsUUID()
  uuid!: string;
}

export class RealtimeDeliveryRequestedDto {
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
  @Type(() => RealtimeAudienceDto)
  audience!: RealtimeAudienceDto;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export function audienceRoom(audience: RealtimeAudienceDto): string {
  return `${audience.type}:${audience.uuid}`;
}
