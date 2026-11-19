import { MigrationInterface, QueryRunner } from 'typeorm';

export class GuestSessionCursors1794870001000 implements MigrationInterface {
  name = 'GuestSessionCursors1794870001000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE delivery_cursor ALTER COLUMN user_uuid DROP NOT NULL');
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DELETE FROM delivery_cursor WHERE user_uuid IS NULL');
    await runner.query('ALTER TABLE delivery_cursor ALTER COLUMN user_uuid SET NOT NULL');
  }
}
