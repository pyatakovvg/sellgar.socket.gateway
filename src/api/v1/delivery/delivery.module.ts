import { CategoriesConnectionGateway } from './gateway/categories-connection.gateway';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { IDENTITY_COMMAND_SERVICE } from './delivery.constants';
import { CartsConnectionGateway } from './gateway/carts-connection.gateway';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeliveryController } from './controller/delivery.controller';
import { DeliveryCursorModel } from './delivery-cursor.model';
import { DeliveryEventModel } from './delivery-event.model';
import { DeliveryOutboxModel } from './delivery-outbox.model';
import { ClusterGateway } from './gateway/cluster.gateway';
import { ProductsConnectionGateway } from './gateway/products-connection.gateway';
import { StoreConnectionGateway } from './gateway/store-connection.gateway';
import { DeliveryRepository } from './repository/delivery.repository';
import { DeliveryOutboxRelayService } from './service/delivery-outbox-relay.service';
import { DeliveryRetentionService } from './service/delivery-retention.service';
import { DeliveryService } from './service/delivery.service';
import { SocketTicketService } from './service/socket-ticket.service';

@Module({
  imports: [
    JwtModule.register({}),
    ClientsModule.registerAsync({
      clients: [
        {
          name: IDENTITY_COMMAND_SERVICE,
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            transport: Transport.RMQ,
            options: {
              urls: [
                {
                  hostname: config.getOrThrow('AMQP_HOSTNAME'),
                  port: config.getOrThrow('AMQP_PORT'),
                  username: config.getOrThrow('AMQP_USERNAME'),
                  password: config.getOrThrow('AMQP_PASSWORD'),
                },
              ],
              queue: config.getOrThrow<string>('AMQP_IDENTITY_SRV_COMMAND_QUEUE'),
              queueOptions: { durable: true },
            },
          }),
        },
      ],
    }),
    TypeOrmModule.forFeature([DeliveryEventModel, DeliveryOutboxModel, DeliveryCursorModel]),
  ],
  controllers: [DeliveryController],
  providers: [
    ClusterGateway,
    ProductsConnectionGateway,
    StoreConnectionGateway,
    CategoriesConnectionGateway,
    CartsConnectionGateway,
    DeliveryService,
    DeliveryRepository,
    DeliveryOutboxRelayService,
    DeliveryRetentionService,
    SocketTicketService,
  ],
  exports: [DeliveryService, DeliveryRepository],
})
export class DeliveryModule {}
