import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';

import { DeliveryMessage } from '../delivery.entity';
import { DELIVERY_EVENT, DELIVERY_READY_EVENT } from '../delivery.constants';
import { DeliveryService } from '../service/delivery.service';
import { SocketTicketService } from '../service/socket-ticket.service';
import { ClusterGateway } from './cluster.gateway';
import { ConnectionGateway } from './connection.gateway';

const message: DeliveryMessage = {
  audience: { type: 'user', uuid: '3a4752e0-c56d-4d72-8976-28438f680fb8' },
  deliveryId: '5a943eb6-4d4f-4c11-9962-08cf45e1697e',
  eventType: 'product.import.progressed.v1',
  expiresAt: '2099-08-08T12:00:00.000Z',
  occurredAt: '2026-08-08T12:00:00.000Z',
  payload: { progress: 50 },
  schemaVersion: 1,
  sequence: '12',
};

describe(ConnectionGateway.name, () => {
  const room = 'user:3a4752e0-c56d-4d72-8976-28438f680fb8';

  it('replays persisted deliveries before announcing readiness', async () => {
    const delivery = {
      cursors: jest.fn().mockResolvedValue({ [room]: '0' }),
      highWatermarks: jest.fn().mockResolvedValue({ [room]: '12' }),
      replay: jest.fn().mockResolvedValue([message]),
    };
    const gateway = createGateway(delivery);
    const client = socket();

    await gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith([room]);
    expect(client.emit).toHaveBeenNthCalledWith(1, DELIVERY_EVENT, message);
    expect(client.emit).toHaveBeenNthCalledWith(2, DELIVERY_READY_EVENT, {
      cursors: { [room]: '0' },
      watermarks: { [room]: '12' },
    });
  });

  it('persists only acknowledgements that were actually delivered', async () => {
    const acknowledge = jest.fn().mockResolvedValue(undefined);
    const gateway = createGateway({ acknowledge });
    const client = socket();
    client.data.delivery = {
      cursors: { [room]: '10' },
      lastSent: { [room]: '12' },
      pending: new Map(),
      principal: {
        rooms: [],
        sessionUuid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
        userUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
      },
      replaying: false,
      rooms: [room],
    };

    await expect(gateway.acknowledge(client, { room, sequence: '12' })).resolves.toEqual({ room, sequence: '12' });
    expect(acknowledge).toHaveBeenCalledWith(
      '09edcfbd-b192-4fc9-a703-f5bf84a67386',
      '3a4752e0-c56d-4d72-8976-28438f680fb8',
      room,
      '12',
    );
  });

  function createGateway(delivery: Partial<DeliveryService>): ConnectionGateway {
    const cluster = { subscribe: jest.fn().mockReturnValue(jest.fn()) };
    const tickets = {
      verify: jest.fn().mockResolvedValue({
        rooms: [],
        sessionUuid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
        userUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
      }),
    };
    return new ConnectionGateway(
      cluster as unknown as ClusterGateway,
      new ConfigService({ DELIVERY_REPLAY_PENDING_MAX: 2000 }),
      delivery as DeliveryService,
      tickets as unknown as SocketTicketService,
    );
  }

  function socket(): Socket {
    return {
      data: {},
      disconnect: jest.fn(),
      emit: jest.fn(),
      handshake: { auth: { ticket: 'ticket' } },
      id: 'socket-1',
      join: jest.fn().mockResolvedValue(undefined),
    } as unknown as Socket;
  }
});
