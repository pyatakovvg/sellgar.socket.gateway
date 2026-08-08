import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('delivery_cursor')
@Index(['userUuid'])
export class DeliveryCursorModel {
  @PrimaryColumn('uuid', { name: 'session_uuid' })
  sessionUuid!: string;

  @PrimaryColumn({ name: 'audience_room', type: 'varchar', length: 80 })
  audienceRoom!: string;

  @Column({ name: 'user_uuid', type: 'uuid' })
  userUuid!: string;

  @Column({ type: 'bigint', default: '0' })
  sequence!: string;

  @UpdateDateColumn({ name: 'acknowledged_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  acknowledgedAt!: Date;
}
