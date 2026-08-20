import { env } from '$env/dynamic/private';
import type { TraceSpan } from '$lib/agent/trace';
import type {
	AnyExportedSpan,
	ObservabilityExporter,
	ObservabilityInstance,
	TracingEvent
} from '@mastra/core/observability';

/**
 * Where the time went, kept for as long as it is worth looking at.
 *
 * Every other panel in the X-ray answers *what* happened. This one answers
 * *when*, and it is the only reading that makes a slow run explicable rather
 * than merely annoying: an eight-second answer is four model calls at two
 * seconds each, or one tool that hung, or nine paper readers that were supposed
 * to run at once and did not. Those look identical in a chat window and
 * identical in an event log.
 *
 * ── In memory, on purpose ───────────────────────────────────────────────────
 * A trace is worth a great deal while the run is on screen and almost nothing a
 * day later. Writing spans to Postgres would spend the storage that holds the
 * vault on data whose half-life is a page reload, so this holds the last few
 * runs in the function's own memory and lets the rest go. Same reasoning, and
 * the same `keep` bound, as `capture.ts`.
 *
 * That means a trace does not survive a cold start, and on Vercel it does not
 * survive being routed to a different instance. Said out loud rather than
 * discovered: if `traceFor()` comes back empty for a run that certainly
 * happened, this is why, and it is not a bug to hunt.
 *
 * ── Optional, and quiet about it ────────────────────────────────────────────
 * Same shape as `mail.ts`: `isTracingConfigured()` decides, everything else
 * degrades. With `COLOPHON_TRACING` unset, `recorderFor()` hands back a
 * recorder that discards, `traceFor()` returns nothing, and no call site needs
 * a branch around it.
 *
 * The one departure from `mail.ts` is deliberate. Sending a digest throws when
 * it cannot, because a caller who asked to deliver must learn that nothing was
 * delivered. Recording a span must never throw, because the caller did not ask
 * to be observed — it asked to answer a question, and a failure in the
 * instrument must not take down the thing it is measuring. So `attachTracing()`
 * returns a reason where `sendDigest()` raises one.
 *
 * ── What is wired, and what is not ──────────────────────────────────────────
 * Mastra emits real AI tracing spans, but only through an `Observability`
 * entrypoint from **`@mastra/observability`, which this project does not
 * install** — `@mastra/core` alone ships `NoOpObservability`, whose
 * `getDefaultInstance()` returns undefined and whose spans go nowhere. There is
 * no way to reach those spans from what is installed, and pretending otherwise
 * would be an integration that compiles and never fires.
 *
 * So there are two doors, and both are real:
 *
 *   `recorderFor(runId).start(...)` — hand-recorded spans, working today. The
 *       endpoint already knows when a turn began, when each tool ran and when
 *       the model was called; that is a trace, and it is read from the run
 *       rather than injected into the agent, which is the house rule.
 *
 *   `attachTracing(mastra, runId)` — the Mastra door. It looks for a real
 *       observability instance and registers `exporterFor()` on it. Today it
 *       returns `{ attached: false }` with the reason above. Install
 *       `@mastra/observability`, pass an `Observability` to `new Mastra({...})`,
 *       and the same call starts filing Mastra's own spans into the same store
 *       with no other change anywhere.
 */

/** Long enough for a research turn with a dozen tool calls; short enough to bound the heap. */
const MAX_SPANS_PER_RUN = 500;

/** Runs held at once, newest last. A serverless function is not a trace backend. */
const MAX_RUNS = 4;

/** An attribute can be a whole system prompt. This is a readout, not an archive. */
const MAX_ATTRIBUTE_KEYS = 16;
const MAX_ATTRIBUTE_CHARS = 240;

/**
 * Tracing is opt-in.
 *
 * Not because it is expensive — it is a few hundred small objects — but because
 * "no configuration, no spans" is the only default that cannot surprise anyone,
 * and because a panel that shows a trace should be showing one that was
 * deliberately turned on rather than one that accumulated by accident.
 *
 * `COLOPHON_TRACING=on` in `.env.local`.
 */
