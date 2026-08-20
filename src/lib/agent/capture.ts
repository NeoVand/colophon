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

export function createCapture({ keep = 4 }: { keep?: number } = {}): Capture {
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

	return {
		fetch: tee,
		requests,
		latest: () => requests[requests.length - 1]
	};
}
