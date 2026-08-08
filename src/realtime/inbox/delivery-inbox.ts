export const DELIVERY_INBOX = Symbol('DELIVERY_INBOX');

export interface DeliveryInbox {
  runOnce(eventUuid: string, operation: () => Promise<void>): Promise<'accepted' | 'duplicate'>;
}
