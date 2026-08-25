/**
 * A run's latency, given a shape.
 *
 * A span is one interval of work with a name on it: the agent run, a model
 * call, the tool execution inside that, the memory read inside *that*.
 * Collectors emit them **flat** — each span carrying its parent's id rather
 * than a reference — because that is the only form that survives a process
 * which may end before the tree does. Putting the tree back together is this
 * module's whole job, and it is pure: no Mastra, no fetch, no clock beyond the
 * one you hand it, so the arithmetic below can be tested against the cases that
 * actually break it.
 *
 * ── Self time is a subtraction, and the subtraction is a union ──────────────
 * The number worth reading is not how long a span took. It is how long it took
 * that its children do not already explain. A four-second agent run holding
 * 3.9 seconds of model call is not a slow agent; it is a slow model, and a
 * chart that only shows totals says the opposite.
 *
 * So self time is total minus the time *covered by* children — covered by, not
 * summed over. Two children running concurrently, two paper readers in flight
 * at once, cover one stretch of wall clock between them and not two. Summing
 * their durations over-subtracts and pushes self time negative, which is how a
 * flame chart ends up drawing a parent that finished before it started. The
 * intervals get merged first.
 *
 * That is the one piece of arithmetic here that is easy to get wrong and hard
 * to notice, which is why `own` is published rather than just the number: a bar
 * can then be drawn solid where the span was doing its own work and hollow
 * where a child had the floor, and the picture cannot disagree with the total.
 *
 * ── What it refuses to drop ─────────────────────────────────────────────────
 * Traces arrive damaged. A parent whose span was never exported. A span that
 * never closed because the run was aborted. Two spans sharing an id after a
 * retry. A parent chain that loops. Every one of those is kept, flagged and
 * measured as well as it can be, because a trace viewer that quietly omits the
 * span it could not place is worse than none — the missing time reads as time
 * that was never spent.
 */

/** One span, flat, exactly as a collector hands it over. */
export interface TraceSpan {
	id: string;
	/** The span this one ran inside. Absent on a root. */
	parentId?: string;
	name: string;
	/**
	 * What kind of work this was.
	 *
	 * Mastra's own `SpanType` strings pass through unchanged — `agent_run`,
	 * `model_inference`, `tool_call`, `memory_operation` — so a collector never
	 * has to translate on the way in and a new span type from an upgrade shows
	 * up as itself rather than as "other".
	 */
	kind: string;
	/** Epoch milliseconds. */
	startedAt: number;
	/** Epoch milliseconds. Absent while the span is still open. */
	endedAt?: number;
	/** Whatever the span carried. Shown on hover; never interpreted here. */
	attributes?: Record<string, unknown>;
	/** The span ended in an error. */
	failed?: boolean;
}

/** A half-open interval of wall clock, in epoch milliseconds. */
export interface Interval {
	from: number;
	to: number;
}

export interface TraceNode {
	span: TraceSpan;
	/**
	 * Unique within the trace even when two spans share an id.
	 *
	 * Use this as the `{#each}` key, never `span.id`: a retry that reuses an id
	 * would give two rows the same key, and a duplicate key throws — and the
	 * throw aborts the render, leaving the previous frame on screen.
	 */
	key: string;
	depth: number;
	/** Milliseconds from the trace's first start to this span's start. */
	offset: number;
	/** Wall-clock milliseconds occupied, measured to the frontier if still open. */
	total: number;
	/** `total` minus the stretches a child had the floor. Never negative. */
	self: number;
	/** The stretches that make up `self`, in epoch ms, in order. Draw these solid. */
	own: Interval[];
	/** No end time: still running, or the run died before it closed. */
	open: boolean;
	/** Its parent is not in this list — or naming it would have closed a loop. */
	orphan: boolean;
	children: TraceNode[];
}

export interface Trace {
	roots: TraceNode[];
	/** Depth-first, pre-order: the order a flame chart draws in. */
	rows: TraceNode[];
	/** Earliest start across every span. Zero when there are none. */
	startedAt: number;
	/**
	 * The frontier — the latest end anything is known to have reached, which is
	 * where unfinished spans are drawn to.
	 */
	endedAt: number;
	/** `endedAt - startedAt`. Zero for an empty trace, so guard before dividing. */
	duration: number;
	/** Deepest nesting, counted from 0. */
	depth: number;
	/** How many spans never closed. */
	open: number;
}

