import type { RequestHandler } from './$types';
import { Agent } from '@mastra/core/agent';
import { model, isModelConfigured } from '$lib/server/model';
import { project } from '$lib/agent/events';
import { error } from '@sveltejs/kit';

/**
 * The streaming seam.
 *
 * Colophon's whole "works from anywhere" property lives in this file: the
 * browser posts here, we talk to the provider, and to a filtering proxy the
 * whole exchange is ordinary HTTPS to a personal website. The key stays on the
 * server; the browser never learns a provider hostname.
 *
 * ── Why the headers matter more than they look ──────────────────────────────
 * Corporate proxies routinely *buffer* `text/event-stream`, holding the whole
 * response until it completes. Everything still works — the answer arrives, the
 * status is 200, no error anywhere — it just arrives all at once, minutes later,
 * which reads to a user as "it's broken". `X-Accel-Buffering: no` and
 * `Cache-Control: no-transform` ask intermediaries not to do that, and the
 * heartbeat below gives them bytes to forward so they have less reason to wait.
 *
 * None of that is a guarantee, which is why the first frame we send is a `ready`
 * event: a client that has not seen `ready` within a few seconds knows it is
 * behind a buffering proxy and can fall back to polling, rather than showing a
 * spinner forever.
 */

const HEARTBEAT_MS = 15_000;

export const POST: RequestHandler = async ({ request }) => {
	if (!isModelConfigured()) {
		error(503, 'OPENAI_API_KEY is not configured on the server.');
	}

	const { prompt, detail = 'chat' } = (await request.json()) as {
		prompt?: string;
		detail?: 'chat' | 'full';
	};
	if (!prompt?.trim()) error(400, 'A prompt is required.');

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let open = true;
			const send = (event: string, data: unknown) => {
				if (!open) return;
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			};

			// A comment frame: valid SSE, ignored by EventSource, and enough traffic
			// to keep an idle intermediary from deciding the response has stalled.
			const heartbeat = setInterval(() => {
				if (open) controller.enqueue(encoder.encode(': keep-alive\n\n'));
			}, HEARTBEAT_MS);

			try {
				// Sent before any model work so the client can time first-byte and
				// detect a buffering proxy rather than waiting on the model.
				send('ready', { at: Date.now() });

				const agent = new Agent({
					id: 'colophon-probe',
					name: 'Colophon',
					instructions: 'You are Colophon, a research companion. Answer briefly and precisely.',
					// Built through the factory on purpose — see src/lib/server/model.ts.
					model: model()
				});

				const result = await agent.stream(prompt);

				// `fullStream` rather than `textStream`: Mastra publishes ~87 typed
				// chunk kinds here — tool calls, steps, reasoning, usage — and that
				// is the feed the X-ray panels read.
				//
				// It is projected before it leaves the building unless the caller
				// asks for `detail: 'full'`. Measured: the terminal chunks of a
				// two-word answer are ~30 KB, nearly all of it the message history
				// and the encrypted reasoning blob repeated three ways. Lab mode
				// wants that; a phone on a train does not.
				for await (const chunk of result.fullStream) {
					if (detail === 'full') {
						send('chunk', chunk);
						continue;
					}
					const event = project(chunk);
					if (event) send('event', event);
				}

				send('done', { at: Date.now() });
			} catch (cause) {
				send('failed', { message: cause instanceof Error ? cause.message : String(cause) });
			} finally {
				open = false;
				clearInterval(heartbeat);
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			// no-transform is the half that asks proxies not to buffer or rewrite.
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			// nginx and several corporate appliances honour this; harmless elsewhere.
			'x-accel-buffering': 'no'
		}
	});
};
