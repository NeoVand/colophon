/**
 * A `fetch` that refuses to wait forever.
 *
 * ── Why this exists, and what it is NOT for ─────────────────────────────────
 * It was written after a run appeared to hang: seven paper-reader subagents
 * with live timers, four minutes of nothing, the process at 0% CPU, and one
 * open socket to the provider where six concurrent calls should have opened
 * six. That looked exactly like a stalled upstream.
 *
 * It was not one. `fanout.live.spec.ts` ran the same fan-out to completion —
 * 224s without memory, 268s with — so the run was slow, not stuck, and would
 * have finished if anyone had waited. The diagnosis was wrong, and this says so
 * rather than keeping the flattering version.
 *
 * What survived is the other half of that reasoning, which holds regardless:
 * **not one request in the agent path carried a deadline.** An upstream that
 * accepted a request and then went quiet really would have held the run open
 * forever, and nothing anywhere would have noticed. That the app had not yet
 * met one is luck rather than design.
 *
 * So this is a backstop against silence, never a budget on slowness, and the
 * deadlines are set far longer than any healthy turn observed. A watchdog that
 * fires on a slow-but-working run is worse than none: it converts a wait into a
 * failure the reader cannot tell from a real one.
 *
 * ── Two deadlines, not one ──────────────────────────────────────────────────
 * A single total timeout cannot work here. Model responses stream, and a long
 * research turn legitimately streams for minutes — so any total budget short
 * enough to catch a stall is short enough to kill real work.
 *
 * So the deadlines are on *silence*, which is the thing that actually
 * distinguishes a stall from slow progress:
 *
 *   headersMs   how long to wait for the response to begin at all
 *   idleMs      once it has begun, the longest gap allowed between chunks
 *
 * Both reset to "fine" the moment bytes arrive. A response streaming steadily
 * for an hour never trips either; a response that goes quiet trips `idleMs`
 * however long it had been healthy before. Reasoning models can think for a
 * long time before their first token, which is why `headersMs` is generous and
 * measured separately rather than folded into the same number.
 *
 * ── Failing loudly ──────────────────────────────────────────────────────────
 * A trip throws `StalledUpstream`, not a bare `AbortError`. The distinction is
 * the point: an `AbortError` is what a user pressing stop produces, and the two
 * must not be confused — one is the product working and the other is the
 * product broken. The message names which deadline went and how long it was.
 */

export class StalledUpstream extends Error {
	readonly url: string;
	constructor(message: string, url: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'StalledUpstream';
		this.url = url;
	}
}

export interface WatchdogOptions {
	/**
	 * Milliseconds to wait for response headers.
	 *
	 * Deliberately generous. A reasoning model handed a 140kB request can take
	 * well over a minute before it emits anything at all, and a false trip here
	 * aborts work that was about to succeed — which is a worse failure than the
	 * one being guarded against, because it is one the user cannot tell from a
	 * real fault.
	 */
	headersMs?: number;
	/**
	 * Milliseconds of silence allowed mid-stream.
	 *
	 * Shorter than `headersMs`, because a stream that has started has already
	 * proved the upstream is willing to talk — a long gap after that is far more
	 * likely to be a stall than to be thinking. Still two minutes, which is
	 * longer than any gap observed between chunks in a healthy run and a third
	 * of the way to the six-minute hang this exists to end.
	 */
	idleMs?: number;
	/** Injected for tests. Defaults to the global. */
	fetch?: typeof globalThis.fetch;
	/** Injected for tests. Defaults to the global. */
	setTimeout?: typeof globalThis.setTimeout;
	clearTimeout?: typeof globalThis.clearTimeout;
}

/**
 * Wrap a `fetch` so that silence becomes an error.
 *
 * Composes: `watchdog(capture.fetch)` keeps the X-ray's tee underneath and adds
 * the deadline above it, so a stall is recorded as a request that was sent and
 * then failed — which is exactly what it was.
 */
