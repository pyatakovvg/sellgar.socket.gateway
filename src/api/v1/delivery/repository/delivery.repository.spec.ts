import { DataSource } from 'typeorm';

import { DeliveryRepository } from './delivery.repository';

describe(DeliveryRepository.name, () => {
  it('stores the delivery and its outbox record in one transaction', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ event_uuid: 'event' }]).mockResolvedValueOnce([]);
    const dataSource = {
      transaction: jest.fn(async (operation) => operation({ query })),
    } as unknown as DataSource;
    const repository = new DeliveryRepository(dataSource);

    await expect(
      repository.accept(
        {
          audience: { type: 'user', uuid: '3a4752e0-c56d-4d72-8976-28438f680fb8' },
          eventType: 'product.import.progressed.v1',
          eventUuid: '5a943eb6-4d4f-4c11-9962-08cf45e1697e',
          occurredAt: '2026-08-08T12:00:00.000Z',
          payload: { progress: 50 },
          schemaVersion: 1,
        },
        new Date('2026-08-15T12:00:00.000Z'),
      ),
    ).resolves.toBe('accepted');

    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0][0])).toContain('INSERT INTO delivery_event');
    expect(String(query.mock.calls[1][0])).toContain('INSERT INTO delivery_outbox');
  });

  it('treats the unique event UUID as durable idempotency', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const dataSource = {
      transaction: jest.fn(async (operation) => operation({ query })),
    } as unknown as DataSource;
    const repository = new DeliveryRepository(dataSource);

    await expect(
      repository.accept(
        {
          audience: { type: 'user', uuid: '3a4752e0-c56d-4d72-8976-28438f680fb8' },
          eventType: 'product.import.progressed.v1',
          eventUuid: '5a943eb6-4d4f-4c11-9962-08cf45e1697e',
          occurredAt: '2026-08-08T12:00:00.000Z',
          payload: {},
          schemaVersion: 1,
        },
        new Date('2026-08-15T12:00:00.000Z'),
      ),
    ).resolves.toBe('duplicate');

    expect(query).toHaveBeenCalledTimes(1);
  });
});
