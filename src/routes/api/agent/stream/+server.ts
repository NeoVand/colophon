import type { RequestHandler } from './$types';
import { createColophon } from '$lib/agent/colophon';
import { isModelConfigured } from '$lib/server/model';
import { project } from '$lib/agent/events';
import { createCapture } from '$lib/agent/capture';
import { decompose } from '$lib/agent/context';
import { isStorageConfigured, READER } from '$lib/server/storage';
import { recorderFor, traceFor, tracingState, type OpenSpan } from '$lib/server/tracing';
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

			// Sent before any model work so the client can time first-byte and
			// detect a buffering proxy rather than waiting on the model. Outside the
			// `try` because the trace's root span has to be in scope for `finally`,
			// and `send` cannot throw — `write` swallows a closed controller.
			send('ready', { at: Date.now() });

			/*
			 * ── The trace, recorded off the chunk stream ──────────────────────
			 *
			 * `TracePanel` and `trace.ts` were both finished and both mounted with
			 * nothing; this is the collector that was missing between them.
			 *
			 * Three span kinds, and every boundary below is one this endpoint can
			 * actually see rather than one it infers:
			 *
			 *   agent_run    the whole turn, from before `agent.stream()` to the
			 *                end of the chunk loop.
			 *   agent_step   one turn of the agent loop — the model generating,
			 *                plus whatever tools that generation asked for. It
			 *                closes on `step-finish`, which is the engine saying
			 *                so, and the next one is backdated to this one's end.
			 *   tool_call    from the `tool-call` chunk to its `tool-result`. A
			 *                delegation is filed as `agent_run` instead, so the
			 *                panel inks it as a subagent — which is what it is.
			 *
			 * The reason the step span is worth having rather than a model span:
			 * tool spans nest *inside* it, and `trace.ts` inks a bar only where it
			 * was doing its own work. So a step is drawn solid for the stretch the
			 * model was actually generating and hollow for the stretch a tool held
			 * the floor. That subtraction is the one number a chat window and an
			 * event log both structurally hide.
			 *
			 * One clock throughout — this process's. Never the browser's; pairing
			 * the two produces spans that end before they start.
			 */
			const tracing = tracingState();
			send('event', { k: 'trace', ...tracing });

			// Keyed on the thread rather than the run: Mastra mints the run id
			// inside `agent.stream()`, and the root span has to exist before that
			// call in order to measure it. Nothing reads the store back — the
			// spans are streamed as they are filed — so the key only has to be
			// stable within the request.
			const recorder = recorderFor(thread ?? 'run', {
				onSpan: (span) => send('event', { k: 'span', span })
			});

			const root = recorder.start({
				name: 'Colophon',
				kind: 'agent_run',
				attributes: {
					prompt: prompt.trim(),
					thread: thread ?? 'none',
					memory: isStorageConfigured() && Boolean(thread)
				}
			});

			/** Open spans by tool-call id, so a result can close the right one. */
			const running = new Map<string, OpenSpan>();
			let step: OpenSpan | undefined;
			let stepNo = 0;
			/** Where the next step began: the previous one's end, or the run's start. */
			let stepFrom = Date.now();

			/*
			 * Opened lazily and backdated, rather than eagerly at the previous
			 * step's end. Eager opening leaves a phantom final step — the loop is
			 * over, but a span was already waiting for it — which draws as a real
			 * stage that never happened.
			 */
			const currentStep = () =>
				(step ??= root.child({
					name: `step ${++stepNo}`,
					kind: 'agent_step',
					startedAt: stepFrom
				}));

			try {
				// Built per request: the agent carries a source registry that must not
				// be shared between runs, or one conversation could cite another's
				// papers. Memory attaches only when there is somewhere to keep it.
				// The wire, tee'd. The agent is not told and does not behave
				// differently; only the transport it was handed is ours.
				// Filed under the thread so `/api/context` can read these same bodies
				// back when a row is expanded. Without a key the capture dies with the
				// request and the panel can only ever show labels.
				const capture = createCapture({ key: thread });
				const { agent } = await createColophon({ thread, capture: capture.fetch });
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

				/**
				 * The projected event, also read as a span boundary.
				 *
				 * Driven off `project()` rather than off the raw chunk types on
				 * purpose: the translation from Mastra's vocabulary to this app's —
				 * including the one that recognises `agent-paperReader` as a
				 * delegation — already lives there and is tested there. A second
				 * switch on chunk types here would be a second place for that
				 * knowledge to rot.
				 */
				const recordSpan = (event: ReturnType<typeof project>) => {
					switch (event?.k) {
						case 'tool-call':
							running.set(
								event.id,
								currentStep().child({
									name: event.subagent ?? event.name,
									// A subagent is a whole second agent run in its own context
									// window, and the panel inks `agent_*` at depth as a
									// delegation. Filing it as a tool call would draw the most
									// expensive thing in the run as the cheapest.
									kind: event.subagent ? 'agent_run' : 'tool_call',
									attributes: { tool: event.name, args: event.args }
								})
							);
							break;
						case 'tool-result':
							running.get(event.id)?.end({ failed: event.failed });
							running.delete(event.id);
							break;
						case 'step': {
							const now = Date.now();
							currentStep().end({ attributes: { tokens: event.usage.total }, endedAt: now });
							step = undefined;
							stepFrom = now;
							break;
						}
					}
				};

				for await (const chunk of result.fullStream) {
					emitContext();
					const event = project(chunk);
					recordSpan(event);
					if (detail === 'full') {
						send('chunk', chunk);
						continue;
					}
					if (event) send('event', event);
				}
				emitContext();

				send('done', { at: Date.now() });
			} catch (cause) {
				send('failed', { message: cause instanceof Error ? cause.message : String(cause) });
			} finally {
				/*
				 * Closed here rather than after the loop, so a run that threw or was
				 * abandoned still has a measured root instead of a bar that runs to
				 * the frontier for ever. Any tool span still open is deliberately
				 * left open: a tool that never returned is exactly what the reader
				 * needs to see, and closing it would erase the finding.
				 */
				step?.end();
				root.end();
				send('event', { k: 'trace', ...tracing, truncated: traceFor(recorder.runId).truncated });

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
