import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { DeliveryOutboxMetrics, DeliveryRepository } from '@/api/v1/delivery/repository/delivery.repository';

interface HealthResponse {
  service: string;
  status: 'ok' | 'degraded';
  database: 'up';
  outbox: DeliveryOutboxMetrics;
}

@Controller('health')
export class HealthController {
  constructor(private readonly delivery: DeliveryRepository) {}

  @Get()
  async health(): Promise<HealthResponse> {
    try {
      await this.delivery.databaseReady();
      const outbox = await this.delivery.outboxMetrics();
      return {
        service: 'sellgar.socket.gateway',
        status: outbox.dead > 0 ? 'degraded' : 'ok',
        database: 'up',
        outbox,
      };
    } catch {
      throw new ServiceUnavailableException({
        service: 'sellgar.socket.gateway',
        status: 'down',
        database: 'down',
      });
    }
  }
}
