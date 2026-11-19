import { Module } from '@nestjs/common';

import { DeliveryModule } from './delivery/delivery.module';

@Module({ imports: [DeliveryModule] })
export class ApiV1Module {}
