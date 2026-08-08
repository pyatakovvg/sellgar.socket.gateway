import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { SocketTicketService } from '@/realtime/auth/socket-ticket.service';
import { RealtimeGateway } from '@/realtime/gateway/realtime.gateway';
import { DELIVERY_INBOX } from '@/realtime/inbox/delivery-inbox';
import { InMemoryDeliveryInboxService } from '@/realtime/inbox/in-memory-delivery-inbox.service';
import { RealtimeDeliveryService } from '@/realtime/ingress/realtime-delivery.service';
import { RealtimeIngressController } from '@/realtime/ingress/realtime-ingress.controller';
import { RealtimeDispatchBridgeService } from '@/realtime/rabbit/realtime-dispatch-bridge.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [RealtimeIngressController],
  providers: [
    SocketTicketService,
    RealtimeGateway,
    RealtimeDispatchBridgeService,
    RealtimeDeliveryService,
    InMemoryDeliveryInboxService,
    {
      provide: DELIVERY_INBOX,
      useExisting: InMemoryDeliveryInboxService,
    },
  ],
})
export class RealtimeModule {}
