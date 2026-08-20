import { describe, it, expect } from 'vitest';
import { project, readUsage, addUsage, subagentOf, type ColophonEvent } from './events';

/**
 * Fixtures are real chunks, copied verbatim from a gpt-5 run against the
 * deployed endpoint on 2026-08-19 — not invented shapes. The redundancy in
 * `step-finish` is why the projector exists, so the test keeps a sample of it.
 */

const START = {
	type: 'start',
	runId: 'dd2e31e4-d497-475e-9760-353e745ae0ec',
	from: 'AGENT',
	payload: { id: 'colophon-probe', messageId: 'cd699aaa-d68c-41cc-b584-61ce12aae4c7' }
};

const TEXT_DELTA = {
	type: 'text-delta',
	runId: 'dd2e31e4',
	from: 'AGENT',
	payload: { id: 'msg_086cb90aa97284da', text: ' wire' }
};

const REASONING_START = {
	type: 'reasoning-start',
	runId: 'dd2e31e4',
	from: 'AGENT',
	payload: {
		id: 'rs_086cb90aa97284da:0',
		providerMetadata: {
			openai: {
				itemId: 'rs_086cb90aa97284da',
				// The real one is ~3 KB of base64. This is why reasoning carries no
				// content across the wire.
				reasoningEncryptedContent: 'gAAAAABqhjn0QMc2Jcao3w0kskNnPa92Rp93xbmoFJYuBnpE8EUK'
			}
		}
	}
};

const USAGE = {
	inputTokens: 33,
	outputTokens: 163,
	totalTokens: 196,
	reasoningTokens: 128,
	cachedInputTokens: 0,
	raw: { inputTokens: { total: 33 }, outputTokens: { total: 163 } }
};

const STEP_FINISH = {
	type: 'step-finish',
	runId: 'dd2e31e4',
	from: 'AGENT',
	payload: {
		messageId: 'cd699aaa',
		stepResult: { reason: 'stop', isContinued: false },
		metadata: { request: { body: { model: 'gpt-5', input: [] } } },
		output: { text: 'the wire is open.', toolCalls: [], usage: USAGE, steps: [] },
		messages: { all: [], user: [], nonUser: [] }
	}
};

describe('project', () => {
	it('names the start of a run', () => {
		expect(project(START)).toEqual({ k: 'start', runId: 'dd2e31e4-d497-475e-9760-353e745ae0ec' });
	});

	it('passes text through', () => {
		expect(project(TEXT_DELTA)).toEqual({ k: 'text', text: ' wire' });
	});

	it('drops empty text rather than emitting a no-op event', () => {
		expect(project({ type: 'text-delta', payload: { text: '' } })).toBeNull();
	});

	it('reports that reasoning happened, but never its content', () => {
		const event = project(REASONING_START);
		expect(event).toEqual({ k: 'reasoning', state: 'start' });
		// The guarantee that matters: no encrypted blob reaches the browser.
		expect(JSON.stringify(event)).not.toContain('gAAAAAB');
	});

	it('keeps only usage from step-finish, discarding the duplicated history', () => {
		const event = project(STEP_FINISH);
		expect(event).toEqual({
			k: 'step',
			usage: { input: 33, output: 163, total: 196, reasoning: 128, cached: 0 }
		});

		// The actual point of this module, stated as a number.
		const projected = JSON.stringify(event)!.length;
		const original = JSON.stringify(STEP_FINISH).length;
		expect(projected).toBeLessThan(original / 2);
	});

	it('reads a tool call', () => {
		expect(
			project({
				type: 'tool-call',
				payload: { toolCallId: 'call_1', toolName: 'search_papers', args: { q: 'attention' } }
			})
		).toEqual({ k: 'tool-call', id: 'call_1', name: 'search_papers', args: { q: 'attention' } });
	});

	it('marks a failed tool distinctly from a successful one', () => {
		const ok = project({ type: 'tool-result', payload: { toolCallId: 'c1', result: 'fine' } });
		const bad = project({ type: 'tool-error', payload: { toolCallId: 'c1', error: 'boom' } });
		// `failed` is absent rather than false on the success path, so assert on
		// falsiness — toMatchObject treats an absent key and `undefined` differently.
		expect(ok).toMatchObject({ k: 'tool-result', id: 'c1', result: 'fine' });
		expect((ok as { failed?: boolean }).failed).toBeFalsy();
		expect(bad).toMatchObject({ k: 'tool-result', failed: true, result: 'boom' });
	});

	it('surfaces a guardrail abort with the processor that fired it', () => {
		expect(project({ type: 'tripwire', payload: { reason: 'PII', processorId: 'pii' } })).toEqual({
			k: 'tripwire',
			reason: 'PII',
			processor: 'pii'
		});
	});

	it('drops unrecognised chunk kinds instead of forwarding them', () => {
		// A Mastra upgrade adding chunk kinds must not silently start shipping
		// payloads to the browser.
		expect(
			project({ type: 'some-future-chunk', payload: { huge: 'x'.repeat(10_000) } })
		).toBeNull();
		expect(project(null)).toBeNull();
		expect(project({})).toBeNull();
	});
});

