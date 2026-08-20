import { describe, it, expect } from 'vitest';
import { decompose, apportion, bands } from './context';

/**
 * The fixture below is a real request body, captured from `/lab/capture?tool`
 * against `api.openai.com/v1/responses` — not written from the documentation.
 * Every item kind in it was observed, including `item_reference`, which is the
 * one nobody would have guessed: the provider's reasoning is referenced by id
 * rather than re-sent.
 */
const REQUEST = {
	model: 'gpt-5',
	input: [
		{ role: 'developer', content: 'You are a probe. Answer in one word.' },
		{
			role: 'user',
			content: [{ type: 'input_text', text: 'Call the ping tool with note "hi", then say done.' }]
		},
		{ type: 'item_reference', id: 'rs_0f947812fa7d7c09006a866338' },
		{
			type: 'function_call',
			call_id: 'call_7YQDYHV4kry91NbBtPzQIKIx',
			name: 'ping',
			arguments: '{"note":"hi"}'
		},
		{
			type: 'function_call_output',
			call_id: 'call_7YQDYHV4kry91NbBtPzQIKIx',
			output: '{"pong":true}'
		}
	],
	tools: [
		{
			type: 'function',
			name: 'ping',
			description: 'A tool that exists only so a tool schema appears on the wire.',
			parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }
		}
	],
	tool_choice: 'auto'
};

describe('decompose', () => {
	it('names every band in a real request', () => {
		const { parts, model } = decompose(REQUEST);
		expect(model).toBe('gpt-5');
		expect(parts.map((p) => p.kind)).toEqual([
			'tool-schema',
			'system',
			'user',
			'reasoning-ref',
			'tool-call',
			'tool-result'
		]);
	});

	it('puts tool schemas first, because they are the cost nobody remembers', () => {
		expect(decompose(REQUEST).parts[0].kind).toBe('tool-schema');
	});

	it('reads a developer role as the system prompt', () => {
		const system = decompose(REQUEST).parts.find((p) => p.kind === 'system');
		expect(system?.chars).toBe('You are a probe. Answer in one word.'.length);
	});

	it('treats a plain `system` role the same way', () => {
		const { parts } = decompose({ input: [{ role: 'system', content: 'abc' }] });
		expect(parts[0]).toMatchObject({ kind: 'system', chars: 3 });
	});

	it('measures the text of a structured user message, not its JSON', () => {
		const user = decompose(REQUEST).parts.find((p) => p.kind === 'user');
		expect(user?.chars).toBe('Call the ping tool with note "hi", then say done.'.length);
	});

	/**
	 * The finding this file exists to pin down. If a future SDK starts inlining
	 * reasoning instead of referencing it, this test fails loudly — and the
	 * economics of every turn will have changed, so it should.
	 */
	it('shows reasoning as a reference of a few dozen characters, not a blob', () => {
		const ref = decompose(REQUEST).parts.find((p) => p.kind === 'reasoning-ref');
		expect(ref).toBeDefined();
		expect(ref!.chars).toBeLessThan(60);
	});

	it('shares sum to one', () => {
		const { parts } = decompose(REQUEST);
		expect(parts.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1, 10);
	});

	it('reports an unrecognised item rather than dropping it, so the bands still add up', () => {
		const { parts, chars } = decompose({
			input: [
				{ role: 'developer', content: 'abc' },
				{ type: 'something_new', payload: 'xxxxx' }
			]
		});
		expect(parts.map((p) => p.kind)).toEqual(['system', 'other']);
		expect(parts[1].label).toBe('something_new');
		expect(chars).toBe(3 + parts[1].chars);
	});

	it('survives a body that is empty, null or the wrong shape', () => {
		for (const body of [null, undefined, {}, { input: 'not an array' }, 42]) {
			expect(() => decompose(body)).not.toThrow();
		}
		expect(decompose({}).parts).toEqual([]);
		expect(decompose({}).chars).toBe(0);
	});
});

