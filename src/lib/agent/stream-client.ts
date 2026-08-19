import type { ColophonEvent } from './events';

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

export interface RunHandlers {
	onEvent: (event: ColophonEvent) => void;
	/** Fired when the server acknowledges before doing any model work. */
	onReady?: (ms: number) => void;
	onError?: (message: string) => void;
}

export interface RunOptions extends RunHandlers {
	prompt: string;
	signal?: AbortSignal;
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

export async function run({
	prompt,
	signal,
	onEvent,
	onReady,
	onError
}: RunOptions): Promise<void> {
	const startedAt = performance.now();

	const response = await fetch('/api/agent/stream', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ prompt }),
		signal
	});

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
						onReady?.(performance.now() - startedAt);
						break;
					case 'event':
						onEvent(JSON.parse(frame.data) as ColophonEvent);
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
