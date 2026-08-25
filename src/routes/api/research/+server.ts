import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { isModelConfigured } from '$lib/server/model';
import { SourceRegistry } from '$lib/agent/sources';
import { createResearchWorkflow } from '$lib/agent/research-workflow';
import { projectWorkflow } from '$lib/agent/workflow-events';
import { addUsage, readUsage, type Usage } from '$lib/agent/events';
import { createCapture } from '$lib/agent/capture';
import { recorderFor, traceFor, tracingState, type OpenSpan } from '$lib/server/tracing';

/**
 * Running the deep-research pipeline for real, and letting you watch it.
 *
 * `/api/graph` already publishes this workflow's *shape*. This is the other
 * half: those same steps actually executing, one SSE frame per stage boundary,
 * so the panel that draws the pipeline can also say which stage is in flight
 * and how long each one took. A topology without a run is a diagram; a run
 * without a topology is a progress bar. Together they are an instrument.
 *
 * ── Same wire as `/api/agent/stream`, on purpose ────────────────────────────
 * Frames are `ready` / `event` / `done` / `failed`, the headers are the same,
 * the heartbeat is the same, and for the same reasons — corporate proxies
 * buffer `text/event-stream` and hold the whole response until it completes,
 * which reads to a user as "it's broken" while nothing is actually wrong. A
 * deep-research run is minutes long and makes a dozen provider calls, so it is
 * the request in this application *most* likely to be sitting inside a proxy's
 * buffer, and the one where a silent stall is least distinguishable from work.
 *
 * The one addition is `runId` on the `ready` frame. The agent route cannot send
 * it that early — Mastra mints the id inside `agent.stream()` — but a workflow
 * run is created before it is started, so the client has the handle it would
 * need to cancel or resume before a single token is spent.
 *
 * ── The API here was read, then run ─────────────────────────────────────────
 * From `@mastra/core` 1.60.0's declarations, and then confirmed against the
 * engine with a throwaway two-step workflow rather than trusted:
 *
 *   `workflow.createRun()` → `Promise<Run>`. Needs no Mastra instance and no
 *   storage; with neither, the snapshot persistence inside it is a no-op, so
 *   this costs nothing and cannot fail on a machine with no database.
 *
 *   `run.stream({ inputData })` → `WorkflowRunOutput`, synchronously. It exposes
 *   `fullStream` (a `ReadableStream` of workflow chunks) and `result` (a promise
 *   of the final `WorkflowResult`). Execution begins when the stream is pulled.
 *
 * `run.start()` would give the answer and nothing else; `run.watch()` is marked
 * `@internal` and hands you a callback rather than backpressure. `stream()` is
 * the supported seam and the only one that survives a slow client.
 *
 * Gating is `hooks.server.ts`'s job: everything but `/api/cron/` sits behind the
 * session cookie, so an unauthenticated POST here is a 401 before this runs.
 */

const HEARTBEAT_MS = 15_000;

