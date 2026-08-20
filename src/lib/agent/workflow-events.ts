/**
 * What the browser is told about a *workflow* run.
 *
 * The sibling of `project()` in `events.ts`, and the same argument applies: the
 * engine publishes far more than a panel can use, and the redundant part is the
 * expensive part. A `workflow-step-result` carries the step's entire output —
 * for the `read` step that is several pages of notes per paper, repeated again
 * inside the next step's `payload` — so forwarding the raw feed would push
 * hundreds of kilobytes to draw five rows and a stopwatch.
 *
 * Like `events.ts` this file has **no Mastra imports and no I/O**. It is a pure
 * function over a chunk, testable against recorded shapes without a network, a
 * key, or an engine.
 *
 * ── Where the shapes below come from ────────────────────────────────────────
 * Read out of the installed `@mastra/core` 1.60.0 — both the declared union in
 * `dist/stream/types.d.ts` (`WorkflowStreamEvent`) and, because a declared type
 * says what a field *may* hold rather than what the engine actually sends, the
 * emit sites themselves. Three facts that only the emit sites tell you, and all
 * three matter here:
 *
 * 1. `workflow-step-start` and `workflow-step-result` spread the engine's
 *    internal `stepInfo`, so their payloads carry `startedAt` / `endedAt`
 *    even though the published type does not mention them. Those two numbers
 *    come from one clock on one machine, which is why a duration measured from
 *    them is trustworthy in a way that a browser-side stopwatch is not.
 * 2. `WorkflowRunOutput` **drops** every `workflow-step-finish` chunk before it
 *    reaches `fullStream`. The event that actually closes a step is
 *    `workflow-step-result`. A projector keyed on the obvious-sounding name
 *    would show five steps starting and none ever finishing.
 * 3. `workflow-start` and `workflow-finish` are synthesised by
 *    `WorkflowRunOutput` at the ends of the pipe rather than published by the
 *    engine, and `workflow-finish` is where the run's status, its token usage
 *    and the workflow's own return value arrive.
 *
 * All three were then confirmed by running a two-step workflow against the
 * installed engine and printing every chunk: the payload keys, the timestamps,
 * the absent `workflow-step-finish` and the synthesised terminal frame are
 * observed, not inferred. What is *not* observed is a full deep-research run
 * against a real key — the fields named `answer`, `citedIds` and `papersRead`
 * come from that workflow's own `outputSchema` rather than from a captured run.
 * So everything below is still read defensively: every field is
 * optional-checked, and an unrecognised chunk kind returns `null` rather than
 * being forwarded.
 */

/** Token accounting on `workflow-finish`. Three numbers, not the agent's five. */
export interface WorkflowUsage {
	input: number;
	output: number;
	total: number;
}

/**
 * How a step ended.
 *
 * `suspended` and `skipped` are kept rather than folded into `done` because
 * they are the two outcomes a reader would most want to argue with — a step
 * that stopped to ask something, and a step a branch decided not to run — and
 * a panel that renders both as "done" is quietly wrong about what the pipeline
 * did.
 */
export type StepState = 'done' | 'failed' | 'suspended' | 'skipped';

export type WorkflowEvent =
	/**
	 * A stage began. `at` is the engine's own `Date.now()`, or 0 when the chunk
	 * did not carry one — never a substituted local clock, because pairing a
	 * server start with a browser end is how you get negative durations.
	 */
	| { k: 'step-start'; step: string; at: number }
	/**
	 * A stage ended. `ms` is measured across the engine's two timestamps, so it
	 * is free of both clock skew and the time the frame spent on the wire.
	 */
	| { k: 'step-finish'; step: string; state: StepState; ms: number; error?: string }
	/**
	 * The pipeline finished — successfully or not.
	 *
	 * Carries the workflow's return value, which for deep research is the answer
	 * itself plus the ids it proved it cited. That is the one place the raw feed
	 * is worth its bytes: it is the product of the whole run.
	 */
	| {
			k: 'workflow-done';
			status: string;
			usage: WorkflowUsage;
			answer?: string;
			citedIds?: string[];
			papersRead?: number;
			error?: string;
	  };

