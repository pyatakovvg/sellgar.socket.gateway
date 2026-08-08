import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export interface SocketPrincipal {
  sessionUuid: string;
  userUuid: string;
}

interface SocketTicketPayload {
  sub?: unknown;
  sid?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SocketTicketService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  async verify(ticket: unknown): Promise<SocketPrincipal> {
    if (typeof ticket !== 'string' || ticket.length === 0) {
      throw new UnauthorizedException('Missing socket ticket');
    }

    const payload = await this.jwt.verifyAsync<SocketTicketPayload>(ticket, {
      audience: this.config.getOrThrow<string>('SOCKET_TICKET_AUDIENCE'),
      secret: this.config.getOrThrow<string>('SOCKET_TICKET_SECRET'),
    });

    if (typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub)) {
      throw new UnauthorizedException('Invalid socket ticket subject');
    }
    if (typeof payload.sid !== 'string' || !UUID_PATTERN.test(payload.sid)) {
      throw new UnauthorizedException('Invalid socket ticket session');
    }

    return {
      sessionUuid: payload.sid,
      userUuid: payload.sub,
    };
  }
}
