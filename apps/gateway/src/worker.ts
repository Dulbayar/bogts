/**
 * The Worker entry: `wrangler.jsonc`'s `main`.
 *
 * `@sveltejs/adapter-cloudflare` emits a bundle that exports `fetch` only, and it
 * deletes and rewrites whatever file its wrangler config names as `main`. So the
 * adapter builds from `wrangler.build.jsonc` into `.svelte-kit/cloudflare/_worker.js`,
 * `kit:worker` is the `alias` in `wrangler.jsonc` pointing at that output, and this
 * file adds the `scheduled` handler the cron trigger needs.
 *
 * Keep it thin. `cron.ts` is imported by relative path: wrangler bundles this
 * file with esbuild, not Vite, so `$lib` does not resolve here.
 */
import kit from 'kit:worker';
import { runCron } from './lib/server/cron';
import type { Env } from './lib/server/env';

export default {
	fetch: (request, env, ctx) => kit.fetch(request, env, ctx),

	/**
	 * `* * * * *`. Awaited rather than handed to `waitUntil`, so the invocation
	 * lasts exactly as long as the work. `runCron` never rejects.
	 */
	async scheduled(controller, env, ctx) {
		await runCron(env, ctx, controller.scheduledTime);
	}
} satisfies ExportedHandler<Env>;
