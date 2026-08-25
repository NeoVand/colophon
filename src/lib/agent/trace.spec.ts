import { describe, it, expect } from 'vitest';
import { attributeRows, buildTrace, hotspots, ms, type TraceSpan } from './trace';

/**
 * Every case below is a shape a real collector produces, not a shape invented
 * to make an assertion easy. Traces arrive damaged far more often than they
 * arrive clean — a span exported after its parent was sampled away, a run
 * aborted mid-tool, a retry that reused an id — and the interesting question
 * about this module is never "does nesting work", it is "what does it do with
 * the mess".
 */

/** Milliseconds since an arbitrary epoch; the absolute value never matters. */
const T = 1_000_000;

function span(
	id: string,
	from: number,
	to: number | undefined,
	extra: Partial<TraceSpan> = {}
): TraceSpan {
	return {
		id,
		name: id,
		kind: 'generic',
		startedAt: T + from,
		...(to === undefined ? {} : { endedAt: T + to }),
		...extra
	};
}

describe('a clean trace', () => {
	const spans = [
		span('run', 0, 100),
		span('model', 10, 40, { parentId: 'run', kind: 'model_inference' }),
		span('tool', 50, 90, { parentId: 'run', kind: 'tool_call' })
	];

	it('nests, and orders siblings by when they started', () => {
		const trace = buildTrace(spans, { now: T + 100 });
		expect(trace.roots.map((n) => n.span.id)).toEqual(['run']);
		expect(trace.roots[0].children.map((n) => n.span.id)).toEqual(['model', 'tool']);
		expect(trace.rows.map((n) => n.span.id)).toEqual(['run', 'model', 'tool']);
		expect(trace.depth).toBe(1);
	});

	it('charges the parent only for the time its children do not explain', () => {
		const { rows } = buildTrace(spans, { now: T + 100 });
		const run = rows[0];
		expect(run.total).toBe(100);
		// 0–10 before the model, 40–50 between the two, 90–100 after the tool.
		expect(run.self).toBe(30);
		expect(run.own.map((i) => [i.from - T, i.to - T])).toEqual([
			[0, 10],
			[40, 50],
			[90, 100]
		]);
	});

	it('leaves a leaf owning all of its own time', () => {
		const { rows } = buildTrace(spans, { now: T + 100 });
		expect(rows[1].self).toBe(rows[1].total);
	});

	it('does not move once the run is over', () => {
		// The frontier only reaches for the current clock when something is still
		// open. Without that, a finished trace left on screen would have every bar
		// shrink a little further every second.
		const early = buildTrace(spans, { now: T + 100 });
		const later = buildTrace(spans, { now: T + 9_999_999 });
		expect(later.duration).toBe(early.duration);
		expect(later.rows[0].total).toBe(100);
	});
});

describe('siblings that overlap', () => {
	// Two paper readers in flight at once. This is the case that makes self time
	// a union rather than a sum: summed, the children come to 100ms of a 100ms
	// parent and the parent appears to have done nothing at all.
	const spans = [
		span('run', 0, 100),
		span('reader-a', 10, 60, { parentId: 'run' }),
		span('reader-b', 40, 90, { parentId: 'run' })
	];

	it('counts the wall clock once, not once per child', () => {
		const { rows } = buildTrace(spans, { now: T + 100 });
		expect(rows[0].self).toBe(20);
		expect(rows[0].own.map((i) => [i.from - T, i.to - T])).toEqual([
			[0, 10],
			[90, 100]
		]);
	});

	it('never lets self time go negative', () => {
		const smothered = buildTrace(
			[
				span('run', 0, 50),
				span('a', 0, 50, { parentId: 'run' }),
				span('b', 0, 50, { parentId: 'run' })
			],
			{ now: T + 50 }
		);
		expect(smothered.rows[0].self).toBe(0);
		expect(smothered.rows[0].own).toEqual([]);
	});
});

describe('a span whose parent is missing', () => {
	// The parent was sampled away, or the process died before it was exported.
	const spans = [span('run', 0, 100), span('stray', 20, 30, { parentId: 'never-exported' })];

	it('promotes it to a root and says so', () => {
		const trace = buildTrace(spans, { now: T + 100 });
		expect(trace.roots.map((n) => n.span.id)).toEqual(['run', 'stray']);
		expect(trace.roots[1].orphan).toBe(true);
		expect(trace.roots[0].orphan).toBe(false);
	});

	it('still measures it, because the time was still spent', () => {
		const trace = buildTrace(spans, { now: T + 100 });
		expect(trace.rows.find((n) => n.span.id === 'stray')?.total).toBe(10);
		// And it is not subtracted from anything — an orphan is nobody's child.
		expect(trace.rows[0].self).toBe(100);
	});
});

