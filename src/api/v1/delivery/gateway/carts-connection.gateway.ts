import { ConfigService } from '@nestjs/config';
import { WebSocketGateway } from '@nestjs/websockets';

import { CARTS_SOCKET_PATH } from '../delivery.constants';
import { DeliveryService } from '../service/delivery.service';
import { SocketTicketService } from '../service/socket-ticket.service';
import { ClusterGateway } from './cluster.gateway';
import { ConnectionGateway } from './connection.gateway';

@WebSocketGateway({ addTrailingSlash: false, path: CARTS_SOCKET_PATH, transports: ['websocket'] })
export class CartsConnectionGateway extends ConnectionGateway {
  constructor(cluster: ClusterGateway, config: ConfigService, delivery: DeliveryService, tickets: SocketTicketService) {
    super('carts', cluster, config, delivery, tickets);
  }
}