export function isTracingConfigured(): boolean {
	const value = env.COLOPHON_TRACING?.trim().toLowerCase();
	return value === 'on' || value === '1' || value === 'true';
}

export interface TracingState {
	configured: boolean;
	/** Present when it is not. Says what to set, in the words of the setting. */
	reason?: string;
}

export function tracingState(): TracingState {
	return isTracingConfigured()
		? { configured: true }
		: { configured: false, reason: 'COLOPHON_TRACING is not set, so no spans are being recorded.' };
}

/** One run's spans, plus the one fact a bounded store owes its reader. */
export interface RunTrace {
	runId: string;
	spans: TraceSpan[];
	/** True when the run produced more spans than the cap and the tail was dropped. */
	truncated: boolean;
}

/** A span that has been opened and not yet closed. */
export interface OpenSpan {
	id: string;
	/** Open a span inside this one. */
	child(options: StartOptions): OpenSpan;
	/** Close it. Calling twice is harmless — the first end is the one that counts. */
	end(options?: { attributes?: Record<string, unknown>; failed?: boolean }): void;
}

export interface StartOptions {
	name: string;
	/** Mastra's `SpanType` strings, or your own. Passed through untouched. */
	kind: string;
	/** Only needed when the parent is not the span you called `child()` on. */
	parentId?: string;
	attributes?: Record<string, unknown>;
}

export interface Recorder {
	runId: string;
	/** Open a root span for this run. */
	start(options: StartOptions): OpenSpan;
	/** File a span that is already complete — one read off something else's clock. */
	record(span: TraceSpan): void;
	/** Everything filed so far, in the order it was opened. */
	spans(): TraceSpan[];
}

/* ── the store ────────────────────────────────────────────────────────────── */

interface Held {
	spans: Map<string, TraceSpan>;
	truncated: boolean;
	/**
	 * The Mastra trace this run was pinned to, once one has been seen.
	 *
	 * A Mastra instance can outlive the request that built it, and an exporter
	 * registered on it keeps receiving spans afterwards. Without a pin, a second
	 * conversation's spans would land in the first conversation's trace and draw
	 * as one impossibly long run. First trace id wins; later ones are ignored.
	 */
	traceId?: string;
}

/** Insertion-ordered, which is what makes eviction "oldest first" without a timestamp. */
const runs = new Map<string, Held>();

function held(runId: string): Held {
	let entry = runs.get(runId);
	if (!entry) {
		entry = { spans: new Map(), truncated: false };
		runs.set(runId, entry);
		while (runs.size > MAX_RUNS) {
			const oldest = runs.keys().next().value;
			if (oldest === undefined) break;
			runs.delete(oldest);
		}
	}
	return entry;
}

/**
 * Attributes, cut down to something a hover readout can hold.
 *
 * Mastra's `AgentRunAttributes.instructions` is the entire system prompt and
 * `prompt` is the entire user turn. Five hundred spans carrying those would be
 * megabytes held in a serverless function to render a tooltip. Values are
 * truncated rather than dropped: knowing an attribute was present and roughly
 * what it said is most of its value here, and the full text is already in the
 * context panel, which is the panel that owes it.
 */
function trim(source: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!source) return undefined;
	const out: Record<string, unknown> = {};
	let kept = 0;
	for (const key of Object.keys(source)) {
		if (kept >= MAX_ATTRIBUTE_KEYS) break;
		const value = source[key];
		if (value === undefined) continue;
		if (typeof value === 'string') {
			out[key] =
				value.length > MAX_ATTRIBUTE_CHARS ? `${value.slice(0, MAX_ATTRIBUTE_CHARS)}…` : value;
		} else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
			out[key] = value;
		} else {
			let text: string;
			try {
				text = JSON.stringify(value) ?? String(value);
			} catch {
				text = '[unserialisable]';
			}
			out[key] =
				text.length > MAX_ATTRIBUTE_CHARS ? `${text.slice(0, MAX_ATTRIBUTE_CHARS)}…` : text;
		}
		kept++;
	}
	return kept ? out : undefined;
}