/** Mastra's step statuses → the four this UI distinguishes. */
const STEP_STATE: Record<string, StepState> = {
	success: 'done',
	failed: 'failed',
	suspended: 'suspended',
	skipped: 'skipped',
	// A step the engine gave up on and one a `bail()` ended early both stopped
	// short of their output; neither is a success, and 'failed' is the honest
	// row for each.
	canceled: 'failed',
	bailed: 'failed'
};

interface Chunk {
	type?: string;
	runId?: string;
	payload?: Record<string, unknown>;
}

function num(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length ? value : undefined;
}

/**
 * The message out of whatever the engine put in `error`.
 *
 * It is an `Error` when the failure happened in-process and a plain object once
 * it has been through storage, so neither shape can be assumed.
 */
function messageOf(error: unknown): string | undefined {
	if (!error) return undefined;
	if (typeof error === 'string') return error;
	const e = error as { message?: unknown };
	return typeof e.message === 'string' ? e.message : 'step failed';
}

function readUsage(raw: unknown): WorkflowUsage {
	const u = raw as Record<string, number> | undefined;
	return {
		input: num(u?.inputTokens),
		output: num(u?.outputTokens),
		total: num(u?.totalTokens)
	};
}

/**
 * One Mastra workflow chunk → zero or one workflow events.
 *
 * `null` is the common case. `workflow-step-output` alone republishes the whole
 * nested agent feed — every text delta of every paper being read — and none of
 * it belongs in a five-row panel.
 */
export function projectWorkflow(chunk: unknown): WorkflowEvent | null {
	const c = chunk as Chunk;
	const p = c?.payload ?? {};

	switch (c?.type) {
		case 'workflow-step-start': {
			// `stepName` is an alias the stream layer adds beside `id`; either can
			// be the one present depending on which engine published the chunk.
			const step = str(p.id) ?? str(p.stepName);
			return step ? { k: 'step-start', step, at: num(p.startedAt) } : null;
		}

		case 'workflow-step-result': {
			const step = str(p.id) ?? str(p.stepName);
			if (!step) return null;
			const state = STEP_STATE[String(p.status ?? '')];
			// An unmapped status means a Mastra upgrade added an outcome. Dropping
			// the frame leaves the row running, which is at least not a claim about
			// something we cannot name.
			if (!state) return null;

			const started = num(p.startedAt);
			const ended = num(p.endedAt);
			return {
				k: 'step-finish',
				step,
				state,
				// Both timestamps or nothing: a duration computed from one of them
				// and a local clock is worse than an absent duration.
				ms: started && ended && ended >= started ? ended - started : 0,
				...(state === 'failed' ? { error: messageOf(p.error) } : {})
			};
		}

		case 'workflow-step-suspended': {
			// The suspend path publishes no `-result`, so without this a gated run
			// would show its gating step as still executing.
			const step = str(p.id) ?? str(p.stepName);
			return step ? { k: 'step-finish', step, state: 'suspended', ms: 0 } : null;
		}

		case 'workflow-finish': {
			const output = p.output as Record<string, unknown> | undefined;
			const final = p.finalWorkflowResult as Record<string, unknown> | undefined;
			const metadata = p.metadata as Record<string, unknown> | undefined;
			const ids = final?.citedIds;
			const answer = str(final?.answer);
			const failure = str(metadata?.errorMessage);

			return {
				k: 'workflow-done',
				status: String(p.workflowStatus ?? 'success'),
				usage: readUsage(output?.usage),
				...(answer ? { answer } : {}),
				...(Array.isArray(ids)
					? { citedIds: ids.filter((i): i is string => typeof i === 'string') }
					: {}),
				...(typeof final?.papersRead === 'number' ? { papersRead: final.papersRead } : {}),
				...(failure ? { error: failure } : {})
			};
		}

		/*
		 * Dropped, though it is terminal-looking. `WorkflowRunOutput` records the
		 * cancellation as its own status and then publishes `workflow-finish`
		 * carrying it — observed: `workflow-canceled` and `workflow-finish`
		 * arrive back to back, both saying 'canceled'. Projecting both would put
		 * two endings on a run that had one.
		 */
		case 'workflow-canceled':
			return null;

		default:
			return null;
	}
}
