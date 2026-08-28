import type { ColophonEvent, XrayEvent } from './events';
import type { WorkflowEvent } from './workflow-events';

/**
 * Reading the run from the browser.
 *
 * `EventSource` would be the obvious tool and cannot be used: it only issues GET
 * requests, and a prompt belongs in a body rather than a query string — both
 * because prompts get long and because a URL ends up in proxy logs, browser
 * history and referrer headers. So this parses the SSE framing off a `fetch`
 * body itself, which costs about thirty lines and buys POST.
 *
 * A second reason to hand-roll it: `EventSource` reconnects automatically on any
 * transport hiccup, which for a *billed, non-idempotent* agent run means silently
 * paying for the same work twice. This reader stops when the stream stops.
 */

/**
 * Generic over the event type because there are two streams on this wire, not
 * one: the agent loop publishes `ColophonEvent`, the research pipeline publishes
 * `WorkflowEvent`, and the framing — `ready` / `event` / `done` / `failed`,
 * heartbeat comments, the same anti-buffering headers — is identical. Sharing
 * the reader is what keeps them identical; two hand-rolled parsers would drift
 * the first time one of them learned about a new frame.
 */
export interface RunHandlers<E = ColophonEvent> {
	onEvent: (event: E) => void;
	/**
	 * Fired when the server acknowledges before doing any model work.
	 *
	 * `data` is the `ready` frame's payload. The research route puts its `runId`
	 * there — a workflow run is created before it is started, so the handle
	 * exists before a token is spent, which the agent route cannot manage
	 * because Mastra mints that id inside `agent.stream()`.
	 */
	onReady?: (ms: number, data: unknown) => void;
	onError?: (message: string) => void;
}

export interface RunOptions extends RunHandlers {
	prompt: string;
	/** Conversation to continue. Omit for a one-shot with no memory. */
	thread?: string;
	signal?: AbortSignal;
}

/**
 * The `ready` payload, or nothing.
 *
 * Unlike an `event` frame, this one is not load-bearing — it exists to time
 * first-byte — so a malformed body must not take the run down before it starts.
 */
function safeParse(data: string): unknown {
	try {
		return JSON.parse(data);
	} catch {
		return undefined;
	}
}

/** One SSE frame: an optional event name and its data payload. */
function parseFrame(frame: string): { name: string; data: string } | null {
	let name = 'message';
	const data: string[] = [];
	for (const line of frame.split('\n')) {
		// A line starting with ':' is a comment — that is what the heartbeat is.
		if (!line || line.startsWith(':')) continue;
		if (line.startsWith('event:')) name = line.slice(6).trim();
		else if (line.startsWith('data:')) data.push(line.slice(5).trim());
	}
	return data.length ? { name, data: data.join('\n') } : null;
}

/**
 * Resume a run that paused for approval.
 *
 * Deliberately the same reader as `run`: the continuation is a stream of the
 * same events, so the caller's handling does not change — only where the
 * bytes came from.
 */
export async function respond({
	runId,
	toolCallId,
	approve,
	reason,
	edited,
	onEvent,
	onError
}: {
	runId: string;
	toolCallId: string;
	approve: boolean;
	reason?: string;
	/** The reader's rewrite, for a tool whose arguments they were allowed to edit. */
	edited?: unknown;
} & RunHandlers): Promise<void> {
	await consume(
		fetch('/api/agent/approve', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ runId, toolCallId, approve, reason, edited })
		}),
		{ onEvent, onError }
	);
}

export async function run({
	prompt,
	thread,
	signal,
	onEvent,
	onReady,
	onError
}: RunOptions): Promise<void> {
	const startedAt = performance.now();

	const response = await fetch('/api/agent/stream', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ prompt, thread }),
		signal
	});

	await consume(Promise.resolve(response), { onEvent, onReady, onError, startedAt });
}

/**
 * Run the deep-research pipeline, and watch it.
 *
 * A different endpoint and a different event vocabulary, but deliberately the
 * same reader: `/api/research` speaks the same SSE framing as `/api/agent/stream`
 * for the same reason — a research run is minutes long and makes a dozen
 * provider calls, so it is the request in this application most likely to be
 * sitting inside a corporate proxy's buffer.
 *
 * The `thread` it takes is **not** a conversation to continue. The workflow has
 * no memory: it scopes, searches, selects, reads and writes from the question
 * alone, every time. It travels only as the key the server files this run's
 * captured requests under, so the context panel can read a piece back.
 */
export async function research({
	question,
	thread,
	signal,
	onEvent,
	onReady,
	onError
}: {
	question: string;
	/**
	 * Not a conversation to continue — the pipeline has no memory. It is only
	 * the key the server files this run's captured requests under, so the
	 * context panel can read them back.
	 */
	thread?: string;
	signal?: AbortSignal;
	/*
	 * Two vocabularies on one channel: the pipeline's own stages, and the trace
	 * frames every endpoint sends. Declaring both is not a formality — typing
	 * this as `WorkflowEvent` alone is what let a `trace` frame reach the
	 * workflow reducer and take a real run down. See `XrayEvent`.
	 */
} & RunHandlers<WorkflowEvent | XrayEvent>): Promise<void> {
	const startedAt = performance.now();

	const response = await fetch('/api/research', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ question, thread }),
		signal
	});

	await consume<WorkflowEvent | XrayEvent>(Promise.resolve(response), {
		onEvent,
		onReady,
		onError,
		startedAt
	});
}

/** Read an SSE body to completion, dispatching each frame. */
async function consume<E = ColophonEvent>(
	pending: Promise<Response>,
	{
		onEvent,
		onReady,
		onError,
		startedAt = performance.now()
	}: RunHandlers<E> & { startedAt?: number }
): Promise<void> {
	const response = await pending;

	if (!response.ok || !response.body) {
		onError?.(`The server refused the run (HTTP ${response.status}).`);
		return;
	}

	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += value;

			// Frames are separated by a blank line. Anything after the last blank
			// line is a partial frame and stays in the buffer for the next read.
			const frames = buffer.split('\n\n');
			buffer = frames.pop() ?? '';

			for (const raw of frames) {
				const frame = parseFrame(raw);
				if (!frame) continue;

				switch (frame.name) {
					case 'ready':
						onReady?.(performance.now() - startedAt, safeParse(frame.data));
						break;
					case 'event':
						onEvent(JSON.parse(frame.data) as E);
						break;
					case 'failed':
						onError?.((JSON.parse(frame.data) as { message: string }).message);
						break;
					// 'done' needs no handling: the stream closing is the signal.
				}
			}
		}
	} catch (cause) {
		// An abort is the user pressing stop, not a failure worth reporting.
		if ((cause as Error)?.name !== 'AbortError') {
			onError?.(cause instanceof Error ? cause.message : String(cause));
		}
	} finally {
		reader.releaseLock();
	}
}
