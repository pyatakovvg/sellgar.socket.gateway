import { MigrationInterface, QueryRunner } from 'typeorm';

export class BroadcastDelivery1786201000000 implements MigrationInterface {
  name = 'BroadcastDelivery1786201000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE delivery_event DROP CONSTRAINT delivery_event_audience_type_check');
    await queryRunner.query('ALTER TABLE delivery_event ALTER COLUMN audience_uuid DROP NOT NULL');
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

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM delivery_cursor WHERE audience_room = 'broadcast'");
    await queryRunner.query("DELETE FROM delivery_event WHERE audience_type = 'broadcast'");
    await queryRunner.query('ALTER TABLE delivery_event DROP CONSTRAINT delivery_event_audience_shape_check');
    await queryRunner.query('ALTER TABLE delivery_event DROP CONSTRAINT delivery_event_audience_type_check');
    await queryRunner.query('ALTER TABLE delivery_event ALTER COLUMN audience_uuid SET NOT NULL');
    await queryRunner.query(`
      ALTER TABLE delivery_event
      ADD CONSTRAINT delivery_event_audience_type_check
        CHECK (audience_type IN ('user', 'tenant', 'shop', 'job'))
    `);
  }
}
