/**
 * What the browser is told about a run.
 *
 * Mastra publishes ~87 typed chunk kinds on `fullStream`, which is a gift for the
 * X-ray and far too much for a chat window. Worse, the terminal chunks are not
 * merely detailed but *redundant*: `step-finish` and `finish` each carry the whole
 * message history, the outgoing request body and the encrypted reasoning blob,
 * repeated across `steps[]`, `messages.all` and `messages.nonUser`. Measured on a
 * two-word answer: ~30 KB of terminal chunk against ~200 bytes of actual text.
 *
 * So the stream is projected. Two levels, one endpoint:
 *
 *   'chat'  — what a conversation needs. Small enough to stream over a phone.
 *   'full'  — the raw chunk, untouched, for Lab mode and the X-ray panels.
 *
 * This file is the seam between them, and deliberately has no Mastra imports and
 * no I/O: it is a pure function over a chunk, so it can be unit-tested against
 * recorded fixtures without a network or a key.
 */

/** Token accounting, normalised. Mastra nests the same numbers three ways. */
export interface Usage {
	input: number;
	output: number;
	total: number;
	reasoning: number;
	cached: number;
}

export type ColophonEvent =
	/** A run began. */
	| { k: 'start'; runId: string }
	/** Assistant text, incremental. */
	| { k: 'text'; text: string }
	/**
	 * The model is thinking. Carries no content on purpose: the provider's
	 * reasoning is an encrypted blob of several kilobytes that the browser can do
	 * nothing with. The UI wants to know *that* it is reasoning, not what.
	 */
	| { k: 'reasoning'; state: 'start' | 'end' }
	/** The model asked for a tool. */
	| { k: 'tool-call'; id: string; name: string; args: unknown }
	/** A tool returned. */
	| { k: 'tool-result'; id: string; name?: string; result: unknown; failed?: boolean }
	/** One step of the agent loop closed. */
	| { k: 'step'; usage: Usage }
	/** A guardrail aborted the run. */
	| { k: 'tripwire'; reason: string; processor?: string }
	/** The run finished. */
	| { k: 'done'; usage: Usage; text?: string }
	/** The run failed. */
	| { k: 'error'; message: string };

const EMPTY_USAGE: Usage = { input: 0, output: 0, total: 0, reasoning: 0, cached: 0 };

/** Mastra's usage object, flattened to five numbers. */
export function readUsage(raw: unknown): Usage {
	const u = raw as Record<string, number> | undefined;
	if (!u) return EMPTY_USAGE;
	return {
		input: u.inputTokens ?? 0,
		output: u.outputTokens ?? 0,
		total: u.totalTokens ?? 0,
		reasoning: u.reasoningTokens ?? 0,
		cached: u.cachedInputTokens ?? 0
	};
}

interface Chunk {
	type?: string;
	runId?: string;
	payload?: Record<string, unknown>;
}

/**
 * One Mastra chunk → zero or one Colophon events.
 *
 * Returning `null` is the common case and the point: most of the 87 kinds are
 * bookkeeping the chat window has no use for. Anything unrecognised is dropped
 * rather than forwarded, so a Mastra upgrade that adds chunk kinds cannot
 * silently start shipping megabytes to the browser.
 */
export function project(chunk: unknown): ColophonEvent | null {
	const c = chunk as Chunk;
	const p = c?.payload ?? {};

	switch (c?.type) {
		case 'start':
			return { k: 'start', runId: c.runId ?? '' };

		case 'text-delta': {
			const text = p.text;
			return typeof text === 'string' && text.length ? { k: 'text', text } : null;
		}

		case 'reasoning-start':
			return { k: 'reasoning', state: 'start' };
		case 'reasoning-end':
			return { k: 'reasoning', state: 'end' };

		case 'tool-call':
			return {
				k: 'tool-call',
				id: String(p.toolCallId ?? ''),
				name: String(p.toolName ?? ''),
				args: p.args ?? p.input ?? null
			};

		case 'tool-result':
			return {
				k: 'tool-result',
				id: String(p.toolCallId ?? ''),
				name: p.toolName ? String(p.toolName) : undefined,
				result: p.result ?? p.output ?? null
			};

		case 'tool-error':
			return {
				k: 'tool-result',
				id: String(p.toolCallId ?? ''),
				name: p.toolName ? String(p.toolName) : undefined,
				result: p.error ?? 'tool failed',
				failed: true
			};

		case 'tripwire':
			return {
				k: 'tripwire',
				reason: String(p.reason ?? 'blocked'),
				processor: p.processorId ? String(p.processorId) : undefined
			};

		// Take only the usage. Everything else in here is a duplicate of state the
		// client already has, or a blob it cannot use.
		case 'step-finish': {
			const output = p.output as Record<string, unknown> | undefined;
			return { k: 'step', usage: readUsage(output?.usage) };
		}

		case 'finish': {
			const output = p.output as Record<string, unknown> | undefined;
			return {
				k: 'done',
				usage: readUsage(output?.usage),
				text: typeof output?.text === 'string' ? (output.text as string) : undefined
			};
		}

		case 'error':
			return { k: 'error', message: String(p.message ?? p.error ?? 'unknown error') };

		default:
			return null;
	}
}

/** Running totals across a whole run. Steps accumulate; the final `done` wins. */
export function addUsage(a: Usage, b: Usage): Usage {
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		total: a.total + b.total,
		reasoning: a.reasoning + b.reasoning,
		cached: a.cached + b.cached
	};
}
