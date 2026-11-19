import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('delivery_outbox')
@Index(['status', 'nextAttemptAt', 'createdAt'])
export class DeliveryOutboxModel {
  @PrimaryColumn('uuid', { name: 'event_uuid' })
  eventUuid!: string;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  nextAttemptAt!: Date;

  @Column({ name: 'processing_started_at', type: 'timestamptz', nullable: true })
  processingStartedAt?: Date | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
}
