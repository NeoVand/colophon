import { describe, expect, it, vi } from 'vitest';
import { StalledUpstream, watchdog } from './watchdog';

/**
 * Fake timers throughout, because the thing under test is *waiting* and a test
 * that really waits ninety seconds is a test nobody runs.
 */

/** A body that emits `chunks` when told to, and never on its own. */
function pump() {
	let push!: (value: Uint8Array) => void;
	let close!: () => void;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			push = (value) => controller.enqueue(value);
			close = () => controller.close();
		}
	});
	return { body, push, close };
}

const bytes = (s: string) => new TextEncoder().encode(s);

async function drain(response: Response): Promise<string> {
	return await new Response(response.body).text();
}

describe('watchdog', () => {
	it('passes a prompt response straight through', async () => {
		const inner = vi.fn(async () => new Response('ok', { status: 201, statusText: 'Created' }));
		const res = await watchdog(inner)('https://example.test/x');
		expect(res.status).toBe(201);
		expect(await res.text()).toBe('ok');
	});

	it('trips when headers never arrive, and says so', async () => {
		vi.useFakeTimers();
		try {
			// Never resolves on its own; only the abort ends it — which is exactly
			// the upstream behaviour that hung the real run.
			const inner: typeof globalThis.fetch = (_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
				});

			const pending = watchdog(inner, { headersMs: 90_000 })('https://example.test/slow');
			const assertion = expect(pending).rejects.toThrow(StalledUpstream);
			await vi.advanceTimersByTimeAsync(90_001);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it('names the deadline and the url it was waiting on', async () => {
		vi.useFakeTimers();
		try {
			const inner: typeof globalThis.fetch = (_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
				});
			const pending = watchdog(inner, { headersMs: 1_000 })('https://example.test/slow').catch(
				(e) => e
			);
			await vi.advanceTimersByTimeAsync(1_001);
			const error = (await pending) as StalledUpstream;
			expect(error.url).toBe('https://example.test/slow');
			expect(error.message).toMatch(/no response headers within 1000ms/);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not trip while the stream keeps producing', async () => {
		vi.useFakeTimers();
		try {
			const { body, push, close } = pump();
			const inner = vi.fn(async () => new Response(body));
			const res = await watchdog(inner, { idleMs: 1_000 })('https://example.test/s');
			const text = drain(res);

			// Three gaps, each just under the deadline. A total budget would have
			// killed this at 1s; a silence budget must not.
			for (const part of ['a', 'b', 'c']) {
				await vi.advanceTimersByTimeAsync(900);
				push(bytes(part));
			}
			close();
			expect(await text).toBe('abc');
		} finally {
			vi.useRealTimers();
		}
	});

	it('trips when a started stream goes quiet', async () => {
		vi.useFakeTimers();
		try {
			const { body, push } = pump();
			const inner = vi.fn(async () => new Response(body));
			const res = await watchdog(inner, { idleMs: 1_000 })('https://example.test/s');
			const text = drain(res).catch((e) => e);

			push(bytes('partial'));
			await vi.advanceTimersByTimeAsync(1_001);
			// A named fault, not a bare AbortError — the reader has to be able to
			// tell a stalled provider from a person pressing stop.
			const error = (await text) as StalledUpstream;
			expect(error).toBeInstanceOf(StalledUpstream);
			expect(error.message).toMatch(/stream went quiet for 1000ms/);
		} finally {
			vi.useRealTimers();
		}
	});

	it("leaves the caller's own abort working", async () => {
		const stop = new AbortController();
		const inner: typeof globalThis.fetch = (_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
			});

		const pending = watchdog(inner)('https://example.test/x', { signal: stop.signal }).catch(
			(e) => e
		);
		stop.abort(new Error('user pressed stop'));
		const error = await pending;
		// Not a StalledUpstream: a person stopping a run is the product working,
		// and reporting it as an upstream fault would be a lie in the events panel.
		expect(error).not.toBeInstanceOf(StalledUpstream);
		expect((error as Error).message).toBe('user pressed stop');
	});

	it('forwards a signal that was already aborted', async () => {
		const inner: typeof globalThis.fetch = (_input, init) =>
			new Promise((_resolve, reject) => {
				if (init?.signal?.aborted) reject(init.signal.reason);
			});
		const stop = AbortSignal.abort(new Error('already gone'));
		await expect(watchdog(inner)('https://example.test/x', { signal: stop })).rejects.toThrow(
			'already gone'
		);
	});

	it('rethrows a genuine transport failure unchanged', async () => {
		const boom = new TypeError('getaddrinfo ENOTFOUND');
		const inner = vi.fn(async () => {
			throw boom;
		});
		await expect(watchdog(inner)('https://example.test/x')).rejects.toBe(boom);
	});
});