describe('apportion', () => {
	it('splits the billed tokens in proportion to size', () => {
		const parts = [
			{ id: 'p0', kind: 'system' as const, label: 's', chars: 750, share: 0.75 },
			{ id: 'p1', kind: 'user' as const, label: 'u', chars: 250, share: 0.25 }
		];
		const out = apportion(parts, 1000);
		expect(out.map((p) => p.tokens)).toEqual([750, 250]);
	});

	it('leaves tokens unset when nothing has been billed yet', () => {
		const parts = [{ id: 'p0', kind: 'system' as const, label: 's', chars: 10, share: 1 }];
		expect(apportion(parts, 0)[0].tokens).toBeUndefined();
	});

	it('does not mutate what it was given', () => {
		const parts = [{ id: 'p0', kind: 'system' as const, label: 's', chars: 10, share: 1 }];
		apportion(parts, 100);
		expect(parts[0]).not.toHaveProperty('tokens');
	});
});

describe('bands', () => {
	it('merges rows by kind and keeps a fixed left-to-right order', () => {
		const merged = bands(decompose(REQUEST).parts);
		expect(merged.map((b) => b.kind)).toEqual([
			'system',
			'tool-schema',
			'user',
			'tool-call',
			'tool-result',
			'reasoning-ref'
		]);
	});

	it('sums several rows of one kind into a single band', () => {
		const { parts } = decompose({
			tools: [
				{ name: 'a', description: 'x'.repeat(50) },
				{ name: 'b', description: 'y'.repeat(50) }
			]
		});
		const merged = bands(parts);
		expect(merged).toHaveLength(1);
		expect(merged[0].chars).toBe(parts[0].chars + parts[1].chars);
		expect(merged[0].share).toBe(1);
	});

	it('omits kinds that are absent rather than showing empty bands', () => {
		expect(bands([]).length).toBe(0);
	});
});

describe('ids and correlation', () => {
	/**
	 * The bug that made this field exist. Keying a list on `label` looked fine
	 * until a turn made two tool calls: both outputs were labelled "tool result",
	 * Svelte threw `each_key_duplicate`, and the throw *aborted the render* —
	 * leaving the panel showing its own "nothing sent yet" empty state during a
	 * live run, with the header beside it reading "call 4 · 112.8kB".
	 */
	it('gives every part a unique id even when labels collide', () => {
		const { parts } = decompose({
			input: [
				{ type: 'function_call', call_id: 'a', name: 'search', arguments: '{}' },
				{ type: 'function_call', call_id: 'b', name: 'search', arguments: '{}' },
				{ type: 'function_call_output', call_id: 'a', output: 'x' },
				{ type: 'function_call_output', call_id: 'b', output: 'y' }
			]
		});
		const ids = parts.map((p) => p.id);
		expect(new Set(ids).size).toBe(parts.length);
	});

	it('names a result after the tool that produced it', () => {
		const { parts } = decompose({
			input: [
				{ type: 'function_call', call_id: 'c1', name: 'fetch_paper', arguments: '{}' },
				{ type: 'function_call_output', call_id: 'c1', output: 'x'.repeat(40_000) }
			]
		});
		const result = parts.find((p) => p.kind === 'tool-result');
		expect(result?.label).toBe('fetch_paper — result');
	});

	it('falls back gracefully when a result has no matching call', () => {
		const { parts } = decompose({
			input: [{ type: 'function_call_output', call_id: 'orphan', output: 'x' }]
		});
		expect(parts[0].label).toBe('tool — result');
	});
});

describe('more than one system message', () => {
	/**
	 * A fresh thread's first call carried two developer messages — the agent's
	 * instructions and the resource-scoped working memory — and the panel showed
	 * two identical "system prompt" rows at 26% and 19%, which is exactly as
	 * useful as one row at 45%.
	 */
	it('names the working-memory block rather than calling it a second system prompt', () => {
		const { parts } = decompose({
			input: [
				{ role: 'developer', content: 'You are Colophon.' },
				{ role: 'developer', content: '# Reader profile\n\n## Fields followed\n- SAEs' }
			]
		});
		expect(parts.map((p) => p.label)).toEqual(['system prompt', 'working memory']);
	});

	it('falls back to numbering when a second block is not recognisable', () => {
		const { parts } = decompose({
			input: [
				{ role: 'developer', content: 'You are Colophon.' },
				{ role: 'developer', content: 'Something else entirely.' }
			]
		});
		expect(parts.map((p) => p.label)).toEqual(['system prompt', 'system prompt 2']);
	});
});
