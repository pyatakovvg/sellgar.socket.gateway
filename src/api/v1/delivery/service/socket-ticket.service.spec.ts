import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { SocketTicketService } from './socket-ticket.service';

describe(SocketTicketService.name, () => {
  const secret = 'a-secret-that-is-longer-than-32-characters';
  const jwt = new JwtService();
  const service = new SocketTicketService(
    new ConfigService({
      SOCKET_TICKET_AUDIENCE: 'realtime',
      SOCKET_TICKET_SECRET: secret,
    }),
    jwt,
  );

  it('accepts a signed user ticket with server-controlled rooms', async () => {
    const token = await jwt.signAsync(
      {
        rooms: ['tenant:cb447bf9-6d67-47da-8d42-a950648668ab'],
        sid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
        sub: '3a4752e0-c56d-4d72-8976-28438f680fb8',
      },
      { audience: 'realtime', expiresIn: '1m', secret },
    );

    await expect(service.verify(token)).resolves.toEqual({
      rooms: ['tenant:cb447bf9-6d67-47da-8d42-a950648668ab'],
      sessionUuid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
      userUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
    });
  });

  it('rejects rooms outside the signed room contract', async () => {
    const token = await jwt.signAsync(
      {
        rooms: ['user:someone-else'],
        sid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
        sub: '3a4752e0-c56d-4d72-8976-28438f680fb8',
      },
      { audience: 'realtime', expiresIn: '1m', secret },
    );

    await expect(service.verify(token)).rejects.toThrow('Invalid socket ticket rooms');
  });

  it('requires a stable identity session for durable cursors', async () => {
    const token = await jwt.signAsync(
      { sub: '3a4752e0-c56d-4d72-8976-28438f680fb8' },
      { audience: 'realtime', expiresIn: '1m', secret },
    );

    await expect(service.verify(token)).rejects.toThrow('Invalid socket ticket session');
  });
});
