import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrivateCartDelivery1794850000000 implements MigrationInterface {
  name = 'PrivateCartDelivery1794850000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE delivery_event ADD COLUMN owner_uuid uuid');
    await runner.query(`ALTER TABLE delivery_event ADD CONSTRAINT delivery_event_owner_check
      CHECK ((channel='carts' AND owner_uuid IS NOT NULL) OR (channel<>'carts' AND owner_uuid IS NULL))`);
    await runner.query(
      'CREATE INDEX delivery_event_owner_sequence_idx ON delivery_event(owner_uuid,channel,sequence) WHERE owner_uuid IS NOT NULL',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query("DELETE FROM delivery_event WHERE channel='carts'");
    await runner.query('DROP INDEX delivery_event_owner_sequence_idx');
    await runner.query('ALTER TABLE delivery_event DROP CONSTRAINT delivery_event_owner_check');
    await runner.query('ALTER TABLE delivery_event DROP COLUMN owner_uuid');
  }
}
