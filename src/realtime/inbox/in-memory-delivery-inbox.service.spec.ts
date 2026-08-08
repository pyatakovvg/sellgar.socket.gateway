import { ConfigService } from '@nestjs/config';

import { InMemoryDeliveryInboxService } from './in-memory-delivery-inbox.service';

describe(InMemoryDeliveryInboxService.name, () => {
  const createInbox = (maxEntries = 10) =>
    new InMemoryDeliveryInboxService(
      new ConfigService({ REALTIME_DEDUPE_MAX_ENTRIES: maxEntries }),
    );

  it('runs a successfully completed event only once', async () => {
    const inbox = createInbox();
    const operation = jest.fn().mockResolvedValue(undefined);

    await expect(inbox.runOnce('event-1', operation)).resolves.toBe('accepted');
    await expect(inbox.runOnce('event-1', operation)).resolves.toBe('duplicate');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('allows a failed event to be retried', async () => {
    const inbox = createInbox();
    const operation = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('publish failed'))
      .mockResolvedValueOnce(undefined);

    await expect(inbox.runOnce('event-1', operation)).rejects.toThrow('publish failed');
    await expect(inbox.runOnce('event-1', operation)).resolves.toBe('accepted');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent processing of the same event', async () => {
    const inbox = createInbox();
    let finish!: () => void;
    const operation = jest.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    const first = inbox.runOnce('event-1', operation);
    const second = inbox.runOnce('event-1', operation);
    finish();

    await expect(first).resolves.toBe('accepted');
    await expect(second).resolves.toBe('duplicate');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
