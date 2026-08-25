import { describe, it, expect } from 'vitest';
import {
	durationOf,
	callsByTool,
	failureRate,
	slowest,
	totalToolTime,
	summarise,
	type ToolRunLike
} from './inventory';

const run = (name: string, startedAt: number, endedAt?: number, failed?: boolean): ToolRunLike => ({
	name,
	startedAt,
	...(endedAt === undefined ? {} : { endedAt }),
	...(failed ? { failed } : {})
});

/** A small run: three searches, one of which failed, one fetch still in flight. */
const runs: ToolRunLike[] = [
	run('search', 0, 200),
	run('search', 100, 900),
	run('search', 300, 400, true),
	run('fetchPaper', 500, 2500),
	run('cite', 3000)
];

describe('durationOf', () => {
	it('measures a finished call', () => {
		expect(durationOf(run('search', 100, 900))).toBe(800);
	});

	it('has no duration for a call still in flight', () => {
		// Zero would rank a live tool as the fastest in the run and drag the
		// average down for as long as it is on screen.
		expect(durationOf(run('cite', 3000))).toBeUndefined();
	});

	it('clamps a backwards clock rather than reporting negative time', () => {
		expect(durationOf(run('search', 900, 880))).toBe(0);
	});

	it('refuses a non-finite stamp', () => {
		expect(durationOf(run('search', NaN, 900))).toBeUndefined();
		expect(durationOf(run('search', 0, Infinity))).toBeUndefined();
	});
});

describe('callsByTool', () => {
	it('groups by name and counts failures separately from calls', () => {
		const [first] = callsByTool(runs);
		expect(first).toEqual({ name: 'search', calls: 3, failed: 1, ms: 1100 });
	});

	it('orders busiest first, and gives every row a unique name for an each key', () => {
		const rows = callsByTool(runs);
		expect(rows.map((r) => r.name)).toEqual(['search', 'fetchPaper', 'cite']);
		expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
	});

	it('counts a call in flight without crediting it any time', () => {
		const cite = callsByTool(runs).find((r) => r.name === 'cite');
		expect(cite).toEqual({ name: 'cite', calls: 1, failed: 0, ms: 0 });
	});

	it('is empty for an empty run', () => {
		expect(callsByTool([])).toEqual([]);
	});
});

describe('failureRate', () => {
	it('is the share of settled calls that failed', () => {
		// Four settled, one failed. The fifth is still running and is in neither half.
		expect(failureRate(runs)).toBe(0.25);
	});

	it('is zero, not NaN, before anything has settled', () => {
		expect(failureRate([])).toBe(0);
		expect(failureRate([run('cite', 0)])).toBe(0);
	});

	it('counts a failure that never recorded an end time', () => {
		expect(failureRate([run('search', 0, undefined, true)])).toBe(1);
	});

	it('reaches one when everything failed', () => {
		expect(failureRate([run('a', 0, 1, true), run('b', 0, 1, true)])).toBe(1);
	});
});

describe('slowest', () => {
	it('ranks finished calls by duration, slowest first', () => {
		expect(slowest(runs, 2).map((r) => r.name)).toEqual(['fetchPaper', 'search']);
		expect(slowest(runs, 1)[0].ms).toBe(2000);
	});

	it('carries the failure flag, so a slow failure is visible as one', () => {
		expect(slowest(runs, 5).find((r) => r.ms === 100)?.failed).toBe(true);
	});

	it('leaves out anything still running', () => {
		expect(slowest(runs, 10).map((r) => r.name)).not.toContain('cite');
	});

	it('breaks a tie by start order rather than by whatever sort chose', () => {
		const ties = [run('b', 10, 10), run('a', 0, 0), run('c', 20, 20)];
		expect(slowest(ties, 3).map((r) => r.name)).toEqual(['a', 'b', 'c']);
	});

	it('handles a request for none, and for more than exist', () => {
		expect(slowest(runs, 0)).toEqual([]);
		expect(slowest(runs, -1)).toEqual([]);
		expect(slowest(runs, 99)).toHaveLength(4);
		expect(slowest([], 5)).toEqual([]);
	});
});

describe('totalToolTime', () => {
	it('sums the finished calls', () => {
		expect(totalToolTime(runs)).toBe(3100);
	});

	it('is a sum and not an elapsed span — parallel calls overlap', () => {
		// Two calls of one second each, dispatched together. The turn took a
		// second; the tools took two. Both numbers are true.
		const parallel = [run('search', 0, 1000), run('search', 0, 1000)];
		expect(totalToolTime(parallel)).toBe(2000);
	});

	it('is zero for an empty run and for one that has not returned yet', () => {
		expect(totalToolTime([])).toBe(0);
		expect(totalToolTime([run('cite', 3000)])).toBe(0);
	});
});

describe('summarise', () => {
	it('agrees with each function it folds together', () => {
		const s = summarise(runs, 2);
		expect(s).toEqual({
			calls: 5,
			byTool: callsByTool(runs),
			failureRate: 0.25,
			slowest: slowest(runs, 2),
			totalToolTime: 3100
		});
	});

	it('survives an empty run without a NaN anywhere in it', () => {
		const s = summarise([]);
		expect(s).toEqual({ calls: 0, byTool: [], failureRate: 0, slowest: [], totalToolTime: 0 });
	});
});
