/** The adapter's build output, aliased in wrangler.jsonc (see src/worker.ts). */
declare module 'kit:worker' {
	const worker: {
		fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>;
	};
	export default worker;
}
