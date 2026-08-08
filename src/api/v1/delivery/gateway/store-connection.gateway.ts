import { ConfigService } from '@nestjs/config';
import { WebSocketGateway } from '@nestjs/websockets';

import { STORE_SOCKET_PATH } from '../delivery.constants';
import { DeliveryService } from '../service/delivery.service';
import { SocketTicketService } from '../service/socket-ticket.service';
import { ClusterGateway } from './cluster.gateway';
import { ConnectionGateway } from './connection.gateway';

@WebSocketGateway({ addTrailingSlash: false, path: STORE_SOCKET_PATH, transports: ['websocket'] })
export class StoreConnectionGateway extends ConnectionGateway {
  constructor(
    cluster: ClusterGateway,
    config: ConfigService,
    delivery: DeliveryService,
    tickets: SocketTicketService,
  ) {
    super('offers', cluster, config, delivery, tickets);
  }
}
