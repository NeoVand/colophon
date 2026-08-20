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

	/**
	 * Silences the heartbeat. Assigned by `start`, called by `cancel` — which is
	 * why it lives out here: the two run at different times on the same stream,
	 * and `cancel` fires while `start` is still suspended mid-run.
	 */
	let stop = () => {};

	/**
	 * Everything that has to be true whether the run ends or the reader leaves.
	 *
	 * ── The bug this shape exists to prevent ────────────────────────────────
	 * The dev server "died mid-run" perhaps a dozen times over this project's
	 * life, always during a long streaming turn, always leaving
	 * `ERR_CONNECTION_REFUSED` and nothing in its own log. It was written off as
	 * a Vite quirk. It was this:
	 *
	 *     TypeError [ERR_INVALID_STATE]: Invalid state: Controller is already closed
	 *         at ReadableStreamDefaultController.enqueue
	 *         at Timeout._onTimeout (api/agent/stream/+server.ts:57)
	 *
	 * Line 57 was the heartbeat. When a reader navigates away mid-run the stream
	 * is **cancelled**, which closes the controller — but `start()` is still
	 * sitting in `for await`, so the `finally` that cleared the interval had not
	 * run and the `open` flag it sets was still `true`. Fifteen seconds later the
	 * timer fired, enqueued into a closed controller, and threw *inside a timer
	 * callback* — where there is no `try` to catch it and no promise to reject.
	 * Node's default for an uncaught exception is to kill the process, so one
	 * person closing a tab took the whole server down with them.
	 *
	 * It was invisible because the death is delayed and silent: up to fifteen
	 * seconds after a navigation, in a log nobody reads, on a server everyone
	 * assumed had crashed for its own reasons. It cost several paid runs and a
	 * standing instruction in `docs/STATE.md` not to touch the repo during a run,
	 * which was superstition addressing a real symptom.
	 *
	 * Two fixes, because either alone would have been enough and neither is
	 * sufficient on its own reasoning:
	 *
	 * 1. `cancel()` — the callback the stream *does* invoke when a reader leaves.
	 *    This is the correct fix. Clearing the interval there is the whole point
	 *    of the callback existing.
	 * 2. `send()` and the heartbeat both swallow a closed-controller throw. This
	 *    is the backstop, and it earns its place: the race is real however
	 *    carefully the flag is managed, because the timer can fire between the
	 *    controller closing and any handler running. A stream nobody is reading
	 *    is not worth an exception.
	 */
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let open = true;

			/**
			 * Write a frame, or notice that nobody is listening any more.
			 *
			 * The `open` flag is the fast path; the `catch` is the truth. Once a
			 * write fails the reader is gone for good, so `open` latches false and
			 * the rest of the run stops trying.
			 */
			const write = (frame: string) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(frame));
				} catch {
					open = false;
				}
			};

			const send = (event: string, data: unknown) => {
				write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
			};

			// A comment frame: valid SSE, ignored by EventSource, and enough traffic
			// to keep an idle intermediary from deciding the response has stalled.
			const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS);
			stop = () => {
				open = false;
				clearInterval(heartbeat);
			};

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
				stop();
				try {
					controller.close();
				} catch {
					// Already closed, because the reader left first. Nothing to do —
					// and throwing here would replace a clean end with a 500 on a
					// response nobody is holding.
				}
			}
		},

		/**
		 * The reader navigated away, closed the tab, or pressed stop.
		 *
		 * This is the callback whose absence killed the process. It runs while
		 * `start()` is still suspended in its `for await`, which is exactly when
		 * the heartbeat has to be silenced.
		 */
		cancel() {
			stop();
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
