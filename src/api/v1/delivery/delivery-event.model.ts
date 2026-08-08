import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { DeliveryAudienceType } from './controller/dto/delivery-request.dto';

@Entity('delivery_event')
@Index(['audienceRoom', 'sequence'])
@Index(['expiresAt'])
export class DeliveryEventModel {
  @PrimaryGeneratedColumn('increment', { name: 'sequence', type: 'bigint' })
  sequence!: string;

  @Column({ name: 'event_uuid', type: 'uuid', unique: true })
  eventUuid!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 256 })
  eventType!: string;

  @Column({ name: 'schema_version', type: 'int' })
  schemaVersion!: number;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'audience_type', type: 'varchar', length: 32 })
  audienceType!: DeliveryAudienceType;

  @Column({ name: 'audience_uuid', type: 'uuid', nullable: true })
  audienceUuid!: string | null;

  @Column({ name: 'audience_room', type: 'varchar', length: 80 })
  audienceRoom!: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
}