const EMPTY_TRACE: Trace = {
	roots: [],
	rows: [],
	startedAt: 0,
	endedAt: 0,
	duration: 0,
	depth: 0,
	open: 0
};

function isUsable(span: TraceSpan): boolean {
	return (
		Boolean(span) &&
		typeof span.id === 'string' &&
		span.id !== '' &&
		Number.isFinite(span.startedAt)
	);
}

/**
 * When a span ended, for measurement.
 *
 * Clamped forward of its own start so a clock that went backwards mid-run — or
 * a fixture written carelessly — produces a zero-width bar rather than a
 * negative one that would draw off the left edge of the track.
 */
function endOf(span: TraceSpan, frontier: number): number {
	return Math.max(span.startedAt, span.endedAt ?? frontier);
}

/** Overlapping intervals, flattened into disjoint ones in start order. */
function merge(intervals: Interval[]): Interval[] {
	if (intervals.length < 2) return intervals.slice();
	const sorted = [...intervals].sort((a, b) => a.from - b.from);
	const out: Interval[] = [{ ...sorted[0] }];
	for (const next of sorted.slice(1)) {
		const last = out[out.length - 1];
		if (next.from > last.to) out.push({ ...next });
		else if (next.to > last.to) last.to = next.to;
	}
	return out;
}

/** What is left of `[from, to]` once the (disjoint, sorted) `covered` is removed. */
function complement(covered: Interval[], from: number, to: number): Interval[] {
	const out: Interval[] = [];
	let at = from;
	for (const gap of covered) {
		if (gap.from > at) out.push({ from: at, to: Math.min(gap.from, to) });
		at = Math.max(at, gap.to);
		if (at >= to) break;
	}
	if (at < to) out.push({ from: at, to });
	return out.filter((i) => i.to > i.from);
}

/**
 * Would making `parent` the parent of `id` close a loop?
 *
 * Walks the *declared* chain — parent ids, not the tree being built — so the
 * answer does not depend on the order spans happen to arrive in. The `seen` set
 * is not belt and braces: a pair of spans naming each other is already a loop
 * before this node joins it, and without it this walk would not terminate.
 */
function closesALoop(parent: TraceNode, id: string, byId: Map<string, TraceNode>): boolean {
	const seen = new Set<string>();
	let at: TraceNode | undefined = parent;
	while (at) {
		if (at.span.id === id || seen.has(at.span.id)) return true;
		seen.add(at.span.id);
		at = at.span.parentId ? byId.get(at.span.parentId) : undefined;
	}
	return false;
}

/**
 * Flat spans in, tree out.
 *
 * `now` is a parameter rather than a call to `Date.now()` for two reasons: it
 * makes every duration below deterministic under test, and it is the only
 * honest way to measure a span that never closed. A live run passes the real
 * clock. A trace read back out of storage hours later should pass the moment
 * the run stopped — otherwise its one unclosed span draws as a bar hours long
 * and swamps everything that actually happened.
 */
