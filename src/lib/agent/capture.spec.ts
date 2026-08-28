import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCapture, captureFor, forgetCaptures } from './capture';

/**
 * The store that lets a request outlive the run that made it.
 *
 * Without it the context panel could name a piece and never show it: the
 * decomposition on the event stream is deliberately light — the pieces of a
 * request *are* the request, so carrying their text would be the request sent
 * twice on every call — and `/api/context` reads the body back from here
 * instead.
 *
 * Bounded, in memory, and lost on a cold start. That is a real limitation, and
 * it is tested rather than merely written down.
 */

const ok = () => new Response('{}', { status: 200 });

afterEach(() => {
	forgetCaptures();
	vi.unstubAllGlobals();
});

async function send(capture: { fetch: typeof globalThis.fetch }, body: unknown) {
	await capture.fetch('https://api.openai.com/v1/responses', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

describe('holding a capture past its request', () => {
	it('files nothing when no key is given', () => {
		// The lab routes want a capture that vanishes with the request.
		createCapture();
		expect(captureFor('')).toBeUndefined();
	});

	it('hands back the same requests a later reader asks for', async () => {
		vi.stubGlobal('fetch', vi.fn(ok));
		const capture = createCapture({ key: 'thread-1' });
		await send(capture, { model: 'gpt-5', input: [{ role: 'user', content: 'hello' }] });

		const held = captureFor('thread-1');
		expect(held?.requests).toHaveLength(1);
		expect((held?.requests[0].body as { model: string }).model).toBe('gpt-5');
	});

	it('numbers calls from one, which is what the pager pages over', async () => {
		vi.stubGlobal('fetch', vi.fn(ok));
		const capture = createCapture({ key: 'thread-2' });
		await send(capture, { input: [] });
		await send(capture, { input: [] });

		expect(captureFor('thread-2')?.requests.map((r) => r.seq)).toEqual([1, 2]);
	});

	it('replaces a thread rather than merging into it', async () => {
		// A new turn on the same thread starts over. Merging would let the panel
		// page back into a previous turn's calls under this turn's numbering,
		// which is a readout that looks fine and describes two different runs.
		vi.stubGlobal('fetch', vi.fn(ok));
		const first = createCapture({ key: 'thread-3' });
		await send(first, { input: [] });

		const second = createCapture({ key: 'thread-3' });
		await send(second, { input: [] });

		expect(captureFor('thread-3')?.requests).toHaveLength(1);
		expect(captureFor('thread-3')).toBe(second);
	});

	it('lets the oldest conversation go rather than growing without bound', () => {
		for (let i = 0; i < 6; i++) createCapture({ key: `t${i}` });
		expect(captureFor('t0')).toBeUndefined();
		expect(captureFor('t1')).toBeUndefined();
		expect(captureFor('t5')).toBeDefined();
	});

	it('keeps enough calls for a pager to reach the start of a turn', async () => {
		// Four was right when the only reader was a panel showing the latest call.
		// A pager that cannot reach call 3 of a twelve-call turn is a pager in
		// name only.
		vi.stubGlobal('fetch', vi.fn(ok));
		const capture = createCapture({ key: 'thread-4' });
		for (let i = 0; i < 12; i++) await send(capture, { input: [] });

		expect(captureFor('thread-4')?.requests).toHaveLength(12);
		expect(captureFor('thread-4')?.requests[0].seq).toBe(1);
	});
});
