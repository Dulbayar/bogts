/** An API error: the HTTP status and the `{ error: { code, message } }` body. */
export class BogtsError extends Error {
	override readonly name = 'BogtsError';
	constructor(
		/** HTTP status; 0 when the request never got an answer */
		readonly status: number,
		/** e.g. `invalid_request`, `not_found`, `network_error` */
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

export type SignatureFailure =
	| 'missing_header'
	| 'malformed_header'
	| 'no_signature'
	| 'mismatch'
	| 'timestamp_out_of_tolerance'
	| 'invalid_payload';

/** A webhook whose `Bogts-Signature` does not verify. Answer it with 400. */
export class BogtsSignatureError extends Error {
	override readonly name = 'BogtsSignatureError';
	constructor(
		readonly reason: SignatureFailure,
		message: string
	) {
		super(message);
	}
}
