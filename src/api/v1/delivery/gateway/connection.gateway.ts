import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';

import { DeliveryMessage, deliveryRoom } from '../delivery.entity';
import {
  BROADCAST_ROOM,
  CONNECTION_ERROR_EVENT,
  DELIVERY_ACK_EVENT,
  DELIVERY_EVENT,
  DELIVERY_READY_EVENT,
} from '../delivery.constants';
import { DeliveryService } from '../service/delivery.service';
import { SocketPrincipal, SocketTicketService } from '../service/socket-ticket.service';
import { ClusterGateway } from './cluster.gateway';
import { DeliveryAckDto } from './dto/delivery-ack.dto';

interface ConnectionDeliveryState {
  principal: SocketPrincipal;
  rooms: string[];
  cursors: Record<string, string>;
  lastSent: Record<string, string>;
  replaying: boolean;
  pending: Map<string, DeliveryMessage>;
}

@WebSocketGateway({ namespace: '/realtime', transports: ['websocket'] })
export class ConnectionGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private server!: Namespace;

  private readonly logger = new Logger(ConnectionGateway.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly cluster: ClusterGateway,
    private readonly config: ConfigService,
    private readonly delivery: DeliveryService,
    private readonly tickets: SocketTicketService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.cluster.subscribe((message) => this.dispatch(message));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  async handleConnection(client: Socket): Promise<void> {
    let principal: SocketPrincipal;
    try {
      principal = await this.tickets.verify(client.handshake.auth?.ticket);
    } catch {
      client.emit(CONNECTION_ERROR_EVENT, { code: 'UNAUTHORIZED' });
      client.disconnect(true);
      return;
    }

    try {
      const rooms = [BROADCAST_ROOM, `user:${principal.userUuid}`, ...principal.rooms];
      const cursors = await this.delivery.cursors(principal.sessionUuid, principal.userUuid, rooms);
      const state: ConnectionDeliveryState = {
        principal,
        rooms,
        cursors,
        lastSent: { ...cursors },
        replaying: true,
        pending: new Map(),
      };
      client.data.delivery = state;

      await client.join(rooms);
      const watermarks = await this.delivery.highWatermarks(rooms);
      await this.replay(client, state, watermarks);
      state.replaying = false;
      this.flushPending(client, state);
      client.emit(DELIVERY_READY_EVENT, { cursors: state.cursors, watermarks });
      this.logger.debug(`Connected socket ${client.id} for session ${principal.sessionUuid}`);
    } catch (error) {
      this.logger.error(`Failed to recover socket ${client.id}`, error instanceof Error ? error.stack : undefined);
      client.emit(CONNECTION_ERROR_EVENT, { code: 'DELIVERY_UNAVAILABLE' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Disconnected socket ${client.id}`);
  }

  @SubscribeMessage(DELIVERY_ACK_EVENT)
  async acknowledge(
    @ConnectedSocket() client: Socket,
    @MessageBody() acknowledgement: DeliveryAckDto,
  ): Promise<{ room: string; sequence: string }> {
    const state = this.state(client);
    if (!state.rooms.includes(acknowledgement.room)) {
      throw new WsException('ACK room is not authorized');
    }

    const lastSent = state.lastSent[acknowledgement.room] ?? '0';
    if (BigInt(acknowledgement.sequence) > BigInt(lastSent)) {
      throw new WsException('Cannot acknowledge an undelivered sequence');
    }

    const current = state.cursors[acknowledgement.room] ?? '0';
    if (BigInt(acknowledgement.sequence) > BigInt(current)) {
      await this.delivery.acknowledge(
        state.principal.sessionUuid,
        state.principal.userUuid,
        acknowledgement.room,
        acknowledgement.sequence,
      );
      state.cursors[acknowledgement.room] = acknowledgement.sequence;
    }

    return { room: acknowledgement.room, sequence: state.cursors[acknowledgement.room] };
  }

  async dispatch(message: DeliveryMessage): Promise<void> {
    if (new Date(message.expiresAt).getTime() <= Date.now()) {
      return;
    }

    const sockets = await this.server.in(deliveryRoom(message)).fetchSockets();
    for (const socket of sockets) {
      const state = this.optionalState(socket as unknown as Socket);
      if (!state) {
        continue;
      }

      if (state.replaying) {
        state.pending.set(`${deliveryRoom(message)}:${message.sequence}`, message);
        if (state.pending.size > this.config.getOrThrow<number>('DELIVERY_REPLAY_PENDING_MAX')) {
          socket.emit(CONNECTION_ERROR_EVENT, { code: 'REPLAY_OVERFLOW' });
          socket.disconnect(true);
        }
        continue;
      }

      this.emitDelivery(socket as unknown as Socket, state, message);
    }
  }

  private async replay(
    client: Socket,
    state: ConnectionDeliveryState,
    watermarks: Record<string, string>,
  ): Promise<void> {
    for (const room of state.rooms) {
      const watermark = watermarks[room] ?? '0';
      let after = state.cursors[room] ?? '0';

      while (BigInt(after) < BigInt(watermark)) {
        const messages = await this.delivery.replay([room], after, watermark);
        if (messages.length === 0) {
          break;
        }
        for (const message of messages) {
          this.emitDelivery(client, state, message);
          after = message.sequence;
        }
      }
    }
  }

  private flushPending(client: Socket, state: ConnectionDeliveryState): void {
    const messages = [...state.pending.values()].sort((left, right) => {
      const roomOrder = deliveryRoom(left).localeCompare(deliveryRoom(right));
      return roomOrder || (BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1);
    });
    state.pending.clear();
    for (const message of messages) {
      this.emitDelivery(client, state, message);
    }
  }

  private emitDelivery(client: Socket, state: ConnectionDeliveryState, message: DeliveryMessage): void {
    const room = deliveryRoom(message);
    const lastSent = state.lastSent[room] ?? '0';
    if (BigInt(message.sequence) <= BigInt(lastSent)) {
      return;
    }
    client.emit(DELIVERY_EVENT, message);
    state.lastSent[room] = message.sequence;
  }

  private state(client: Socket): ConnectionDeliveryState {
    const state = this.optionalState(client);
    if (!state) {
      throw new WsException('Socket delivery state is not initialized');
    }
    return state;
  }

  private optionalState(client: Socket): ConnectionDeliveryState | undefined {
    return client.data.delivery as ConnectionDeliveryState | undefined;
  }
}
