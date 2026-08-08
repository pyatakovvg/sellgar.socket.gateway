import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';

import { SocketTicketService } from '@/realtime/auth/socket-ticket.service';
import {
  REALTIME_CLIENT_ERROR_EVENT,
  REALTIME_CLIENT_EVENT,
} from '@/realtime/contracts/realtime.constants';
import {
  audienceRoom,
  RealtimeDeliveryRequestedDto,
} from '@/realtime/contracts/realtime-delivery.dto';

@WebSocketGateway({ namespace: '/realtime', transports: ['websocket'] })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Namespace;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly tickets: SocketTicketService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const principal = await this.tickets.verify(client.handshake.auth?.ticket);
      client.data.principal = principal;
      await client.join([`user:${principal.userUuid}`, ...principal.rooms]);
      this.logger.debug(`Connected socket ${client.id}`);
    } catch {
      client.emit(REALTIME_CLIENT_ERROR_EVENT, { code: 'UNAUTHORIZED' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Disconnected socket ${client.id}`);
  }

  dispatch(event: RealtimeDeliveryRequestedDto): void {
    this.server.to(audienceRoom(event.audience)).emit(REALTIME_CLIENT_EVENT, event);
  }
}
