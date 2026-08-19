import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

const shim = (name: string) =>
	fileURLToPath(new URL(`./src/lib/shims/${name}.ts`, import.meta.url));

/**
 * Where each Node builtin goes when Mastra runs in a browser tab.
 *
 * Measured, not guessed: `esbuild --platform=browser` against @mastra/core
 * 1.60.0 fails with 148 errors and closes to zero once these are aliased.
 * `execa` alone accounts for 67 of them — it is pulled in by the local process
 * sandbox, which a browser never runs.
 */
const BROWSER_SHIMS: Record<string, string> = {
	'stream/web': shim('stream-web'),
	crypto: shim('node-crypto'),
	async_hooks: shim('async-hooks'),
	events: shim('node-events'),
	fs: shim('node-fs'),
	// Real, not a stub: unmapped, Vite externalises this and `Buffer` becomes
	// undefined, which surfaces far from the cause.
	buffer: shim('node-buffer'),

	// Real implementations — these are genuinely used for path arithmetic.
	path: shim('node-path'),
	'path/posix': shim('node-path'),

	// Reachable, never executed. Each throws with a message naming itself.
	'fs/promises': shim('unavailable'),
	child_process: shim('unavailable'),
	os: shim('unavailable'),
	stream: shim('unavailable'),
	'stream/promises': shim('unavailable'),
	string_decoder: shim('unavailable'),
	url: shim('unavailable'),
	module: shim('unavailable'),
	util: shim('unavailable'),
	net: shim('unavailable'),
	dns: shim('unavailable'),
	http: shim('unavailable'),
	https: shim('unavailable'),
	tls: shim('unavailable'),
	tty: shim('unavailable'),
	v8: shim('unavailable'),
	zlib: shim('unavailable'),
	worker_threads: shim('unavailable'),
	perf_hooks: shim('unavailable'),
	readline: shim('unavailable'),
	'timers/promises': shim('unavailable'),
	timers: shim('unavailable'),
	execa: shim('unavailable'),
	'cross-spawn': shim('unavailable'),

	// A native N-API addon, pulled in by Mastra's code-mode AST tooling. It is
	// not installed and could never load in a browser even if it were — this is
	// the one entry that is a hard impossibility rather than a choice.
	'@ast-grep/napi': shim('unavailable')
};

/** Matches every key above, with or without the `node:` prefix. */
const SHIM_FILTER = new RegExp(
	`^(node:)?(${Object.keys(BROWSER_SHIMS)
		.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('|')})$`
);

/**
 * Apply the browser shims to the **client build only**.
 *
 * This is the whole reason this is a plugin rather than a `resolve.alias`
 * entry: an alias applies to every build, which would hand the server the
 * browser stubs too. Study mode runs Mastra on real Node in a Vercel function,
 * where `fs` and `child_process` should be the genuine articles — aliasing them
 * globally would break the product half of the app to fix the teaching half.
 *
 * `resolveId` receives an `ssr` flag, so the seam is exact.
 */
function mastraBrowserShims(): Plugin {
	return {
		name: 'colophon:mastra-browser-shims',
		enforce: 'pre',
		resolveId(source, _importer, options) {
			if (options?.ssr) return null;
			return BROWSER_SHIMS[source.replace(/^node:/, '')] ?? null;
		},

		/**
		 * Vite pre-bundles dependencies with its own esbuild pass, which never
		 * sees the hook above — so without this, `@mastra/core` is optimised
		 * against the real Node builtins and the browser gets a chunk importing
		 * `@ast-grep/napi`. Same table, second doorway.
		 */
		config() {
			return {
				optimizeDeps: {
					include: ['@mastra/core/agent', '@mastra/core/tools', '@ai-sdk/openai', 'zod'],
					esbuildOptions: {
						plugins: [
							{
								name: 'colophon:shims-in-prebundle',
								setup(build: {
									onResolve: (
										o: { filter: RegExp },
										cb: (a: { path: string }) => { path: string } | null
									) => void;
								}) {
									build.onResolve({ filter: SHIM_FILTER }, (args) => {
										const target = BROWSER_SHIMS[args.path.replace(/^node:/, '')];
										return target ? { path: target } : null;
									});
								}
							}
						]
					}
				}
			};
		}
	};
}

export default defineConfig({
	plugins: [
		mastraBrowserShims(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
