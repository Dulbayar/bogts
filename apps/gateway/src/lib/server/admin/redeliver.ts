/** The dashboard's handle on `redeliver(ctx, eventId)` from `events/deliver.ts`. */
import { redeliver } from '../events/deliver';
import type { ServiceContext } from '../services/context';

export function redeliverEvent(ctx: ServiceContext, eventId: string) {
	return redeliver(ctx, eventId);
}
