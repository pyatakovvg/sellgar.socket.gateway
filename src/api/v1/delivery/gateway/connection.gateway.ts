import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import {
  CONNECTION_ERROR_EVENT,
  DELIVERY_ACK_EVENT,
  DeliveryChannel,
  DELIVERY_EVENT,
  DELIVERY_READY_EVENT,
} from '../delivery.constants';
import { DeliveryMessage } from '../delivery.entity';
import { DeliveryService } from '../service/delivery.service';
import { SocketPrincipal, SocketTicketService } from '../service/socket-ticket.service';
import { ClusterGateway } from './cluster.gateway';
import { DeliveryAckDto } from './dto/delivery-ack.dto';

interface ConnectionDeliveryState {
  principal: SocketPrincipal;
  channel: DeliveryChannel;
  cursor: string;
  lastSent: string;
  replaying: boolean;
  pending: Map<string, DeliveryMessage>;
}

export class ConnectionGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit, OnModuleDestroy
{
  private server!: Server;

  private readonly logger = new Logger(ConnectionGateway.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly channel: DeliveryChannel,
    private readonly cluster: ClusterGateway,
    private readonly config: ConfigService,
    private readonly delivery: DeliveryService,
    private readonly tickets: SocketTicketService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.cluster.subscribe((message) => this.dispatch(message));
  }

  afterInit(server: Server): void {
    this.server = server;
    server.use((client, next) => {
      void this.tickets
        .verify(client.handshake.auth?.ticket)
        .then((principal) => {
          client.data.principal = principal;
          next();
        })
        .catch(() => {
          const error = new Error('Unauthorized') as Error & { data: { code: string } };
          error.data = { code: 'UNAUTHORIZED' };
          next(error);
        });
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  async handleConnection(client: Socket): Promise<void> {
    const principal = client.data.principal as SocketPrincipal;

    try {
      const cursor = await this.delivery.cursor(principal.sessionUuid, principal.userUuid, this.channel);
      const state: ConnectionDeliveryState = {
        principal,
        channel: this.channel,
        cursor,
        lastSent: cursor,
        replaying: true,
        pending: new Map(),
      };
      client.data.delivery = state;

      const watermark = await this.delivery.highWatermark(this.channel);
      await this.replay(client, state, watermark);
      state.replaying = false;
      this.flushPending(client, state);
      client.emit(DELIVERY_READY_EVENT, { channel: this.channel, cursor: state.cursor, watermark });
      this.logger.debug(`Connected ${this.channel} socket ${client.id} for session ${principal.sessionUuid}`);
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
  ): Promise<{ sequence: string }> {
    const state = this.state(client);
    if (BigInt(acknowledgement.sequence) > BigInt(state.lastSent)) {
      throw new WsException('Cannot acknowledge an undelivered sequence');
    }

    if (BigInt(acknowledgement.sequence) > BigInt(state.cursor)) {
      await this.delivery.acknowledge(
        state.principal.sessionUuid,
        state.principal.userUuid,
        state.channel,
        acknowledgement.sequence,
      );
      state.cursor = acknowledgement.sequence;
    }

    return { sequence: state.cursor };
  }

  async dispatch(message: DeliveryMessage): Promise<void> {
    if (message.channel !== this.channel || new Date(message.expiresAt).getTime() <= Date.now()) {
      return;
    }

    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      const client = socket as unknown as Socket;
      const state = this.optionalState(client);
      if (!state || state.channel !== message.channel) {
        continue;
      }

      if (state.replaying) {
        state.pending.set(message.sequence, message);
        if (state.pending.size > this.config.getOrThrow<number>('DELIVERY_REPLAY_PENDING_MAX')) {
          socket.emit(CONNECTION_ERROR_EVENT, { code: 'REPLAY_OVERFLOW' });
          socket.disconnect(true);
        }
        continue;
      }

      this.emitDelivery(client, state, message);
    }
  }

  private async replay(client: Socket, state: ConnectionDeliveryState, watermark: string): Promise<void> {
    let after = state.cursor;
    while (BigInt(after) < BigInt(watermark)) {
      const messages = await this.delivery.replay(state.channel, after, watermark);
      if (messages.length === 0) {
        break;
      }
      for (const message of messages) {
        this.emitDelivery(client, state, message);
        after = message.sequence;
      }
    }
  }

  private flushPending(client: Socket, state: ConnectionDeliveryState): void {
    const messages = [...state.pending.values()].sort((left, right) =>
      BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1,
    );
    state.pending.clear();
    for (const message of messages) {
      this.emitDelivery(client, state, message);
    }
  }

  private emitDelivery(client: Socket, state: ConnectionDeliveryState, message: DeliveryMessage): void {
    if (message.channel !== state.channel || BigInt(message.sequence) <= BigInt(state.lastSent)) {
      return;
    }
    client.emit(DELIVERY_EVENT, message);
    state.lastSent = message.sequence;
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
