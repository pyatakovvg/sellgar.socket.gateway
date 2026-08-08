import { IsIn, IsInt, IsISO8601, IsObject, IsString, IsUUID, Min } from 'class-validator';

export class StoreProductUpdatedEventDto {
  @IsUUID()
  eventUuid!: string;

  @IsIn(['store.product.updated'])
  eventType!: 'store.product.updated';

  @IsInt()
  @Min(1)
  schemaVersion!: number;

  @IsString()
  producer!: string;

  @IsIn(['store_product'])
  aggregateType!: 'store_product';

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
