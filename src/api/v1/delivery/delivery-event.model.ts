import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { DeliveryChannel } from './delivery.constants';

@Entity('delivery_event')
@Index(['channel', 'sequence'])
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

  @Column({ type: 'varchar', length: 80 })
  channel!: DeliveryChannel;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
}
