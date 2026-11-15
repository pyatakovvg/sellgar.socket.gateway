import { ConfigService } from "@nestjs/config";
import { WebSocketGateway } from "@nestjs/websockets";

import { CATEGORIES_SOCKET_PATH } from "../delivery.constants";
import { DeliveryService } from "../service/delivery.service";
import { SocketTicketService } from "../service/socket-ticket.service";
import { ClusterGateway } from "./cluster.gateway";
import { ConnectionGateway } from "./connection.gateway";

@WebSocketGateway({
  addTrailingSlash: false,
  path: CATEGORIES_SOCKET_PATH,
  transports: ["websocket"],
})
export class CategoriesConnectionGateway extends ConnectionGateway {
  constructor(
    cluster: ClusterGateway,
    config: ConfigService,
    delivery: DeliveryService,
    tickets: SocketTicketService,
  ) {
    super("categories", cluster, config, delivery, tickets);
  }
}
