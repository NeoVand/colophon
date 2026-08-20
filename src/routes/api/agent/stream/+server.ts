import type { RequestHandler } from './$types';
import { createColophon } from '$lib/agent/colophon';
import { isModelConfigured } from '$lib/server/model';
import { project } from '$lib/agent/events';
import { createCapture } from '$lib/agent/capture';
import { decompose } from '$lib/agent/context';
import { isStorageConfigured, READER } from '$lib/server/storage';
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

	const {
		prompt,
		detail = 'chat',
		thread
	} = (await request.json()) as {
		prompt?: string;
		detail?: 'chat' | 'full';
		thread?: string;
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

				// Built per request: the agent carries a source registry that must not
				// be shared between runs, or one conversation could cite another's
				// papers. Memory attaches only when there is somewhere to keep it.
				// The wire, tee'd. The agent is not told and does not behave
				// differently; only the transport it was handed is ours.
				const capture = createCapture();
				const { agent } = createColophon({ thread, capture: capture.fetch });
				const remembers = isStorageConfigured() && Boolean(thread);

				const result = await agent.stream(prompt, {
					// Research turns fan out: search, then read several papers, then
					// write. The default stops well short of that and truncates the
					// answer mid-argument.
					maxSteps: 24,
					// `resource` is constant while `thread` varies: working memory is
					// resource-scoped, so what Colophon learns about the reader
					// outlives any single conversation.
					...(remembers ? { memory: { thread: thread!, resource: READER } } : {})
				});

				// `fullStream` rather than `textStream`: Mastra publishes ~87 typed
				// chunk kinds here — tool calls, steps, reasoning, usage — and that
				// is the feed the X-ray panels read.
				//
				// It is projected before it leaves the building unless the caller
				// asks for `detail: 'full'`. Measured: the terminal chunks of a
				// two-word answer are ~30 KB, nearly all of it the message history
				// and the encrypted reasoning blob repeated three ways. Lab mode
				// wants that; a phone on a train does not.
				/*
				 * The context event is emitted from inside the chunk loop rather than
				 * at the end, and that is the only place it can be.
				 *
				 * A request is captured *before* its response streams, so by the time
				 * the first chunk of call N arrives, call N's body exists. Waiting
				 * until the run finished would show one context — the last — for a
				 * turn that made a dozen calls, and the interesting reading is how
				 * the window grew across them.
				 *
				 * `seq` is compared rather than the array length, because the capture
				 * keeps only the last few requests and its length stops changing
				 * while `seq` keeps counting.
				 */
				let lastContext = 0;
				const emitContext = () => {
					const latest = capture.latest();
					if (!latest || latest.seq === lastContext || !latest.body) return;
					lastContext = latest.seq;
					const { model: modelId, parts, chars } = decompose(latest.body);
					send('event', {
						k: 'context',
						call: latest.seq,
						model: modelId,
						chars,
						bytes: latest.bytes,
						parts
					});
				};

				for await (const chunk of result.fullStream) {
					emitContext();
					if (detail === 'full') {
						send('chunk', chunk);
						continue;
					}
					const event = project(chunk);
					if (event) send('event', event);
				}
				emitContext();

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
