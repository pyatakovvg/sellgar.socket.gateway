import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RmqContext } from '@nestjs/microservices';
import { Server, Socket } from 'socket.io';
import { DeliveryController } from '../controller/delivery.controller';
import { DeliveryMessage } from '../delivery.entity';
import { DeliveryService } from '../service/delivery.service';
import { SocketTicketService } from '../service/socket-ticket.service';
import { ClusterGateway } from './cluster.gateway';
import { ConnectionGateway } from './connection.gateway';

const ownerA = randomUUID(),
  ownerB = randomUUID();
const message: DeliveryMessage = {
  channel: 'carts',
  ownerUuid: ownerA,
  deliveryId: randomUUID(),
  sequence: '12',
  eventType: 'cart.updated',
  schemaVersion: 1,
  occurredAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  payload: { cartUuid: randomUUID(), shopUuid: randomUUID() },
};
function socket(ownerUuid: string): Socket {
  const principal = {
    sessionUuid: randomUUID(),
    userUuid: randomUUID(),
    ownerUuid,
    expiresAt: Date.now() + 60000,
  };
  return {
    id: randomUUID(),
    data: {
      principal,
      delivery: {
        principal,
        channel: 'carts',
        cursor: '0',
        lastSent: '0',
        pending: new Map(),
        replaying: false,
      },
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket;
}
function gateway(delivery: object = {}, assertActive = jest.fn(async () => {})) {
  return new ConnectionGateway(
    'carts',
    { subscribe: jest.fn() } as unknown as ClusterGateway,
    new ConfigService({ DELIVERY_REPLAY_PENDING_MAX: 100 }),
    delivery as DeliveryService,
    { assertActive } as unknown as SocketTicketService,
  );
}
describe('Private Cart connection', () => {
  it('delivers live messages only to the owner and hides internal routing metadata', async () => {
    const own = socket(ownerA),
      foreign = socket(ownerB),
      subject = gateway();
    Object.assign(subject, {
      server: { fetchSockets: async () => [own, foreign] },
    });
    await subject.dispatch(message);
    expect(foreign.emit).not.toHaveBeenCalled();
    expect(own.emit).toHaveBeenCalledWith(
      'realtime.event.v1',
      expect.not.objectContaining({ ownerUuid: expect.anything() }),
    );
    expect(own.emit).toHaveBeenCalledWith(
      'realtime.event.v1',
      expect.objectContaining({ deliveryId: message.deliveryId }),
    );
  });
  it('keeps owner stream order while Identity checks complete asynchronously', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const assertActive = jest
      .fn()
      .mockImplementationOnce(() => {
        entered();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .mockResolvedValue(undefined);
    const own = socket(ownerA),
      subject = gateway({}, assertActive);
    Object.assign(subject, { server: { fetchSockets: async () => [own] } });
    const first = subject.dispatch(message);
    const second = subject.dispatch({
      ...message,
      sequence: '13',
      deliveryId: randomUUID(),
    });
    await started;
    expect(assertActive).toHaveBeenCalledTimes(1);
    expect(own.emit).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect((own.emit as jest.Mock).mock.calls.map(([, event]) => event.sequence)).toEqual(['12', '13']);
  });

  it('filters replay by the same owner and has a separate session cursor', async () => {
    const delivery = {
      cursor: jest.fn(async () => '0'),
      highWatermark: jest.fn(async () => '12'),
      replay: jest.fn(async () => [
        { ...message, sequence: '11' },
        { ...message, ownerUuid: ownerB },
      ]),
    };
    const own = socket(ownerA),
      subject = gateway(delivery);
    try {
      await subject.handleConnection(own);
      expect(delivery.cursor).toHaveBeenCalledWith(
        own.data.principal.sessionUuid,
        own.data.principal.userUuid,
        'carts',
      );
      expect(delivery.highWatermark).toHaveBeenCalledWith('carts', ownerA);
      expect(delivery.replay).toHaveBeenCalledWith('carts', '0', '12', ownerA);
      expect(own.emit).toHaveBeenCalledTimes(2);
      expect(own.emit).toHaveBeenCalledWith('realtime.event.v1', expect.objectContaining({ sequence: '11' }));
    } finally {
      subject.handleDisconnect(own);
    }
  });
  it('disconnects a revoked session before live delivery and leaves its cursor unchanged', async () => {
    const own = socket(ownerA),
      subject = gateway({}, jest.fn().mockRejectedValue(new Error('revoked')));
    Object.assign(subject, { server: { fetchSockets: async () => [own] } });
    await subject.dispatch(message);
    expect(own.disconnect).toHaveBeenCalledWith(true);
    expect(own.emit).not.toHaveBeenCalled();
    expect(own.data.delivery.lastSent).toBe('0');
  });
  it('keeps the normal connection lifecycle without a Cart expiry timer', async () => {
    jest.useFakeTimers();
    const own = socket(ownerA);
    const assertActive = jest.fn(async () => {});
    const subject = gateway({ cursor: async () => '0', highWatermark: async () => '0' }, assertActive);
    try {
      await subject.handleConnection(own);
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(60001);
      expect(own.disconnect).not.toHaveBeenCalled();
      expect(assertActive).not.toHaveBeenCalled();
    } finally {
      subject.handleDisconnect(own);
      jest.useRealTimers();
    }
  });

  it('rejects a broadcast admin ticket on the private Cart transport', async () => {
    const subject = gateway();
    Object.assign(subject, {
      tickets: {
        verify: async () => ({
          userUuid: randomUUID(),
          sessionUuid: randomUUID(),
        }),
      },
    });
    let middleware: (client: Socket, next: (error?: Error) => void) => void;
    subject.afterInit({
      use: (handler: (client: Socket, next: (error?: Error) => void) => void) => {
        middleware = handler;
      },
    } as unknown as Server);
    const own = socket(ownerA);
    Object.assign(own, { handshake: { auth: { ticket: 'signed' } } });
    const error = await new Promise<Error | undefined>((resolve) => middleware(own, resolve));
    expect(error?.message).toBe('Unauthorized');
  });
  it.each([{ channel: 'carts' }, { channel: 'products', ownerUuid: ownerA }])(
    'rejects invalid ingress audience %j before persistence',
    async (patch) => {
      const accept = jest.fn(),
        channel = { ack: jest.fn(), nack: jest.fn() };
      const controller = new DeliveryController({
        accept,
      } as unknown as DeliveryService);
      await controller.handle(
        {
          eventUuid: randomUUID(),
          eventType: 'cart.updated',
          schemaVersion: 1,
          occurredAt: new Date().toISOString(),
          payload: {},
          ...patch,
        },
        new RmqContext([{}, channel, 'realtime.delivery.requested.v1']),
      );
      expect(accept).not.toHaveBeenCalled();
      expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    },
  );
});
