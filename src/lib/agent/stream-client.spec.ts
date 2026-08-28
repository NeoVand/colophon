import { afterEach, describe, expect, it, vi } from 'vitest';
import { research } from './stream-client';
import type { WorkflowEvent } from './workflow-events';
import type { XrayEvent } from './events';

/**
 * The reader for the research stream.
 *
 * Worth its own tests for one reason: `/api/research` was reachable by no client
 * code at all, so nothing anywhere asserted that anything ever posts to it. The
 * first test below is that assertion, and it is the one that fails the day
 * someone quietly points the composer somewhere else.
 *
 * The framing is shared with `run()` deliberately — same `ready`/`event`/
 * `done`/`failed` frames, same heartbeat comments — so these also pin the parts
 * of the parser that a research run exercises and a chat run does not: the
 * `ready` payload, which carries the workflow's run id.
 */

const sse = (body: string) =>
	new Response(new Blob([body]).stream(), {
		headers: { 'content-type': 'text/event-stream' }
	});

const stub = (response: Response) => {
	const fetch = vi.fn(async () => response);
	vi.stubGlobal('fetch', fetch);
	return fetch;
};

afterEach(() => vi.unstubAllGlobals());

const frames = [
	'event: ready\ndata: {"at":1,"runId":"wf-1","workflowId":"deep-research"}',
	': keep-alive',
	'event: event\ndata: {"k":"step-start","step":"scope","at":1000}',
	'event: event\ndata: {"k":"step-finish","step":"scope","state":"done","ms":900}',
	'event: done\ndata: {"at":2}'
].join('\n\n');

describe('running the pipeline from the browser', () => {
	it('posts the question to /api/research', async () => {
		const fetch = stub(sse(frames));
		await research({ question: 'what changed?', onEvent: () => {} });

		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/research');
		expect(init.method).toBe('POST');
		expect(JSON.parse(String(init.body))).toEqual({ question: 'what changed?' });
	});

	it('hands over the run id before a token is spent', async () => {
		// A workflow run is created before it is started, so unlike a chat turn the
		// handle exists on the very first frame.
		stub(sse(frames));
		const ready = vi.fn();
		await research({ question: 'q', onEvent: () => {}, onReady: ready });

		expect(ready).toHaveBeenCalledWith(expect.any(Number), {
			at: 1,
			runId: 'wf-1',
			workflowId: 'deep-research'
		});
	});

	it('reads the stages, and ignores the heartbeat', async () => {
		stub(sse(frames));
		const seen: (WorkflowEvent | XrayEvent)[] = [];
		await research({ question: 'q', onEvent: (e) => seen.push(e) });

		expect(seen).toEqual([
			{ k: 'step-start', step: 'scope', at: 1000 },
			{ k: 'step-finish', step: 'scope', state: 'done', ms: 900 }
		]);
	});

	it('reports a refusal as an error rather than an empty run', async () => {
		stub(new Response('nope', { status: 503 }));
		const onError = vi.fn();
		await research({ question: 'q', onEvent: () => {}, onError });

		expect(onError).toHaveBeenCalledWith(expect.stringContaining('503'));
	});

	it('survives a ready frame it cannot parse', async () => {
		// `ready` exists to time first-byte; it is not load-bearing, and a
		// malformed one must not take the run down before it starts.
		stub(sse('event: ready\ndata: {oh dear\n\nevent: done\ndata: {}'));
		const ready = vi.fn();
		const onError = vi.fn();
		await research({ question: 'q', onEvent: () => {}, onReady: ready, onError });

		expect(ready).toHaveBeenCalledWith(expect.any(Number), undefined);
		expect(onError).not.toHaveBeenCalled();
	});
});
