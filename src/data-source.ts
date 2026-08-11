import 'dotenv/config';
import { DataSource } from 'typeorm';

import { DeliveryCursorModel } from './api/v1/delivery/delivery-cursor.model';
import { DeliveryEventModel } from './api/v1/delivery/delivery-event.model';
import { DeliveryOutboxModel } from './api/v1/delivery/delivery-outbox.model';
import { DurableDelivery1786200000000 } from './migrations/1786200000000-durable-delivery';
import { BroadcastDelivery1786201000000 } from './migrations/1786201000000-broadcast-delivery';
import { ChannelDelivery1786202000000 } from './migrations/1786202000000-channel-delivery';
import { NormalizedRealtimeDelivery1786347000000 } from './migrations/1786347000000-normalized-realtime-delivery';

declare const process: { env: Record<string, string | undefined> };

export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_DATABASE_NAME,
  entities: [DeliveryEventModel, DeliveryOutboxModel, DeliveryCursorModel],
  migrations: [
    DurableDelivery1786200000000,
    BroadcastDelivery1786201000000,
    ChannelDelivery1786202000000,
    NormalizedRealtimeDelivery1786347000000,
  ],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});
