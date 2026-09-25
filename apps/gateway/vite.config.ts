import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Build-only config: its `main` is the adapter output. wrangler.jsonc's
			// `main` is src/worker.ts, which the adapter would delete (it rewrites
			// whatever `main` it is given). `vite dev` still reads wrangler.jsonc for
			// bindings; the platform proxy does not look at `config`.
			adapter: adapter({ config: 'wrangler.build.jsonc' }),
			// The dashboard loads nothing from elsewhere. SvelteKit adds hashes for
			// its own inline bootstrap script.
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:'],
					'connect-src': ['self'],
					'font-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['none'],
					'form-action': ['self'],
					'frame-ancestors': ['none']
				}
			}
		})
	]
});
