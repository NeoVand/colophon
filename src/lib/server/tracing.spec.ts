import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TraceSpan } from '$lib/agent/trace';

/**
 * The collector, which is the piece that was missing between two finished
 * halves.
 *
 * `trace.ts` could build a flame chart and `TracePanel` could draw one; nothing
 * anywhere recorded a span, and the panel was mounted with none and defaulted to
 * reporting tracing as *on*. So the two properties worth pinning are:
 *
 *   1. spans are recorded unless someone turned them off, and
 *   2. they are announced as they open and close, because a latency readout
 *      that only arrives after the run is a receipt rather than an instrument.
 *
 * `$env/dynamic/private` is mocked because the flag decides everything here and
 * the real one is whatever the developer's `.env` happens to say.
 */

const { env } = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env }));

const { recorderFor, isTracingConfigured, tracingState, traceFor, forgetEverything } =
	await import('./tracing');

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	forgetEverything();
});

afterEach(() => forgetEverything());

describe('whether spans are recorded at all', () => {
	it('records with nothing configured', () => {
		// The reversal this project made deliberately: opt-in bought a finished
		// instrument that showed nothing until you found an undocumented
		// environment variable, which is the same failure as not wiring it.
		expect(isTracingConfigured()).toBe(true);
		expect(tracingState()).toEqual({ configured: true });
	});

	it.each(['off', '0', 'false', 'OFF'])('stops when COLOPHON_TRACING=%s', (value) => {
		env.COLOPHON_TRACING = value;
		expect(isTracingConfigured()).toBe(false);
		expect(tracingState().reason).toMatch(/COLOPHON_TRACING/);
	});

	it('hands back a recorder that discards, rather than making callers branch', () => {
		env.COLOPHON_TRACING = 'off';
		const seen: TraceSpan[] = [];
		const recorder = recorderFor('run', { onSpan: (s) => seen.push(s) });
		recorder.start({ name: 'agent', kind: 'agent_run' }).end();

		expect(seen).toEqual([]);
		expect(recorder.spans()).toEqual([]);
	});
});

describe('announcing spans as they happen', () => {
	it('announces once on open and once on close', () => {
		const seen: TraceSpan[] = [];
		const recorder = recorderFor('run-1', { onSpan: (s) => seen.push({ ...s }) });

		const root = recorder.start({ name: 'Colophon', kind: 'agent_run' });
		expect(seen).toHaveLength(1);
		expect(seen[0].endedAt).toBeUndefined();

		root.end();
		expect(seen).toHaveLength(2);
		expect(seen[1].id).toBe(seen[0].id);
		expect(seen[1].endedAt).toBeGreaterThan(0);
	});

	it('does not announce a second close', () => {
		// The natural call sites are a `finally` and a `catch`, so double-ending
		// is expected rather than exceptional — and a second end would move the
		// bar's right edge for a reason unrelated to the work.
		const seen: TraceSpan[] = [];
		const root = recorderFor('run-2', { onSpan: (s) => seen.push(s) }).start({
			name: 'a',
			kind: 'agent_run'
		});
		root.end();
		root.end();
		expect(seen).toHaveLength(2);
	});

	it('keeps a listener that throws away from the run', () => {
		// The caller did not ask to be observed. It asked to answer a question.
		const recorder = recorderFor('run-3', {
			onSpan: () => {
				throw new Error('the reader went away');
			}
		});
		expect(() => recorder.start({ name: 'a', kind: 'agent_run' }).end()).not.toThrow();
	});
});

describe('the clocks a caller can supply', () => {
	it('honours a start it was given, for a span it did not open on time', () => {
		// An agent step is opened lazily, on its first chunk — already some way
		// into the model call. Backdating it to the previous step's end is what
		// keeps the request latency before the first token inside the trace.
		const recorder = recorderFor('run-4');
		recorder
			.start({ name: 'step 1', kind: 'agent_step', startedAt: 1_000 })
			.end({ endedAt: 4_000 });

		const [span] = traceFor('run-4').spans;
		expect(span.startedAt).toBe(1_000);
		expect(span.endedAt).toBe(4_000);
	});

	it('nests a child under the span it was opened on', () => {
		const recorder = recorderFor('run-5');
		const root = recorder.start({ name: 'run', kind: 'agent_run' });
		const child = root.child({ name: 'search_papers', kind: 'tool_call' });
		child.end();
		root.end();

		const spans = traceFor('run-5').spans;
		expect(spans.find((s) => s.name === 'search_papers')?.parentId).toBe(root.id);
		expect(spans.find((s) => s.name === 'run')?.parentId).toBeUndefined();
	});
});

describe('what a bounded store owes its reader', () => {
	it('says when it dropped the tail rather than showing a short trace', () => {
		const recorder = recorderFor('run-6');
		// One over the 500 cap. A trace missing its tail silently reads as time
		// that was never spent.
		for (let i = 0; i < 501; i++) recorder.start({ name: `s${i}`, kind: 'tool_call' });

		const trace = traceFor('run-6');
		expect(trace.spans).toHaveLength(500);
		expect(trace.truncated).toBe(true);
	});

	it('does not announce a span the cap turned away', () => {
		const seen: TraceSpan[] = [];
		const recorder = recorderFor('run-7', { onSpan: (s) => seen.push(s) });
		for (let i = 0; i < 501; i++) recorder.start({ name: `s${i}`, kind: 'tool_call' });
		expect(seen).toHaveLength(500);
	});

	it('lets an update to a filed span through, cap or no cap', () => {
		// Closing a span is not a new span. Counting it against the cap would let
		// a long-running span evict the very children that explain it.
		const recorder = recorderFor('run-8');
		const first = recorder.start({ name: 's0', kind: 'tool_call' });
		for (let i = 1; i < 501; i++) recorder.start({ name: `s${i}`, kind: 'tool_call' });
		first.end();

		expect(traceFor('run-8').spans.find((s) => s.id === first.id)?.endedAt).toBeGreaterThan(0);
	});
});
