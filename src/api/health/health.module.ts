import { Module } from '@nestjs/common';

import { DeliveryModule } from '@/api/v1/delivery/delivery.module';
import { HealthController } from './health.controller';

@Module({ imports: [DeliveryModule], controllers: [HealthController] })
export class HealthModule {}
