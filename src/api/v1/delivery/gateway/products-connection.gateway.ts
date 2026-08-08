import { ConfigService } from '@nestjs/config';
import { WebSocketGateway } from '@nestjs/websockets';

import { PRODUCTS_SOCKET_PATH } from '../delivery.constants';
import { DeliveryService } from '../service/delivery.service';
import { SocketTicketService } from '../service/socket-ticket.service';
import { ClusterGateway } from './cluster.gateway';
import { ConnectionGateway } from './connection.gateway';

@WebSocketGateway({ addTrailingSlash: false, path: PRODUCTS_SOCKET_PATH, transports: ['websocket'] })
export class ProductsConnectionGateway extends ConnectionGateway {
  constructor(
    cluster: ClusterGateway,
    config: ConfigService,
    delivery: DeliveryService,
    tickets: SocketTicketService,
  ) {
    super('products', cluster, config, delivery, tickets);
  }
}
