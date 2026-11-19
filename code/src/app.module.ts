import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HealthModule } from '@/api/health/health.module';
import { ApiV1Module } from '@/api/v1/api.module';
import { validateEnv } from '@/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['gateways/socket/.env', './.env'],
      cache: true,
      isGlobal: true,
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DATABASE_HOST'),
        port: config.getOrThrow<number>('DATABASE_PORT'),
        username: config.getOrThrow<string>('DATABASE_USERNAME'),
        password: config.getOrThrow<string>('DATABASE_PASSWORD'),
        database: config.getOrThrow<string>('DATABASE_DATABASE_NAME'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    ApiV1Module,
    HealthModule,
  ],
})
export class AppModule {}
