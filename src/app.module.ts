import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from '@/config/env.validation';
import { HealthModule } from '@/health/health.module';
import { RealtimeModule } from '@/realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['gateways/socket/.env', './.env'],
      cache: true,
      isGlobal: true,
      validate: validateEnv,
    }),
    HealthModule,
    RealtimeModule,
  ],
})
export class AppModule {}