function file(entry: Held, span: TraceSpan): void {
	// An update to a span already filed is not a new span, so it must not count
	// against the cap — otherwise a long-running span that reports progress
	// would evict the very children that explain it.
	if (!entry.spans.has(span.id) && entry.spans.size >= MAX_SPANS_PER_RUN) {
		entry.truncated = true;
		return;
	}
	entry.spans.set(span.id, span);
}

/* ── recording by hand ────────────────────────────────────────────────────── */

const NO_OP_SPAN: OpenSpan = {
	id: '',
	child: () => NO_OP_SPAN,
	end: () => {}
};

const NO_OP_RECORDER: Recorder = {
	runId: '',
	start: () => NO_OP_SPAN,
	record: () => {},
	spans: () => []
};

let counter = 0;

function mintId(runId: string): string {
	// Deliberately not `crypto.randomUUID()`: the id shows up in the panel's
	// hover readout, and a monotonic one tells you the order spans were opened
	// in even after the tree has reordered them by start time.
	counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
	return `${runId || 'run'}-${counter.toString(36)}`;
}

/**
 * The recorder for one run.
 *
 * Safe to call, and safe to use, whether or not tracing is configured — when it
 * is not, this is the discarding recorder and every method is a no-op. That is
 * the whole reason the seam is a recorder rather than a bare function: the
 * endpoint writes the same six lines either way, with no `if` around them.
 */
export function recorderFor(runId: string): Recorder {
	if (!isTracingConfigured()) return NO_OP_RECORDER;

	const entry = held(runId);

	const open = (options: StartOptions, parentId?: string): OpenSpan => {
		const id = mintId(runId);
		const span: TraceSpan = {
			id,
			parentId: options.parentId ?? parentId,
			name: options.name,
			kind: options.kind,
			startedAt: Date.now(),
			attributes: trim(options.attributes)
		};
		file(entry, span);

		let closed = false;
		return {
			id,
			child: (child) => open(child, id),
			end: (result) => {
				// Idempotent because the natural call sites are a `finally` and a
				// catch, and a second end would move the bar's right edge for a
				// reason that has nothing to do with the work.
				if (closed) return;
				closed = true;
				span.endedAt = Date.now();
				if (result?.failed) span.failed = true;
				if (result?.attributes) {
					span.attributes = trim({ ...(span.attributes ?? {}), ...result.attributes });
				}
				file(entry, span);
			}
		};
	};

	return {
		runId,
		start: (options) => open(options),
		record: (span) => {
			if (!span?.id || !Number.isFinite(span.startedAt)) return;
			file(entry, { ...span, attributes: trim(span.attributes) });
		},
		spans: () => [...entry.spans.values()]
	};
}

/** What the panel reads. Empty and honest when nothing was recorded. */
export function traceFor(runId: string): RunTrace {
	const entry = runs.get(runId);
	return {
		runId,
		spans: entry ? [...entry.spans.values()] : [],
		truncated: entry?.truncated ?? false
	};
}

/** Let a finished run go early, rather than waiting for it to be evicted. */
export function forgetRun(runId: string): void {
	runs.delete(runId);
}

/** Only for tests, and for a dev server that would otherwise carry runs across an edit. */
export function forgetEverything(): void {
	runs.clear();
}

/* ── the Mastra door ──────────────────────────────────────────────────────── */

/** Mastra hands `Date`s; storage round-trips can hand strings. Both mean the same instant. */
function at(value: Date | string | number | undefined): number | undefined {
	if (value === undefined || value === null) return undefined;
	const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
	return Number.isFinite(time) ? time : undefined;
}

