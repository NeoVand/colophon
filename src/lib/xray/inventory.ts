/**
 * What the tools did, counted off the tools.
 *
 * The conversation shows tool calls one at a time, in the order they happened,
 * which is the wrong shape for the two questions a reader actually has after a
 * long research turn: *what did this run spend its time on*, and *what kept
 * failing*. Both are folds over the same array, so they live here rather than
 * in a panel — a `$derived` that also does arithmetic is a `$derived` nobody
 * can test.
 *
 * Pure over the run's tool records. `session.ToolRun` satisfies `ToolRunLike`
 * structurally, so the panel passes `turn.tools` straight in and this module
 * never imports the store.
 */

/** The four fields any summary here needs. `ToolRun` has all of them. */
export interface ToolRunLike {
	name: string;
	/** `performance.now()` at dispatch. */
	startedAt: number;
	/** Absent while the call is still in flight. */
	endedAt?: number;
	failed?: boolean;
}

export interface ToolTally {
	name: string;
	calls: number;
	failed: number;
	/** Summed duration of the calls that have finished. */
	ms: number;
}

export interface TimedRun {
	name: string;
	ms: number;
	failed: boolean;
}

export interface Summary {
	calls: number;
	byTool: ToolTally[];
	failureRate: number;
	slowest: TimedRun[];
	totalToolTime: number;
}

/**
 * How long a call took, or nothing if it has not finished.
 *
 * Two guards, both load-bearing:
 *
 * A call still in flight returns `undefined` rather than `0`. Treating an
 * unfinished call as instantaneous puts a live tool at the *fast* end of every
 * ranking and quietly drags the average down while it is on screen — the row
 * you are watching is the row least likely to be telling the truth.
 *
 * A negative span clamps to zero. These stamps are `performance.now()` deltas,
 * and a suspended tab can hand back an end fractionally before its start; a
 * tool that took `-4ms` is a fact about the clock, not about the tool.
 */
export function durationOf(run: ToolRunLike): number | undefined {
	if (run.endedAt === undefined) return undefined;
	if (!Number.isFinite(run.endedAt) || !Number.isFinite(run.startedAt)) return undefined;
	return Math.max(0, run.endedAt - run.startedAt);
}

/** A call is settled once it has returned or failed. */
function settled(run: ToolRunLike): boolean {
	return run.endedAt !== undefined || run.failed === true;
}

/**
 * One row per distinct tool, busiest first.
 *
 * Ordered by call count, then by time spent, then by name — three keys so the
 * order is total and therefore stable across renders. `name` is unique across
 * the result by construction, which makes it safe as an `{#each}` key; a
 * duplicate key throws and aborts the render rather than merely misdrawing.
 */
export function callsByTool(runs: readonly ToolRunLike[]): ToolTally[] {
	const tally = new Map<string, ToolTally>();

	for (const run of runs) {
		const name = run.name || 'unnamed';
		const row = tally.get(name) ?? { name, calls: 0, failed: 0, ms: 0 };
		row.calls += 1;
		if (run.failed) row.failed += 1;
		row.ms += durationOf(run) ?? 0;
		tally.set(name, row);
	}

	return [...tally.values()].sort(
		(a, b) => b.calls - a.calls || b.ms - a.ms || a.name.localeCompare(b.name)
	);
}

/**
 * The share of settled calls that failed, 0–1.
 *
 * Calls still in flight are outside both halves of the fraction. Counting one
 * as a success makes the rate improve every time a new tool starts and worsen
 * again when it returns, which reads as noise rather than as a measurement.
 *
 * A run with nothing settled yet is 0, not `NaN` — a panel dividing by zero on
 * the first frame is how `NaN%` reaches the screen.
 */
export function failureRate(runs: readonly ToolRunLike[]): number {
	const done = runs.filter(settled);
	if (!done.length) return 0;
	return done.filter((r) => r.failed === true).length / done.length;
}

/**
 * The `n` slowest finished calls, slowest first.
 *
 * Unfinished calls are left out for the reason in `durationOf`: they have no
 * duration yet, and inventing one would rank the run you are watching against
 * runs that are over.
 */
export function slowest(runs: readonly ToolRunLike[], n = 5): TimedRun[] {
	if (n <= 0) return [];
	return (
		runs
			.map((run) => ({ run, ms: durationOf(run) }))
			.filter((r): r is { run: ToolRunLike; ms: number } => r.ms !== undefined)
			// Ties broken by start order, so a run of identical 0ms cache hits lists
			// in the order they happened rather than in whatever order sort chose.
			.sort((a, b) => b.ms - a.ms || a.run.startedAt - b.run.startedAt)
			.slice(0, n)
			.map(({ run, ms }) => ({ name: run.name, ms, failed: run.failed === true }))
	);
}

/**
 * Time spent inside tools, summed.
 *
 * A **sum**, not an elapsed span: Colophon dispatches searches in parallel, so
 * this can exceed the wall-clock length of the turn that contains it. That is
 * the interesting reading — six seconds of tool time inside a two-second turn
 * means four seconds of it happened at once — but only if nobody prints it
 * beside a wall-clock duration and calls the pair a breakdown.
 */
export function totalToolTime(runs: readonly ToolRunLike[]): number {
	return runs.reduce((total, run) => total + (durationOf(run) ?? 0), 0);
}

/** Every number above, in one call, for a panel that wants all of them. */
export function summarise(runs: readonly ToolRunLike[], n = 5): Summary {
	return {
		calls: runs.length,
		byTool: callsByTool(runs),
		failureRate: failureRate(runs),
		slowest: slowest(runs, n),
		totalToolTime: totalToolTime(runs)
	};
}
