import { ConfigService } from '@nestjs/config';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { Server, Socket } from 'socket.io';

import { DeliveryMessage } from '../delivery.entity';
import { DELIVERY_EVENT, DELIVERY_READY_EVENT } from '../delivery.constants';
import { DeliveryService } from '../service/delivery.service';
import { SocketTicketService } from '../service/socket-ticket.service';
import { ClusterGateway } from './cluster.gateway';
import { ConnectionGateway } from './connection.gateway';
import { ProductsConnectionGateway } from './products-connection.gateway';
import { StoreConnectionGateway } from './store-connection.gateway';

const message: DeliveryMessage = {
  channel: 'products',
  deliveryId: '5a943eb6-4d4f-4c11-9962-08cf45e1697e',
  eventType: 'product.updated',
  expiresAt: '2099-08-08T12:00:00.000Z',
  occurredAt: '2026-08-08T12:00:00.000Z',
  payload: { productUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8', version: 7 },
  schemaVersion: 1,
  sequence: '12',
};

describe(ConnectionGateway.name, () => {
  it('uses separate Engine.IO paths for products and store', () => {
    expect(Reflect.getMetadata(GATEWAY_OPTIONS, ProductsConnectionGateway)).toEqual(
      expect.objectContaining({ addTrailingSlash: false, path: '/socket.io/products' }),
    );
    expect(Reflect.getMetadata(GATEWAY_OPTIONS, StoreConnectionGateway)).toEqual(
      expect.objectContaining({ addTrailingSlash: false, path: '/socket.io/store' }),
    );
  });

  it('rejects the transport handshake when the ticket is invalid', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('Unauthorized'));
    const gateway = createGateway({}, verify);
    let middleware: ((client: Socket, next: (error?: Error) => void) => void) | undefined;
    const server = {
      use: jest.fn((handler) => {
        middleware = handler;
      }),
    } as unknown as Server;

    gateway.afterInit(server);

    const next = jest.fn();
    await new Promise<void>((resolve) => {
      middleware?.(socket(), (error?: Error) => {
        next(error);
        resolve();
      });
    });

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { code: 'UNAUTHORIZED' },
      }),
    );
  });

  it('replays only the physical connection channel before announcing readiness', async () => {
    const delivery = {
      cursor: jest.fn().mockResolvedValue('0'),
      highWatermark: jest.fn().mockResolvedValue('12'),
      replay: jest.fn().mockResolvedValue([message]),
    };
    const gateway = createGateway(delivery);
    const client = socket();

    await gateway.handleConnection(client);

    expect(delivery.cursor).toHaveBeenCalledWith(
      '09edcfbd-b192-4fc9-a703-f5bf84a67386',
      '3a4752e0-c56d-4d72-8976-28438f680fb8',
      'products',
    );
    expect(delivery.replay).toHaveBeenCalledWith('products', '0', '12');
    expect(client.emit).toHaveBeenNthCalledWith(1, DELIVERY_EVENT, message);
    expect(client.emit).toHaveBeenNthCalledWith(2, DELIVERY_READY_EVENT, {
      channel: 'products',
      cursor: '0',
      watermark: '12',
    });
  });

  it('uses the store connection as an independent offers channel', async () => {
    const delivery = {
      cursor: jest.fn().mockResolvedValue('4'),
      highWatermark: jest.fn().mockResolvedValue('4'),
      replay: jest.fn(),
    };
    const gateway = createGateway(delivery, undefined, 'offers');

    await gateway.handleConnection(socket());

    expect(delivery.cursor).toHaveBeenCalledWith(
      '09edcfbd-b192-4fc9-a703-f5bf84a67386',
      '3a4752e0-c56d-4d72-8976-28438f680fb8',
      'offers',
    );
    expect(delivery.replay).not.toHaveBeenCalled();
  });

  it('dispatches a live event only through its physical connection', async () => {
    const gateway = createGateway({});
    const client = socket();
    client.data.delivery = {
      channel: 'products',
      cursor: '10',
      lastSent: '10',
      pending: new Map(),
      principal: client.data.principal,
      replaying: false,
    };
    const fetchSockets = jest.fn().mockResolvedValue([client]);
    Object.assign(gateway, { server: { fetchSockets } });

    await gateway.dispatch(message);

    expect(fetchSockets).toHaveBeenCalledTimes(1);
    expect(client.emit).toHaveBeenCalledWith(DELIVERY_EVENT, message);
  });

  it('persists only acknowledgements that were delivered on the connection channel', async () => {
    const acknowledge = jest.fn().mockResolvedValue(undefined);
    const gateway = createGateway({ acknowledge });
    const client = socket();
    client.data.delivery = {
      channel: 'products',
      cursor: '10',
      lastSent: '12',
      pending: new Map(),
      principal: {
        sessionUuid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
        userUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
      },
      replaying: false,
    };

    await expect(gateway.acknowledge(client, { sequence: '12' })).resolves.toEqual({ sequence: '12' });
    expect(acknowledge).toHaveBeenCalledWith(
      '09edcfbd-b192-4fc9-a703-f5bf84a67386',
      '3a4752e0-c56d-4d72-8976-28438f680fb8',
      'products',
      '12',
    );
  });

  function createGateway(
    delivery: Partial<DeliveryService>,
    verify:
      | jest.Mock
      | undefined = jest.fn().mockResolvedValue({
      sessionUuid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
      userUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
    }),
    channel: 'offers' | 'products' = 'products',
  ): ConnectionGateway {
    const cluster = { subscribe: jest.fn().mockReturnValue(jest.fn()) };
    const tickets = { verify };
    return new ConnectionGateway(
      channel,
      cluster as unknown as ClusterGateway,
      new ConfigService({ DELIVERY_REPLAY_PENDING_MAX: 2000 }),
      delivery as DeliveryService,
      tickets as unknown as SocketTicketService,
    );
  }

  function socket(): Socket {
    return {
      data: {
        principal: {
          sessionUuid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
          userUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
        },
      },
      disconnect: jest.fn(),
      emit: jest.fn(),
      handshake: { auth: { ticket: 'ticket' } },
      id: 'socket-1',
      nsp: { name: '/' },
    } as unknown as Socket;
  }
});