describe('subagentOf', () => {
	it('recognises a delegation from the tool name Mastra gives it', () => {
		// There is no chunk kind for "a subagent ran"; the tool name is the only
		// signal that a whole second context window was spent.
		expect(subagentOf('agent-paperReader')).toBe('paper reader');
		expect(subagentOf('agent-critic')).toBe('critic');
	});

	it('leaves ordinary tools alone', () => {
		expect(subagentOf('search_papers')).toBeUndefined();
		expect(subagentOf('cite')).toBeUndefined();
	});
});

describe('project marks delegation', () => {
	it('tags a subagent call so the UI can draw a lane', () => {
		expect(
			project({
				type: 'tool-call',
				payload: { toolCallId: 'c1', toolName: 'agent-paperReader', args: { prompt: 'read' } }
			})
		).toMatchObject({ k: 'tool-call', subagent: 'paper reader' });
	});

	it('leaves an ordinary tool call untagged', () => {
		const event = project({
			type: 'tool-call',
			payload: { toolCallId: 'c1', toolName: 'cite', args: {} }
		});
		expect((event as { subagent?: string }).subagent).toBeUndefined();
	});
});

describe('readUsage', () => {
	it('flattens Mastra usage to five numbers', () => {
		expect(readUsage(USAGE)).toEqual({
			input: 33,
			output: 163,
			total: 196,
			reasoning: 128,
			cached: 0
		});
	});

	it('treats missing usage as zero rather than throwing', () => {
		expect(readUsage(undefined)).toEqual({
			input: 0,
			output: 0,
			total: 0,
			reasoning: 0,
			cached: 0
		});
	});
});

describe('addUsage', () => {
	it('accumulates across steps', () => {
		const a = readUsage(USAGE);
		expect(addUsage(a, a).total).toBe(392);
	});
});

describe('a whole run', () => {
	it('projects a realistic chunk sequence into something a chat can render', () => {
		const chunks = [
			START,
			{ type: 'step-start', payload: { request: { body: { model: 'gpt-5' } } } },
			REASONING_START,
			{ type: 'reasoning-end', payload: { id: 'rs_1' } },
			{ type: 'text-start', payload: { id: 'msg_1' } },
			{ type: 'text-delta', payload: { text: 'the' } },
			{ type: 'text-delta', payload: { text: ' wire' } },
			{ type: 'text-end', payload: { id: 'msg_1' } },
			STEP_FINISH,
			{ type: 'finish', payload: { output: { text: 'the wire', usage: USAGE } } }
		];

		const events = chunks.map(project).filter(Boolean) as ColophonEvent[];

		expect(events.map((e) => e.k)).toEqual([
			'start',
			'reasoning',
			'reasoning',
			'text',
			'text',
			'step',
			'done'
		]);

		const text = events
			.filter((e): e is Extract<ColophonEvent, { k: 'text' }> => e.k === 'text')
			.map((e) => e.text)
			.join('');
		expect(text).toBe('the wire');
	});
});
