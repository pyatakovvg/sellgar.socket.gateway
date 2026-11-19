import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { IDENTITY_COMMAND_SERVICE } from '../delivery.constants';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export interface SocketPrincipal {
  sessionUuid: string;
  userUuid: string | null;
  ownerUuid?: string;
}

interface SocketTicketPayload {
  sub?: unknown;
  sid?: unknown;
  oid?: unknown;
  scope?: unknown;
  exp?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SocketTicketService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    @Inject(IDENTITY_COMMAND_SERVICE) private readonly identity: ClientProxy,
  ) {}

  async verify(ticket: unknown): Promise<SocketPrincipal> {
    if (typeof ticket !== 'string' || ticket.length === 0) {
      throw new UnauthorizedException('Missing socket ticket');
    }

    const payload = await this.jwt.verifyAsync<SocketTicketPayload>(ticket, {
      audience: this.config.getOrThrow<string>('SOCKET_TICKET_AUDIENCE'),
      secret: this.config.getOrThrow<string>('SOCKET_TICKET_SECRET'),
      algorithms: ['HS256'],
    });

    if (
      !(payload.sub === undefined && payload.scope === 'carts') &&
      (typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub))
    ) {
      throw new UnauthorizedException('Invalid socket ticket subject');
    }
    if (typeof payload.sid !== 'string' || !UUID_PATTERN.test(payload.sid)) {
      throw new UnauthorizedException('Invalid socket ticket session');
    }

    const principal: SocketPrincipal = {
      sessionUuid: payload.sid,
      userUuid: (payload.sub ?? null) as string | null,
    };
    if (payload.scope !== undefined || payload.oid !== undefined) {
      if (
        payload.scope !== 'carts' ||
        typeof payload.oid !== 'string' ||
        !UUID_PATTERN.test(payload.oid) ||
        typeof payload.exp !== 'number'
      ) {
        throw new UnauthorizedException('Invalid cart ticket scope');
      }
      principal.ownerUuid = payload.oid;
      await this.assertActive(principal);
    }
    return principal;
  }

  async assertActive(principal: SocketPrincipal): Promise<void> {
    if (!principal.ownerUuid) {
      throw new UnauthorizedException('Missing Cart owner');
    }
    const result = await firstValueFrom(
      this.identity.send({ cmd: 'identity.session.check' }, { sessionUuid: principal.sessionUuid }).pipe(timeout(5000)),
    );
    const data = result?.data;
    const expiresAt = typeof data?.expiresAt === 'string' ? Date.parse(data.expiresAt) : NaN;
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      data?.status !== 'active' ||
      data.sessionId !== principal.sessionUuid ||
      data.userId !== principal.userUuid ||
      data.ownerUuid !== principal.ownerUuid
    ) {
      throw new UnauthorizedException('Cart session is not active');
    }
  }
}