export function buildTrace(
	spans: readonly TraceSpan[],
	{ now = Date.now() }: { now?: number } = {}
): Trace {
	const usable = spans.filter(isUsable);
	if (!usable.length) return { ...EMPTY_TRACE, roots: [], rows: [] };

	let startedAt = Infinity;
	let latest = -Infinity;
	let open = 0;
	for (const span of usable) {
		startedAt = Math.min(startedAt, span.startedAt);
		latest = Math.max(latest, span.startedAt, span.endedAt ?? -Infinity);
		if (span.endedAt === undefined) open++;
	}

	// The frontier is where an unfinished span is drawn to. `now` only enters it
	// when something is *actually* still open: a run that finished ten minutes
	// ago ends when its last span ended, and folding the current clock into a
	// closed trace would make its bars shrink a little further every second the
	// panel stayed on screen.
	const frontier = open > 0 ? Math.max(latest, now) : latest;

	const used = new Set<string>();
	const made: TraceNode[] = usable.map((span) => {
		let key = span.id;
		for (let n = 2; used.has(key); n++) key = `${span.id}#${n}`;
		used.add(key);
		return {
			span,
			key,
			depth: 0,
			offset: 0,
			total: 0,
			self: 0,
			own: [],
			open: span.endedAt === undefined,
			orphan: false,
			children: []
		};
	});

	// First span wins an id. A retry that reuses one still gets its own row, but
	// parent lookups resolve to the original — which keeps the result a tree
	// rather than silently reparenting half of it onto the newcomer.
	const byId = new Map<string, TraceNode>();
	for (const node of made) if (!byId.has(node.span.id)) byId.set(node.span.id, node);

	const roots: TraceNode[] = [];
	for (const node of made) {
		const parentId = node.span.parentId;
		if (!parentId) {
			roots.push(node);
			continue;
		}
		const parent = byId.get(parentId);
		if (!parent || parent === node || closesALoop(parent, node.span.id, byId)) {
			// Promoted to a root and flagged, not dropped. A span whose parent was
			// sampled away or exported late is still time the run spent.
			node.orphan = true;
			roots.push(node);
			continue;
		}
		parent.children.push(node);
	}

	// Start order, then key, so a redraw of identical data is identical.
	const order = (a: TraceNode, b: TraceNode) =>
		a.span.startedAt - b.span.startedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
	roots.sort(order);
	for (const node of made) node.children.sort(order);

	const rows: TraceNode[] = [];
	let deepest = 0;

	const measure = (node: TraceNode, depth: number): void => {
		const from = node.span.startedAt;
		const to = endOf(node.span, frontier);
		node.depth = depth;
		node.offset = from - startedAt;
		node.total = to - from;
		if (depth > deepest) deepest = depth;
		rows.push(node);

		const covered: Interval[] = [];
		for (const child of node.children) {
			measure(child, depth + 1);
			// Clamped to the parent's own window. A child that outlives its parent —
			// a background write nobody awaited — must not subtract time the parent
			// was not even alive for.
			const cFrom = Math.max(child.span.startedAt, from);
			const cTo = Math.min(endOf(child.span, frontier), to);
			if (cTo > cFrom) covered.push({ from: cFrom, to: cTo });
		}

		node.own = complement(merge(covered), from, to);
		node.self = node.own.reduce((sum, i) => sum + (i.to - i.from), 0);
	};

	for (const root of roots) measure(root, 0);

	return {
		roots,
		rows,
		startedAt,
		endedAt: frontier,
		duration: Math.max(0, frontier - startedAt),
		depth: deepest,
		open
	};
}

/**
 * Where the time actually went.
 *
 * Ranked by self time, because ranking by total just re-lists the tree from the
 * root down — the root always wins, and the root is never the answer.
 */
export function hotspots(trace: Trace, limit = 8): TraceNode[] {
	return [...trace.rows]
		.filter((node) => node.self > 0)
		.sort((a, b) => b.self - a.self || a.offset - b.offset)
		.slice(0, limit);
}

/**
 * A duration, at a width that fits a 0.625rem column.
 *
 * Sub-millisecond spans are real and common — a cache hit, a memory read — and
 * rounding them to "0ms" makes a span that happened look like one that did not.
 */
export function ms(value: number): string {
	if (!Number.isFinite(value) || value < 0) return '—';
	if (value < 1) return value === 0 ? '0ms' : '<1ms';
	if (value < 1000) return `${Math.round(value)}ms`;
	const seconds = value / 1000;
	return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)}s`;
}

/**
 * A span's attributes, flattened for display.
 *
 * Sorted so the same span reads the same way twice, and truncated because an
 * attribute can be a whole prompt and a hover readout is not a document viewer.
 * Values are stringified here rather than in the component so the component
 * never has to decide what to do with a cyclic object.
 */
export function attributeRows(
	span: TraceSpan,
	{ limit = 12, chars = 160 } = {}
): { key: string; value: string }[] {
	const source = span.attributes ?? {};
	return Object.keys(source)
		.sort()
		.slice(0, limit)
		.map((key) => {
			const raw = source[key];
			let value: string;
			if (raw === null || raw === undefined) value = String(raw);
			else if (typeof raw === 'string') value = raw;
			else {
				try {
					value = JSON.stringify(raw) ?? String(raw);
				} catch {
					// Cyclic, or a BigInt. Naming the failure beats an empty row.
					value = '[unserialisable]';
				}
			}
			value = value.replace(/\s+/g, ' ').trim();
			return { key, value: value.length > chars ? `${value.slice(0, chars - 1)}…` : value };
		});
}
