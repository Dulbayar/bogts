/**
 * @gege-mn/bogts: the typed API client for a Bogts deployment, plus the webhook
 * signature check. No runtime dependencies; works in Workers, Node >= 18,
 * Deno and Bun. Server side only: it carries a project API key.
 *
 * The types mirror docs/contracts.md "Public API shapes" and the gateway's
 * `events/emit.ts` (`EventDataMap`), with timestamps as ISO strings.
 */
export { Bogts, type BogtsOptions } from './client.js';
export { BogtsError, BogtsSignatureError, type SignatureFailure } from './errors.js';
export {
	constructEvent,
	DEFAULT_TOLERANCE_SEC,
	EVENT_ID_HEADER,
	EVENT_TYPE_HEADER,
	parseSignatureHeader,
	SIGNATURE_HEADER,
	verifyWebhook,
	type VerifyOptions
} from './webhook.js';
export * from './types.js';