export const POST: RequestHandler = async ({ request }) => {
	if (!isModelConfigured()) {
		error(503, 'OPENAI_API_KEY is not configured on the server.');
	}

	const {
		question,
		detail = 'chat',
		thread
	} = (await request.json()) as {
		question?: string;
		detail?: 'chat' | 'full';
		/**
		 * Not used to remember anything — the pipeline has no memory. It is the
		 * key the wire capture is filed under, so `/api/context` can find this
		 * run's requests when a row in the context panel is expanded.
		 */
		thread?: string;
	};
	if (!question?.trim()) error(400, 'A question is required.');

	const encoder = new TextEncoder();

	/*
	 * Held outside `start` so `cancel` can reach it.
	 *
	 * A research run is expensive and long, and a browser that navigates away
	 * mid-run leaves several agents reading papers nobody will read the answer
	 * to. `cancel` fires when the response body is dropped, and that is the only
	 * chance to stop paying for it.
	 *
	 * It is genuinely best-effort, and the limit was measured rather than
	 * assumed: `run.cancel()` trips the run's abort signal, but a step already
	 * in flight that does not watch that signal runs to completion anyway — a
	 * five-second step cancelled at 300ms still took its five seconds. So this
	 * stops the *next* stage, not the current one. On a five-stage pipeline
	 * whose expensive stage is fourth, that is still most of the bill.
	 */
	let cancelRun: (() => Promise<void>) | undefined;

	/*
	 * Hoisted out of `start` so `cancel` can close it too.
	 *
	 * A cancelled stream still has its `start` body running — the `for await`
	 * below only ends when the engine's stream ends — and enqueueing into a
	 * cancelled controller throws. Flipping this in `cancel` turns every later
	 * `send` into a no-op instead of an unhandled rejection in a detached
	 * request.
	 */
	let open = true;
	/** Silences the heartbeat from `cancel`, which runs while `start` is stuck. */
	let silence = () => {};

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			/*
			 * The flag is the fast path; the `catch` is the truth.
			 *
			 * Flipping `open` in `cancel` is not enough on its own, and the sibling
			 * route proved it the expensive way — see the long note in
			 * `api/agent/stream/+server.ts`. A timer can fire in the window between
			 * the reader disconnecting and `cancel` being invoked, and an
			 * `enqueue` that throws inside a timer callback has no `try` above it
			 * and no promise to reject: Node kills the process. A stream nobody is
			 * reading is not worth an exception.
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

			const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS);
			silence = () => clearInterval(heartbeat);

			/*
			 * The trace's root, and the key it was filed under.
			 *
			 * Out here because `finally` has to close the root whether the pipeline
			 * finished, threw, or was abandoned — a root left open draws to the
			 * frontier for ever and makes every child look instantaneous beside it.
			 * Both stay undefined if the run never got as far as being created.
			 */
			let root: OpenSpan | undefined;
			let runId = '';

			try {
				/*
				 * A registry per run, never shared.
				 *
				 * This is the rule the whole citation guarantee rests on: the writer
				 * step can only cite what entered *this* run, and a registry that
				 * outlived a request would let one reader's answer cite another
				 * reader's papers. It is threaded through every step rather than
				 * rebuilt per step, because provenance has to cross the step
				 * boundary that the paper's text does not.
				 */
				const registry = new SourceRegistry();

				/*
				 * The bill, added up here because the engine does not add it up.
				 *
				 * `workflow-finish` reports all-zero usage for this pipeline — see the
				 * note on `ResearchDeps.meter`, where the measurement is recorded — so
				 * every agent call reports its own `totalUsage` into this instead.
				 * Five numbers, in Mastra's own shape, through the same `readUsage`
				 * the chat stream uses, so the two modes cannot drift apart on what a
				 * token is.
				 */
				let spent: Usage = { input: 0, output: 0, total: 0, reasoning: 0, cached: 0 };
				// The wire, tee'd — the same seam the chat route uses, for the same
				// reason. Without it the context panel says "Nothing sent yet" through
				// a run that made a dozen provider calls.
				const capture = createCapture({ key: thread });

				const workflow = createResearchWorkflow({
					registry,
					capture: capture.fetch,
					meter: (usage) => (spent = addUsage(spent, readUsage(usage)))
				});
				const run = await workflow.createRun();
				cancelRun = () => run.cancel();

				// Before any model work, so a client can time first-byte and tell a
				// buffering proxy from a slow model rather than guessing.
				send('ready', { at: Date.now(), runId: run.runId, workflowId: workflow.id });

				/*
				 * ── The trace, off the engine's own clock ─────────────────────────
				 *
				 * The sibling of the block in `api/agent/stream`, and the better half
				 * of the pair: an agent's step boundaries have to be read off a chunk
				 * stream, but a workflow step *publishes* the two timestamps the
				 * engine took around it. `startedAt` and `endedAt` here are measured
				 * inside the step, on one machine, so a duration built from them is
				 * free of both clock skew and the time the frame spent on the wire.
				 *
				 * The root is stamped from this process's `Date.now()`, which is the
				 * same clock the engine used — so the steps nest inside it correctly
				 * and the gaps between them are real gaps rather than an artefact of
				 * two clocks disagreeing.
				 */
				const tracing = tracingState();
				send('event', { k: 'trace', ...tracing });

				runId = run.runId;
				const recorder = recorderFor(runId, {
					onSpan: (span) => send('event', { k: 'span', span })
				});
				root = recorder.start({
					name: workflow.id,
					kind: 'workflow_run',
					attributes: { question: question.trim(), runId: run.runId }
				});

				/** Open step spans by step id, with the engine's start kept beside each. */
				const stages = new Map<string, { span: OpenSpan; startedAt: number }>();

				const output = run.stream({ inputData: { question: question.trim() } });

				for await (const chunk of output.fullStream) {
					/*
					 * Recorded from the projected event, before the detail branch, so
					 * the trace is the same whichever wire the caller asked for. The
					 * projection is where the engine's two timestamps are already read
					 * and range-checked; doing it again here would be a second place to
					 * get `endedAt >= startedAt` wrong.
					 */
					const projected = projectWorkflow(chunk);
					if (projected?.k === 'step-start') {
						// `at` is the engine's own clock, or 0 when the chunk did not
						// carry one — in which case now is the closest honest answer.
						const startedAt = projected.at || Date.now();
						stages.set(projected.step, {
							startedAt,
							span: root.child({ name: projected.step, kind: 'workflow_step', startedAt })
						});
					} else if (projected?.k === 'step-finish') {
						const stage = stages.get(projected.step);
						stage?.span.end({
							failed: projected.state === 'failed',
							// Reconstructed from the engine's own duration rather than
							// stamped now, so the bar is the step's length and not the
							// step's length plus however long the frame took to arrive.
							// `ms` is 0 when the engine did not report both timestamps;
							// then, and only then, the local clock is the fallback.
							endedAt: projected.ms ? stage.startedAt + projected.ms : Date.now(),
							attributes: { state: projected.state }
						});
						stages.delete(projected.step);
					}

					if (detail === 'full') {
						// Lab mode, and honestly lossy in one place: a failed step's
						// `error` is a live `Error`, which `JSON.stringify` renders as
						// `{}`. The projected path below reads its message instead.
						send('chunk', chunk);
						continue;
					}
					/*
					 * Projected before it leaves the building, and here that is not a
					 * nicety. `workflow-step-output` republishes the entire nested agent
					 * feed — every text delta of four papers being read in parallel —
					 * and `workflow-step-result` carries each step's whole output, which
					 * for `read` is several pages of notes that then appear again inside
					 * the next step's `payload`. Five rows and a stopwatch do not need
					 * any of it.
					 */
					if (!projected) continue;

					/*
					 * The engine's zeros, replaced by what was actually spent.
					 *
					 * Only when the engine reported nothing: if a later Mastra learns to
					 * count agents called inside a step, its number is the one to
					 * believe — it can see calls this meter cannot — and this quietly
					 * steps aside rather than having to be remembered and removed.
					 */
					if (projected.k === 'workflow-done' && !projected.usage.total && spent.total) {
						projected.usage = {
							input: spent.input,
							output: spent.output,
							total: spent.total
						};
					}

					send('event', projected);
				}

				send('done', { at: Date.now() });
			} catch (cause) {
				send('failed', { message: cause instanceof Error ? cause.message : String(cause) });
			} finally {
				/*
				 * A step still open here is one the run died inside, and it is left
				 * open on purpose: drawn to the frontier, it says which stage the
				 * pipeline was in when it stopped. The root is closed, so the trace
				 * has a length.
				 */
				root?.end();
				send('event', {
					k: 'trace',
					...tracingState(),
					truncated: traceFor(runId).truncated
				});

				const wasOpen = open;
				open = false;
				cancelRun = undefined;
				silence();
				// Only if the reader has not already torn the stream down; closing a
				// cancelled controller throws.
				if (wasOpen) {
					try {
						controller.close();
					} catch {
						// Raced with a teardown between the check and the call.
					}
				}
			}
		},

		async cancel() {
			open = false;
			// The heartbeat has to stop here, not in `finally`: `start` is still
			// suspended in its `for await` and its `finally` may be minutes away.
			// An interval left running against a detached request is a leak at
			// best and, before the `write` guard above, was a killed process.
			silence();
			// Best effort: the run may already have finished, and a failure to
			// cancel a finished run is not something the client could act on.
			await cancelRun?.().catch(() => {});
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
