import { DeliveryChannel, DELIVERY_CHANNELS } from './delivery.constants';

export interface DeliveryMessage {
  channel: DeliveryChannel;
  deliveryId: string;
  sequence: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  expiresAt: string;
  payload: Record<string, unknown>;
}

export function parseDeliveryMessage(value: unknown): DeliveryMessage {
  if (!value || typeof value !== 'object') {
    throw new Error('Cluster delivery must be an object');
  }

  const message = value as Partial<DeliveryMessage>;
  if (
    !DELIVERY_CHANNELS.includes(message.channel as DeliveryChannel) ||
    typeof message.deliveryId !== 'string' ||
    typeof message.sequence !== 'string' ||
    !/^\d+$/.test(message.sequence) ||
    typeof message.eventType !== 'string' ||
    typeof message.schemaVersion !== 'number' ||
    typeof message.occurredAt !== 'string' ||
    typeof message.expiresAt !== 'string' ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    throw new Error('Invalid cluster delivery');
  }

  return message as DeliveryMessage;
}
