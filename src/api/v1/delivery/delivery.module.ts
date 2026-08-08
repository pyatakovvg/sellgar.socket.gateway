import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeliveryController } from './controller/delivery.controller';
import { DeliveryCursorModel } from './delivery-cursor.model';
import { DeliveryEventModel } from './delivery-event.model';
import { DeliveryOutboxModel } from './delivery-outbox.model';
import { ClusterGateway } from './gateway/cluster.gateway';
import { ConnectionGateway } from './gateway/connection.gateway';
import { DeliveryRepository } from './repository/delivery.repository';
import { DeliveryOutboxRelayService } from './service/delivery-outbox-relay.service';
import { DeliveryRetentionService } from './service/delivery-retention.service';
import { DeliveryService } from './service/delivery.service';
import { SocketTicketService } from './service/socket-ticket.service';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([DeliveryEventModel, DeliveryOutboxModel, DeliveryCursorModel]),
  ],
  controllers: [DeliveryController],
  providers: [
    ClusterGateway,
    ConnectionGateway,
    DeliveryService,
    DeliveryRepository,
    DeliveryOutboxRelayService,
    DeliveryRetentionService,
    SocketTicketService,
  ],
  exports: [DeliveryService, DeliveryRepository],
})
export class DeliveryModule {}
