import { RmqContext } from '@nestjs/microservices';

import { DeliveryService } from '../service/delivery.service';
import { DeliveryController } from './delivery.controller';

describe(DeliveryController.name, () => {
  it('maps product.updated to the products channel before acknowledging RabbitMQ', async () => {
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
        channel: 'products',
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

  it('maps store.product.updated to the offers channel', async () => {
    const accept = jest.fn().mockResolvedValue('accepted');
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const message = { fields: { deliveryTag: 43 } };
    const context = {
      getChannelRef: () => channel,
      getMessage: () => message,
    } as unknown as RmqContext;
    const controller = new DeliveryController({ accept } as unknown as DeliveryService);

    await controller.handleStoreProductUpdated(
      {
        eventUuid: '29321434-8ae4-43f2-9232-fe350bab5522',
        eventType: 'store.product.updated',
        schemaVersion: 1,
        producer: 'store_srv',
        aggregateType: 'store_product',
        aggregateUuid: '5b7e713c-f6c6-4450-b1dc-767a7458bf55',
        aggregateVersion: 8,
        occurredAt: '2026-08-08T20:00:00.000Z',
        payload: { offers: [] },
      },
      context,
    );

    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'offers',
        eventType: 'store.product.updated',
        payload: {
          storeProductUuid: '5b7e713c-f6c6-4450-b1dc-767a7458bf55',
          version: 8,
        },
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });
});
