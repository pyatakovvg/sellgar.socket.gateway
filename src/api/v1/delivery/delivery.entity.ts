import { DeliveryAudienceDto } from './controller/dto/delivery-request.dto';

export interface DeliveryMessage {
  deliveryId: string;
  sequence: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  expiresAt: string;
  audience: DeliveryAudienceDto;
  payload: Record<string, unknown>;
}

export function deliveryRoom(message: DeliveryMessage): string {
  return `${message.audience.type}:${message.audience.uuid}`;
}

export function parseDeliveryMessage(value: unknown): DeliveryMessage {
  if (!value || typeof value !== 'object') {
    throw new Error('Cluster delivery must be an object');
  }

  const message = value as Partial<DeliveryMessage>;
  const audience = message.audience as Partial<DeliveryAudienceDto> | undefined;
  if (
    typeof message.deliveryId !== 'string' ||
    typeof message.sequence !== 'string' ||
    !/^\d+$/.test(message.sequence) ||
    typeof message.eventType !== 'string' ||
    typeof message.schemaVersion !== 'number' ||
    typeof message.occurredAt !== 'string' ||
    typeof message.expiresAt !== 'string' ||
    !audience ||
    typeof audience.type !== 'string' ||
    typeof audience.uuid !== 'string' ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    throw new Error('Invalid cluster delivery');
  }

  return message as DeliveryMessage;
}
