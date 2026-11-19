import { of } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { SocketTicketService } from './socket-ticket.service';

describe(SocketTicketService.name, () => {
  const secret = 'a-secret-that-is-longer-than-32-characters';
  const jwt = new JwtService();
  const send = jest.fn();
  const service = new SocketTicketService(
    new ConfigService({
      SOCKET_TICKET_AUDIENCE: 'realtime',
      SOCKET_TICKET_SECRET: secret,
    }),
    jwt,
    { send } as never,
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

  it('checks Cart owner and account session against Identity instead of trusting claims alone', async () => {
    const userUuid = randomUUID(),
      ownerUuid = randomUUID(),
      sessionUuid = randomUUID();
    const token = await jwt.signAsync(
      { sub: userUuid, oid: ownerUuid, sid: sessionUuid, scope: 'carts' },
      { audience: 'realtime', expiresIn: 60, secret },
    );
    send.mockReturnValue(
      of({
        data: {
          status: 'active',
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          sessionId: sessionUuid,
          userId: userUuid,
          ownerUuid,
        },
      }),
    );
    await expect(service.verify(token)).resolves.toMatchObject({
      userUuid,
      ownerUuid,
      sessionUuid,
    });
    expect(send).toHaveBeenCalledWith({ cmd: 'identity.session.check' }, { sessionUuid });
    send.mockReturnValue(of({ data: { status: 'revoked' } }));
    await expect(service.verify(token)).rejects.toThrow('not active');
    send.mockReturnValue(
      of({
        data: {
          status: 'active',
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          sessionId: sessionUuid,
          userId: userUuid,
          ownerUuid: randomUUID(),
        },
      }),
    );
    await expect(service.verify(token)).rejects.toThrow('not active');
  });

  it('accepts a real guest only on the private Cart scope and checks its Identity owner', async () => {
    const ownerUuid = randomUUID(),
      sessionUuid = randomUUID();
    const token = await jwt.signAsync(
      { oid: ownerUuid, sid: sessionUuid, scope: 'carts' },
      { audience: 'realtime', expiresIn: 60, secret },
    );
    send.mockReturnValue(
      of({
        data: {
          status: 'active',
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          sessionId: sessionUuid,
          userId: null,
          ownerUuid,
        },
      }),
    );
    await expect(service.verify(token)).resolves.toMatchObject({
      userUuid: null,
      ownerUuid,
      sessionUuid,
    });
    const admin = await jwt.signAsync({ sub: null, sid: sessionUuid }, { audience: 'realtime', expiresIn: 60, secret });
    await expect(service.verify(admin)).rejects.toThrow('Invalid socket ticket subject');
    const invalidSubject = await jwt.signAsync(
      { sub: null, oid: ownerUuid, sid: sessionUuid, scope: 'carts' },
      { audience: 'realtime', expiresIn: 60, secret },
    );
    await expect(service.verify(invalidSubject)).rejects.toThrow('Invalid socket ticket subject');

    send.mockReturnValue(of({ data: { status: 'revoked' } }));
    await expect(service.verify(token)).rejects.toThrow('not active');
  });

  it('checks ticket expiry only on handshake, then follows Identity session validity and renewal', async () => {
    const principal = {
      sessionUuid: randomUUID(),
      userUuid: null,
      ownerUuid: randomUUID(),
      expiresAt: Date.now() - 1,
    };
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    send.mockReturnValue(
      of({
        data: {
          status: 'active',
          sessionId: principal.sessionUuid,
          userId: null,
          ownerUuid: principal.ownerUuid,
          expiresAt,
        },
      }),
    );
    await expect(service.assertActive(principal)).resolves.toBeUndefined();
    for (const expiry of [undefined, 'invalid', new Date(Date.now() - 1).toISOString()]) {
      send.mockReturnValue(
        of({
          data: {
            status: 'active',
            sessionId: principal.sessionUuid,
            userId: null,
            ownerUuid: principal.ownerUuid,
            expiresAt: expiry,
          },
        }),
      );
      await expect(service.assertActive(principal)).rejects.toThrow('not active');
    }
    const expiredTicket = await jwt.signAsync(
      { sid: principal.sessionUuid, oid: principal.ownerUuid, scope: 'carts' },
      { audience: 'realtime', expiresIn: -1, secret },
    );
    await expect(service.verify(expiredTicket)).rejects.toThrow('jwt expired');
  });

  it('requires a stable identity session for durable cursors', async () => {
    const token = await jwt.signAsync(
      { sub: '3a4752e0-c56d-4d72-8976-28438f680fb8' },
      { audience: 'realtime', expiresIn: '1m', secret },
    );

    await expect(service.verify(token)).rejects.toThrow('Invalid socket ticket session');
  });
});
