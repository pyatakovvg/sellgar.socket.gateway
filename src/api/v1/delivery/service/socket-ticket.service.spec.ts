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

  it('accepts a signed user ticket with a stable session', async () => {
    const token = await jwt.signAsync(
      {
        sid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
        sub: '3a4752e0-c56d-4d72-8976-28438f680fb8',
      },
      { audience: 'realtime', expiresIn: '1m', secret },
    );

    await expect(service.verify(token)).resolves.toEqual({
      sessionUuid: '09edcfbd-b192-4fc9-a703-f5bf84a67386',
      userUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
    });
  });

  it('requires a stable identity session for durable cursors', async () => {
    const token = await jwt.signAsync(
      { sub: '3a4752e0-c56d-4d72-8976-28438f680fb8' },
      { audience: 'realtime', expiresIn: '1m', secret },
    );

    await expect(service.verify(token)).rejects.toThrow('Invalid socket ticket session');
  });
});
