import { RmqContext } from '@nestjs/microservices';

import { DeliveryService } from '../service/delivery.service';
import { DeliveryController } from './delivery.controller';

describe(DeliveryController.name, () => {
  it('persists a normalized delivery request before acknowledging RabbitMQ', async () => {
    const accept = jest.fn().mockResolvedValue('accepted');
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const message = { fields: { deliveryTag: 42 } };
    const context = {
      getChannelRef: () => channel,
      getMessage: () => message,
    } as unknown as RmqContext;
    const controller = new DeliveryController({ accept } as unknown as DeliveryService);
    const delivery = {
      channel: 'products',
      eventType: 'product.updated',
      eventUuid: '5a943eb6-4d4f-4c11-9962-08cf45e1697e',
      occurredAt: '2026-08-08T12:00:00.000Z',
      payload: {
        name: 'Product',
        status: 'active',
        uuid: '3a4752e0-c56d-4d72-8976-28438f680fb8',
        version: 7,
      },
      schemaVersion: 2,
    };

    await controller.handle(
      {
        ...delivery,
      },
      context,
    );

    expect(accept).toHaveBeenCalledWith(expect.objectContaining(delivery));
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('rejects an invalid delivery request without requeueing it', async () => {
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const message = { fields: { deliveryTag: 42 } };
    const context = {
      getChannelRef: () => channel,
      getMessage: () => message,
    } as unknown as RmqContext;
    const controller = new DeliveryController({ accept: jest.fn() } as unknown as DeliveryService);

    await controller.handle({ eventType: 'product.updated' }, context);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });

});
