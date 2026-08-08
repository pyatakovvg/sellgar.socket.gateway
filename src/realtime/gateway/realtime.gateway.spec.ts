import { Socket } from 'socket.io';

import { SocketTicketService } from '@/realtime/auth/socket-ticket.service';
import { REALTIME_CLIENT_EVENT } from '@/realtime/contracts/realtime.constants';
import { RealtimeDeliveryRequestedDto } from '@/realtime/contracts/realtime-delivery.dto';
import { RealtimeGateway } from './realtime.gateway';

describe(RealtimeGateway.name, () => {
  it('routes a delivery to the server-controlled audience room', () => {
    const roomEmitter = { emit: jest.fn() };
    const server = { to: jest.fn().mockReturnValue(roomEmitter) };
    const gateway = new RealtimeGateway({} as SocketTicketService);
    Object.assign(gateway, { server });

    const event: RealtimeDeliveryRequestedDto = {
      audience: { type: 'user', uuid: '3a4752e0-c56d-4d72-8976-28438f680fb8' },
      eventType: 'product.import.progressed.v1',
      eventUuid: '5a943eb6-4d4f-4c11-9962-08cf45e1697e',
      occurredAt: '2026-08-08T12:00:00.000Z',
      payload: { progress: 50 },
      schemaVersion: 1,
    };

    gateway.dispatch(event);

    expect(server.to).toHaveBeenCalledWith('user:3a4752e0-c56d-4d72-8976-28438f680fb8');
    expect(roomEmitter.emit).toHaveBeenCalledWith(REALTIME_CLIENT_EVENT, event);
  });

  it('disconnects a client when ticket verification fails', async () => {
    const tickets = { verify: jest.fn().mockRejectedValue(new Error('invalid')) };
    const gateway = new RealtimeGateway(tickets as unknown as SocketTicketService);
    const client = {
      disconnect: jest.fn(),
      emit: jest.fn(),
      handshake: { auth: {} },
      id: 'socket-1',
    } as unknown as Socket;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});
