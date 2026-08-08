import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChannelDelivery1786202000000 implements MigrationInterface {
  name = 'ChannelDelivery1786202000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE delivery_event DROP CONSTRAINT delivery_event_audience_shape_check');
    await queryRunner.query('ALTER TABLE delivery_event DROP CONSTRAINT delivery_event_audience_type_check');
    await queryRunner.query('DROP INDEX delivery_event_audience_sequence_idx');
    await queryRunner.query('ALTER TABLE delivery_event RENAME COLUMN audience_room TO channel');
    await queryRunner.query(`
      UPDATE delivery_event
      SET channel = CASE
        WHEN event_type = 'product.updated' THEN 'products'
        WHEN event_type = 'store.product.updated' THEN 'offers'
        ELSE channel
      END
    `);
    await queryRunner.query('ALTER TABLE delivery_event DROP COLUMN audience_type');
    await queryRunner.query('ALTER TABLE delivery_event DROP COLUMN audience_uuid');
    await queryRunner.query('CREATE INDEX delivery_event_channel_sequence_idx ON delivery_event (channel, sequence)');

    await queryRunner.query('ALTER TABLE delivery_cursor RENAME COLUMN audience_room TO channel');
    await queryRunner.query(`
      INSERT INTO delivery_cursor (session_uuid, channel, user_uuid, sequence, acknowledged_at)
      SELECT
        session_uuid,
        channels.channel,
        user_uuid,
        MAX(sequence),
        MAX(acknowledged_at)
      FROM delivery_cursor
      CROSS JOIN (VALUES ('products'), ('offers')) AS channels(channel)
      GROUP BY session_uuid, channels.channel, user_uuid
      ON CONFLICT (session_uuid, channel) DO UPDATE
      SET sequence = GREATEST(delivery_cursor.sequence, EXCLUDED.sequence)
    `);
    await queryRunner.query("DELETE FROM delivery_cursor WHERE channel NOT IN ('products', 'offers')");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO delivery_cursor (session_uuid, channel, user_uuid, sequence, acknowledged_at)
      SELECT session_uuid, 'broadcast', user_uuid, MAX(sequence), MAX(acknowledged_at)
      FROM delivery_cursor
      WHERE channel IN ('products', 'offers')
      GROUP BY session_uuid, user_uuid
      ON CONFLICT (session_uuid, channel) DO UPDATE
      SET sequence = GREATEST(delivery_cursor.sequence, EXCLUDED.sequence)
    `);
    await queryRunner.query("DELETE FROM delivery_cursor WHERE channel IN ('products', 'offers')");
    await queryRunner.query('ALTER TABLE delivery_cursor RENAME COLUMN channel TO audience_room');

    await queryRunner.query('DROP INDEX delivery_event_channel_sequence_idx');
    await queryRunner.query("ALTER TABLE delivery_event ADD COLUMN audience_type VARCHAR(32) NOT NULL DEFAULT 'broadcast'");
    await queryRunner.query('ALTER TABLE delivery_event ADD COLUMN audience_uuid UUID NULL');
    await queryRunner.query('ALTER TABLE delivery_event RENAME COLUMN channel TO audience_room');
    await queryRunner.query("UPDATE delivery_event SET audience_room = 'broadcast'");
    await queryRunner.query(
      'CREATE INDEX delivery_event_audience_sequence_idx ON delivery_event (audience_room, sequence)',
    );
    await queryRunner.query(`
      ALTER TABLE delivery_event
      ADD CONSTRAINT delivery_event_audience_type_check
        CHECK (audience_type IN ('broadcast', 'user', 'tenant', 'shop', 'job'))
    `);
    await queryRunner.query(`
      ALTER TABLE delivery_event
      ADD CONSTRAINT delivery_event_audience_shape_check
        CHECK (
          (audience_type = 'broadcast' AND audience_uuid IS NULL AND audience_room = 'broadcast')
          OR
          (audience_type <> 'broadcast' AND audience_uuid IS NOT NULL)
        )
    `);
  }
}
