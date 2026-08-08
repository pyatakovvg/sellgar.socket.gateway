import { IsIn, IsInt, IsISO8601, IsObject, IsString, IsUUID, Min } from 'class-validator';

export class ProductUpdatedEventDto {
  @IsUUID()
  eventUuid!: string;

  @IsIn(['product.updated'])
  eventType!: 'product.updated';

  @IsInt()
  @Min(1)
  schemaVersion!: number;

  @IsString()
  producer!: string;

  @IsIn(['product'])
  aggregateType!: 'product';

  @IsUUID()
  aggregateUuid!: string;

  @IsInt()
  @Min(1)
  aggregateVersion!: number;

  @IsISO8601()
  occurredAt!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