export function watchdog(
	inner?: typeof globalThis.fetch,
	{
		headersMs = 150_000,
		idleMs = 120_000,
		setTimeout: setTimer = globalThis.setTimeout,
		clearTimeout: clearTimer = globalThis.clearTimeout
	}: WatchdogOptions = {}
): typeof globalThis.fetch {
	const send = inner ?? globalThis.fetch;

	return async (input, init) => {
		const url =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: (input as Request).url;

		const controller = new AbortController();

		/*
		 * The caller's own signal still has to work.
		 *
		 * Replacing `init.signal` with ours would silently disable the stop
		 * button — the request would keep running with nobody able to reach it.
		 * So the caller's abort is forwarded into ours, and `reason` is passed
		 * along so a user-initiated stop still looks like one downstream.
		 */
		const caller = init?.signal;
		const forward = () => controller.abort(caller?.reason);
		if (caller) {
			if (caller.aborted) forward();
			else caller.addEventListener('abort', forward, { once: true });
		}

		/** Set when *we* aborted, so a trip is not reported as a user stop. */
		let tripped = '';

		let timer = setTimer(() => {
			tripped = `no response headers within ${headersMs}ms`;
			controller.abort(new Error(tripped));
		}, headersMs);

		let response: Response;
		try {
			response = await send(input, { ...init, signal: controller.signal });
		} catch (cause) {
			clearTimer(timer);
			caller?.removeEventListener('abort', forward);
			if (tripped) throw new StalledUpstream(tripped, url, { cause });
			throw cause;
		}
		clearTimer(timer);

		// Nothing to watch — a bodyless response has already finished arriving.
		if (!response.body) {
			caller?.removeEventListener('abort', forward);
			return response;
		}

		/*
		 * The body deadline, rearmed on every chunk.
		 *
		 * A `TransformStream` rather than a wrapper that reads ahead: reading
		 * ahead would buffer the response, which is the one thing `capture` is
		 * careful not to do and for the same reason — the SDK consumes this as it
		 * arrives, and a second reader either doubles the memory or deadlocks.
		 * A pass-through sees every chunk and holds none of them.
		 */
		let out: TransformStreamDefaultController<Uint8Array> | undefined;
		const arm = () => {
			clearTimer(timer);
			timer = setTimer(() => {
				tripped = `stream went quiet for ${idleMs}ms`;
				/*
				 * Both, and the order matters.
				 *
				 * `abort` stops the upstream socket, which is what stops the money.
				 * `error` is what the *reader* sees, and it has to be raised here
				 * rather than left to the abort: aborting a request errors its body
				 * with a bare `AbortError`, indistinguishable from a user pressing
				 * stop. Raising it on the transform means whoever is reading the
				 * stream gets a `StalledUpstream` that names the deadline.
				 */
				controller.abort(new Error(tripped));
				out?.error(new StalledUpstream(tripped, url));
			}, idleMs);
		};
		const disarm = () => {
			clearTimer(timer);
			caller?.removeEventListener('abort', forward);
		};
		arm();

		const watched = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				start(controller) {
					out = controller;
				},
				transform(chunk, controller) {
					arm();
					controller.enqueue(chunk);
				},
				/*
				 * `flush` only. `cancel` is in the streams spec but not in this
				 * TypeScript lib's `Transformer`, and it buys little: a reader that
				 * walks away leaves one armed timer, which fires once, aborts the
				 * upstream request nobody is reading any more, and clears itself.
				 * That is the behaviour you would write by hand.
				 */
				flush: disarm
			})
		);

		/*
		 * A new `Response` around the watched stream.
		 *
		 * `status`, `statusText` and `headers` carry over, which is everything the
		 * SDK reads. `url` does not survive construction — it is read-only and
		 * empty on a constructed `Response` — and that is a real, small loss: a
		 * caller that inspects `response.url` to follow a redirect sees "". No
		 * model client does; `figure-fetch` does, which is why the watchdog is
		 * applied at `model.ts` and not globally.
		 */
		return new Response(watched, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});
	};
}
