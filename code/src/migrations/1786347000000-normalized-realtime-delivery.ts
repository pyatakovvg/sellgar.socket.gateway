import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizedRealtimeDelivery1786347000000 implements MigrationInterface {
  name = 'NormalizedRealtimeDelivery1786347000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM delivery_event
      WHERE
        (
          event_type = 'product.updated'
          AND NOT (
            payload ? 'uuid'
            AND payload ? 'brand'
            AND payload ? 'category'
            AND payload ? 'variants'
          )
        )
        OR
        (
          event_type = 'store.product.updated'
          AND NOT (
            payload ? 'uuid'
            AND payload ? 'shop'
            AND payload ? 'product'
            AND payload ? 'offers'
          )
        )
    `);
  }

  async down(): Promise<void> {
    // Retained realtime deliveries are derived data and cannot be reconstructed
    // from the former UUID/version-only payload after deletion.
  }
}
