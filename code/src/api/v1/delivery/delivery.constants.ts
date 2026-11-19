export const DELIVERY_REQUESTED_PATTERN = 'realtime.delivery.requested.v1';
export const DELIVERY_CHANNELS = ['products', 'offers', 'categories', 'carts'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export const PRODUCTS_SOCKET_PATH = '/socket.io/products';
export const STORE_SOCKET_PATH = '/socket.io/store';
export const DELIVERY_EVENT = 'realtime.event.v1';
export const DELIVERY_ACK_EVENT = 'realtime.ack.v1';
export const DELIVERY_READY_EVENT = 'realtime.ready.v1';
export const CONNECTION_ERROR_EVENT = 'realtime.error.v1';

export const CATEGORIES_SOCKET_PATH = '/socket.io/categories';
export const CARTS_SOCKET_PATH = '/socket.io/carts';
export const IDENTITY_COMMAND_SERVICE = 'IDENTITY_COMMAND_SERVICE';
