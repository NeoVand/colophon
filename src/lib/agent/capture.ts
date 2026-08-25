/**
 * The wire, tee'd.
 *
 * Everything the X-ray shows so far is read from what Mastra publishes. This
 * reads one level below that: the literal bytes sent to the provider. It is the
 * only way to answer "what was in the prompt", because by the time a request
 * leaves, the system prompt has been assembled from instructions plus memory
 * plus a working-memory block, every tool has become a JSON schema, and the
 * whole conversation has been re-serialised. None of that is visible in a chunk
 * stream, and all of it is what you are paying for.
 *
 * It works because `model.ts` builds every model through `createOpenAI({ fetch })`.
 * That `fetch` is ours. Mastra never learns it is being watched, and the agent is
 * not modified to permit it — which is the rule the whole X-ray keeps.
 *
 * ── Two things this deliberately does not do ────────────────────────────────
 * It does not buffer the response body. A streamed response is consumed by the
 * SDK as it arrives, and teeing it would either double the memory or, worse,
 * deadlock if one branch is read slower than the other. Usage numbers come from
 * the chunk stream, which already carries them.
 *
 * It does not retain the request forever. A research turn can send several
 * hundred kilobytes per call across a dozen calls, and this runs inside a
 * serverless function with a memory limit. Only the last `keep` requests are
 * held, newest last.
 *
 * `keep` used to be four, which was right when the only reader was a panel
 * showing the latest call. The panel pages across calls now, and a pager that
 * cannot reach call 3 of a twelve-call turn is a pager in name only — so the
 * default is twelve, and the cost of that was checked rather than assumed: a
 * captured body is a few hundred kilobytes at the top end, so twelve is single-
 * digit megabytes against a 2 GB function.
 */

export interface CapturedRequest {
	/** Which call in the run this was, from 1. */
	seq: number;
	url: string;
	/** Milliseconds since the capture was created. */
	at: number;
	/** The parsed JSON body, or undefined if it was not JSON. */
	body?: unknown;
	/** Bytes on the wire, before any parsing. */
	bytes: number;
	status?: number;
	/** How long the provider took to return headers. */
	ms?: number;
}

export interface Capture {
	/** Hand this to `model()`. */
	fetch: typeof globalThis.fetch;
	requests: CapturedRequest[];
	/** The most recent request, which is the one a context panel wants. */
	latest(): CapturedRequest | undefined;
}

/**
 * Captures held past the request that made them, so a later fetch can read the
 * same body again.
 *
 * ── Why this store exists ───────────────────────────────────────────────────
 * The context panel used to show a decomposition and nothing behind it: labels
 * and percentages, with no way to see the piece a row named. Carrying every
 * piece's text on the event stream was not an option — the pieces together
 * *are* the request, so that is the request sent twice, on every call.
 *
 * So the panel asks `/api/context` for the one call it is showing, and this is
 * what that endpoint reads. Same bodies, same `decompose`, no second source of
 * truth — the only difference is that the second reading asks for the text.
 *
 * In memory and bounded, with the same reasoning and the same caveat as
 * `tracing.ts`: a context does not survive a cold start, and on Vercel it does
 * not survive being routed to another instance. If `/api/context` 404s for a
 * call that certainly happened, that is why, and it is not a bug to hunt.
 */
const held = new Map<string, Capture>();

/** Conversations kept at once, newest last. Insertion order makes eviction free. */
const MAX_HELD = 4;

/** The capture filed under a key, if it is still held. */
export function captureFor(key: string): Capture | undefined {
	return held.get(key);
}

/** Only for tests, and for a dev server that would otherwise carry runs across an edit. */
export function forgetCaptures(): void {
	held.clear();
}

export function createCapture({
	keep = 12,
	key
}: {
	keep?: number;
	/**
	 * File this capture where `captureFor` can find it — the thread, in practice.
	 *
	 * Optional because the lab routes want a capture that vanishes with the
	 * request. Filing under the thread rather than the run id is deliberate: the
	 * run id is minted inside `agent.stream()`, well after the capture has to
	 * exist, and the panel is only ever asking about the conversation it is
	 * looking at.
	 */
	key?: string;
} = {}): Capture {
	const requests: CapturedRequest[] = [];
	const startedAt = Date.now();
	let seq = 0;

	const tee: typeof globalThis.fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

		// The body is read from `init` rather than from a cloned Request, because
		// the SDK passes a plain string here and cloning would be pure overhead.
		// If that ever stops being true this records a zero-byte request rather
		// than throwing, which is a visibly wrong readout instead of a broken run
		// — the agent must not fail because the observer could not observe.
		const raw = typeof init?.body === 'string' ? init.body : undefined;
		const record: CapturedRequest = {
			seq: ++seq,
			url,
			at: Date.now() - startedAt,
			bytes: raw ? new TextEncoder().encode(raw).byteLength : 0
		};
		if (raw) {
			try {
				record.body = JSON.parse(raw);
			} catch {
				// Not JSON. The size is still true and still worth showing.
			}
		}

		requests.push(record);
		if (requests.length > keep) requests.splice(0, requests.length - keep);

		const began = Date.now();
		const response = await globalThis.fetch(input, init);
		record.status = response.status;
		record.ms = Date.now() - began;
		return response;
	};

	const capture: Capture = {
		fetch: tee,
		requests,
		latest: () => requests[requests.length - 1]
	};

	if (key) {
		// Re-filed rather than merged: a new turn on the same thread gets a fresh
		// capture, and holding both would let the panel page back into a previous
		// turn's calls under this turn's numbering.
		held.delete(key);
		held.set(key, capture);
		while (held.size > MAX_HELD) {
			const oldest = held.keys().next().value;
			if (oldest === undefined) break;
			held.delete(oldest);
		}
	}

	return capture;
}