describe('a span that never ended', () => {
	// An aborted run, or a panel drawing a trace while it is still happening.
	const spans = [span('run', 0, undefined), span('model', 10, 40, { parentId: 'run' })];

	it('runs to the frontier and is flagged open', () => {
		const trace = buildTrace(spans, { now: T + 100 });
		expect(trace.open).toBe(1);
		expect(trace.rows[0].open).toBe(true);
		expect(trace.rows[0].total).toBe(100);
		expect(trace.rows[0].self).toBe(70);
		expect(trace.duration).toBe(100);
	});

	it('never draws shorter than the spans it contains', () => {
		// A clock that disagrees with the trace must not produce a parent whose
		// bar ends before its own child's does.
		const trace = buildTrace(spans, { now: T - 5000 });
		expect(trace.rows[0].total).toBeGreaterThanOrEqual(trace.rows[1].total);
		expect(trace.rows[0].total).toBe(40);
	});
});

describe('a child that outlives its parent', () => {
	// A write nobody awaited. Its own duration is honest; only the part that
	// overlapped the parent may be subtracted from the parent.
	const spans = [span('run', 0, 50), span('detached', 20, 80, { parentId: 'run' })];

	it('clamps the subtraction to the parent, not the child', () => {
		const { rows } = buildTrace(spans, { now: T + 80 });
		expect(rows[0].total).toBe(50);
		expect(rows[0].self).toBe(20);
		expect(rows[1].total).toBe(60);
	});
});

describe('ids that repeat', () => {
	// A retried step can export the same span id twice. Two rows sharing an
	// {#each} key throws, and the throw aborts the render.
	const spans = [
		span('step', 0, 100),
		span('step', 10, 20),
		span('leaf', 30, 40, { parentId: 'step' })
	];

	it('gives every node a key of its own', () => {
		const { rows } = buildTrace(spans, { now: T + 100 });
		const keys = rows.map((n) => n.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain('step');
		expect(keys).toContain('step#2');
	});

	it('resolves a parent to the first claimant, so the tree stays a tree', () => {
		const trace = buildTrace(spans, { now: T + 100 });
		expect(trace.roots.map((n) => n.key)).toEqual(['step', 'step#2']);
		expect(trace.roots[0].children.map((n) => n.span.id)).toEqual(['leaf']);
	});
});

describe('a parent chain that loops', () => {
	it('terminates, and shows both spans rather than neither', () => {
		const trace = buildTrace(
			[span('a', 0, 100, { parentId: 'b' }), span('b', 10, 90, { parentId: 'a' })],
			{ now: T + 100 }
		);
		expect(trace.rows).toHaveLength(2);
		expect(trace.roots.every((n) => n.orphan)).toBe(true);
	});

	it('survives a span that claims itself as its parent', () => {
		const trace = buildTrace([span('self', 0, 10, { parentId: 'self' })], { now: T + 10 });
		expect(trace.roots).toHaveLength(1);
		expect(trace.roots[0].orphan).toBe(true);
	});
});

describe('degenerate input', () => {
	it('an empty list is an empty trace, not a division by zero waiting to happen', () => {
		const trace = buildTrace([], { now: T });
		expect(trace.rows).toEqual([]);
		expect(trace.duration).toBe(0);
		expect(trace.depth).toBe(0);
	});

	it('drops only what has no identity or no start', () => {
		const trace = buildTrace(
			[
				span('good', 0, 10),
				{ id: '', name: 'nameless', kind: 'generic', startedAt: T },
				{ id: 'nan', name: 'no clock', kind: 'generic', startedAt: Number.NaN }
			],
			{ now: T + 10 }
		);
		expect(trace.rows.map((n) => n.span.id)).toEqual(['good']);
	});

	it('clamps a span that ended before it started to zero width', () => {
		const trace = buildTrace([span('backwards', 100, 50)], { now: T + 100 });
		expect(trace.rows[0].total).toBe(0);
		expect(trace.rows[0].self).toBe(0);
	});
});

describe('hotspots', () => {
	it('rank by self time, so the root does not win by default', () => {
		const trace = buildTrace(
			[
				span('run', 0, 100),
				span('model', 5, 95, { parentId: 'run' }),
				span('tool', 10, 30, { parentId: 'model' })
			],
			{ now: T + 100 }
		);
		expect(hotspots(trace).map((n) => n.span.id)).toEqual(['model', 'tool', 'run']);
	});
});

describe('readouts', () => {
	it('never rounds a span that happened down to nothing', () => {
		expect(ms(0)).toBe('0ms');
		expect(ms(0.4)).toBe('<1ms');
		expect(ms(42)).toBe('42ms');
		expect(ms(1500)).toBe('1.50s');
		expect(ms(64_200)).toBe('64.2s');
		expect(ms(Number.NaN)).toBe('—');
	});

	it('flattens attributes without letting one of them fill the panel', () => {
		const rows = attributeRows(
			span('x', 0, 1, {
				attributes: { model: 'gpt-5', prompt: 'a '.repeat(400), tokens: { in: 12, out: 3 } }
			}),
			{ chars: 20 }
		);
		expect(rows.map((r) => r.key)).toEqual(['model', 'prompt', 'tokens']);
		expect(rows[1].value).toHaveLength(20);
		expect(rows[1].value.endsWith('…')).toBe(true);
		expect(rows[2].value).toBe('{"in":12,"out":3}');
	});

	it('names an attribute it cannot serialise instead of dropping the row', () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const rows = attributeRows(span('x', 0, 1, { attributes: { cyclic } }));
		expect(rows).toEqual([{ key: 'cyclic', value: '[unserialisable]' }]);
	});
});