/**
 * A Mastra exported span, in this app's shape.
 *
 * `type` passes through as `kind` verbatim: Mastra's vocabulary is already the
 * right one — `model_inference` is a more useful label than anything this
 * module could invent — and a span type added by a future release then appears
 * as itself instead of as "other".
 */
export function fromExportedSpan(exported: AnyExportedSpan): TraceSpan | undefined {
	const startedAt = at(exported.startTime);
	if (!exported?.id || startedAt === undefined) return undefined;

	return {
		id: exported.id,
		parentId: exported.parentSpanId,
		name: exported.name ?? String(exported.type),
		kind: String(exported.type),
		startedAt,
		endedAt: at(exported.endTime),
		attributes: trim({
			...(exported.attributes as Record<string, unknown> | undefined),
			...(exported.entityName ? { entity: exported.entityName } : {}),
			...(exported.errorInfo ? { error: exported.errorInfo.message } : {})
		}),
		failed: Boolean(exported.errorInfo)
	};
}

/**
 * An exporter that files Mastra's spans into this run's trace.
 *
 * Every tracing event is treated as an upsert keyed by span id, rather than
 * being switched on the event type. A span is started, updated and ended as
 * three events carrying the same id, and the last one always carries the fullest
 * picture — so "replace what is there" is both simpler than a switch and
 * immune to a release adding a fourth event type. Whether a span is still open
 * is read from `endTime`, which is the fact itself rather than a proxy for it.
 */
export function exporterFor(runId: string): ObservabilityExporter {
	const entry = held(runId);

	const take = (event: TracingEvent): void => {
		const exported = event?.exportedSpan;
		if (!exported) return;

		// See `Held.traceId`. A registered exporter outlives its request.
		if (exported.traceId) {
			entry.traceId ??= exported.traceId;
			if (entry.traceId !== exported.traceId) return;
		}

		const span = fromExportedSpan(exported);
		if (span) file(entry, span);
	};

	return {
		name: 'colophon-xray',
		// Both hooks, same body. `exportTracingEvent` is the required one;
		// `onTracingEvent` is what the event bus calls when one is in play, and
		// which of the two fires is not this module's business.
		exportTracingEvent: async (event) => take(event),
		onTracingEvent: (event) => take(event),
		flush: async () => {},
		shutdown: async () => {}
	};
}

export interface Attachment {
	attached: boolean;
	/** Present when it is not. Says exactly what is missing. */
	reason?: string;
}

/**
 * The narrow slice of a Mastra instance this needs, declared structurally.
 *
 * Not `import type { Mastra }`: this has to accept an instance that may not
 * have an observability entrypoint at all, and describing the two calls it
 * makes is both smaller and more honest about how little it touches.
 */
interface MaybeObservable {
	observability?: {
		getDefaultInstance?(): ObservabilityInstance | undefined;
	};
}

/**
 * Point Mastra's tracing at this run, if there is any tracing to point.
 *
 * Returns rather than throws, and swallows rather than propagates: a run must
 * not fail because the instrument could not be attached. The reason is carried
 * out so the panel can say which of the three possible absences it is — tracing
 * off, no observability package, or an instance that will not take an exporter
 * — instead of showing the same blank in all three cases.
 */
export function attachTracing(mastra: MaybeObservable | undefined, runId: string): Attachment {
	if (!isTracingConfigured()) return { attached: false, reason: tracingState().reason };

	try {
		const instance = mastra?.observability?.getDefaultInstance?.();
		if (!instance) {
			return {
				attached: false,
				reason:
					'Mastra has no observability instance. @mastra/core ships a no-op; ' +
					'real spans need @mastra/observability installed and an Observability ' +
					'passed to new Mastra({ observability }).'
			};
		}
		if (typeof instance.registerExporter !== 'function') {
			return {
				attached: false,
				reason: 'This observability instance does not accept exporters at runtime.'
			};
		}
		instance.registerExporter(exporterFor(runId));
		return { attached: true };
	} catch (cause) {
		return { attached: false, reason: cause instanceof Error ? cause.message : String(cause) };
	}
}
