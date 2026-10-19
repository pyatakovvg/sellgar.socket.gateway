import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';

export class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    return new Server(this.httpServer && port === 0 ? this.httpServer : port, {
      ...options,
      cors: { credentials: true, origin: this.origins },
      transports: ['websocket'],
    });
  }
}
