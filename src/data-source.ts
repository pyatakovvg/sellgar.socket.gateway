import 'dotenv/config';
import { DataSource } from 'typeorm';

import { DeliveryCursorModel } from './api/v1/delivery/delivery-cursor.model';
import { DeliveryEventModel } from './api/v1/delivery/delivery-event.model';
import { DeliveryOutboxModel } from './api/v1/delivery/delivery-outbox.model';
import { DurableDelivery1786200000000 } from './migrations/1786200000000-durable-delivery';

declare const process: { env: Record<string, string | undefined> };

export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_DATABASE_NAME,
  entities: [DeliveryEventModel, DeliveryOutboxModel, DeliveryCursorModel],
  migrations: [DurableDelivery1786200000000],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});
