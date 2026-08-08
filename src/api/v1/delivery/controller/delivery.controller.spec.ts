import { RmqContext } from '@nestjs/microservices';

import { DeliveryService } from '../service/delivery.service';
import { DeliveryController } from './delivery.controller';

describe(DeliveryController.name, () => {
  it('maps product.updated to a durable broadcast delivery before acknowledging RabbitMQ', async () => {
    const accept = jest.fn().mockResolvedValue('accepted');
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const message = { fields: { deliveryTag: 42 } };
    const context = {
      getChannelRef: () => channel,
      getMessage: () => message,
    } as unknown as RmqContext;
    const controller = new DeliveryController({ accept } as unknown as DeliveryService);

    await controller.handleProductUpdated(
      {
        eventUuid: '5a943eb6-4d4f-4c11-9962-08cf45e1697e',
        eventType: 'product.updated',
        schemaVersion: 1,
        producer: 'product_srv',
        aggregateType: 'product',
        aggregateUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
        aggregateVersion: 7,
        occurredAt: '2026-08-08T12:00:00.000Z',
        payload: { name: 'Product', status: 'active' },
      },
      context,
    );

    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: { type: 'broadcast' },
        eventType: 'product.updated',
        eventUuid: '5a943eb6-4d4f-4c11-9962-08cf45e1697e',
        payload: {
          productUuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
          version: 7,
        },
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('rejects an invalid product event without requeueing it', async () => {
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const message = { fields: { deliveryTag: 42 } };
    const context = {
      getChannelRef: () => channel,
      getMessage: () => message,
    } as unknown as RmqContext;
    const controller = new DeliveryController({ accept: jest.fn() } as unknown as DeliveryService);

    await controller.handleProductUpdated({ eventType: 'product.updated' }, context);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });
});
