import { json } from '$lib/server/api/errors';
import { BOGTS_VERSION } from '$lib/server/events/deliver';
import type { RequestHandler } from './$types';

/** `GET /v1`: a public pointer for people who open the API root in a browser. */
export const GET: RequestHandler = () =>
	json({
		object: 'api',
		name: 'Bogts',
		version: BOGTS_VERSION,
		auth: 'Authorization: Bearer bgk_…',
		endpoints: ['/v1/invoices', '/v1/subscriptions', '/v1/charges', '/v1/events'],
		docs: 'https://github.com/gege-mn/bogts/blob/main/docs/api.md'
	});
