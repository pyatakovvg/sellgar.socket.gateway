import { Inject, Injectable } from '@nestjs/common';

import { RealtimeDeliveryRequestedDto } from '@/realtime/contracts/realtime-delivery.dto';
import { DELIVERY_INBOX, DeliveryInbox } from '@/realtime/inbox/delivery-inbox';
import { RealtimeDispatchBridgeService } from '@/realtime/rabbit/realtime-dispatch-bridge.service';

@Injectable()
export class RealtimeDeliveryService {
  constructor(
    @Inject(DELIVERY_INBOX) private readonly inbox: DeliveryInbox,
    private readonly dispatch: RealtimeDispatchBridgeService,
  ) {}

  accept(event: RealtimeDeliveryRequestedDto): Promise<'accepted' | 'duplicate'> {
    return this.inbox.runOnce(event.eventUuid, () => this.dispatch.publish(event));
  }
}
