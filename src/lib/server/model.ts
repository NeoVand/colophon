import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';

/**
 * Model access — and the one seam the X-ray depends on.
 *
 * Every model in Colophon is built here, and every model built here is an AI SDK
 * provider object rather than a Mastra model-router string. That is not a style
 * preference: the provider factory takes a `fetch`, and the router does not. Hand
 * Mastra `model: 'openai/gpt-5'` (or the `{ id, apiKey }` config object) and it
 * builds its own HTTP client, the wire capture sees nothing, and *nothing fails*
 * — no error, no red test, just an X-ray that has quietly gone dark.
 *
 * So: one factory, one door, and a comment at the door. See CLAUDE.md.
 *
 * The key never leaves the server. Colophon has to work from networks that
 * filter AI providers, which means the browser talks to our origin and our
 * origin talks to OpenAI — so there is deliberately no `VITE_`-prefixed variable
 * anywhere near this file. A `VITE_` name would be inlined into the client
 * bundle and shipped to every visitor.
 */

export type CaptureFetch = typeof globalThis.fetch;

export function isModelConfigured(): boolean {
	return Boolean(env.OPENAI_API_KEY);
}

/**
 * A provider bound to our key, optionally tee'd through `capture`.
 *
 * `capture` is what the X-ray will hang off. It is a plain `fetch`, so the
 * instrumented version can be developed and tested entirely on its own.
 */
export function provider(capture?: CaptureFetch) {
	if (!env.OPENAI_API_KEY) {
		throw new Error(
			'OPENAI_API_KEY is not set. Colophon holds model keys server-side only — ' +
				'add it to .env (no VITE_ prefix, which would ship it to the browser).'
		);
	}
	return createOpenAI({ apiKey: env.OPENAI_API_KEY, fetch: capture });
}

/** The default model for interactive work. */
export const DEFAULT_MODEL = 'gpt-5';

export function model(id: string = DEFAULT_MODEL, capture?: CaptureFetch) {
	return provider(capture)(id);
}
