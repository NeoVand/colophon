import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { isModelConfigured } from '$lib/server/model';
import { SourceRegistry } from '$lib/agent/sources';
import { createResearchWorkflow } from '$lib/agent/research-workflow';
import { projectWorkflow } from '$lib/agent/workflow-events';

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

	const { question, detail = 'chat' } = (await request.json()) as {
		question?: string;
		detail?: 'chat' | 'full';
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
				const workflow = createResearchWorkflow({ registry });
				const run = await workflow.createRun();
				cancelRun = () => run.cancel();

				// Before any model work, so a client can time first-byte and tell a
				// buffering proxy from a slow model rather than guessing.
				send('ready', { at: Date.now(), runId: run.runId, workflowId: workflow.id });

				const output = run.stream({ inputData: { question: question.trim() } });

				for await (const chunk of output.fullStream) {
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
					const event = projectWorkflow(chunk);
					if (event) send('event', event);
				}

				send('done', { at: Date.now() });
			} catch (cause) {
				send('failed', { message: cause instanceof Error ? cause.message : String(cause) });
			} finally {
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
