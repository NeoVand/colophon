import { describe, it, expect, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { createResearchTools } = await import('./tools');

/**
 * The point of these tests: the citation guarantee must be *structural*, not a
 * matter of the model choosing to behave.
 *
 * A live run showed the model declining to cite a fabricated paper without even
 * calling `cite` — which is the desired outcome and proves nothing, because the
 * instructions did the work. These exercise the layer beneath: what happens when
 * the tool actually is called.
 */

/** Reach past Mastra's wrapper to the tool's own execute. */
type Executable = { execute: (input: unknown, ctx?: unknown) => Promise<unknown> };
const run = (tool: unknown, input: unknown) => (tool as Executable).execute(input, {});

describe('cite is a wall, not a warning', () => {
	it('refuses a paper that never entered the run', async () => {
		const { tools } = createResearchTools();
		await expect(run(tools.cite, { id: '2401.99999', requireRead: true })).rejects.toThrow(
			/never entered this run|nothing has been retrieved/
		);
	});

	it('refuses even when the id is well-formed and the title plausible', async () => {
		// The realistic failure: a model producing a reference that looks exactly
		// like a real one. Plausibility is not evidence.
		const { tools } = createResearchTools();
		await expect(run(tools.cite, { id: '2312.00752', requireRead: false })).rejects.toThrow();
	});

	it('refuses a paper seen in a search but never opened', async () => {
		const { registry, tools } = createResearchTools();
		registry.register({
			id: '1706.03762',
			title: 'Attention Is All You Need',
			authors: ['Ashish Vaswani'],
			year: 2017,
			url: 'https://arxiv.org/abs/1706.03762',
			arxivId: '1706.03762',
			depth: 'listed',
			via: 'search_papers'
		});

		await expect(run(tools.cite, { id: '1706.03762', requireRead: true })).rejects.toThrow(
			/never opened/
		);

		// The same paper is citable for what its abstract says.
		await expect(run(tools.cite, { id: '1706.03762', requireRead: false })).resolves.toMatchObject({
			citation: 'Vaswani (2017), "Attention Is All You Need"'
		});
	});
});

describe('registry isolation', () => {
	it('gives each run its own registry, so runs cannot cite each other', async () => {
		// Two conversations must not share sources. This is why the tools are a
		// factory rather than module-level constants.
		const first = createResearchTools();
		first.registry.register({
			id: '1706.03762',
			title: 'Attention Is All You Need',
			authors: ['Ashish Vaswani'],
			url: 'u',
			arxivId: '1706.03762',
			depth: 'read',
			via: 'fetch_paper'
		});

		const second = createResearchTools();
		expect(second.registry.size).toBe(0);
		await expect(
			run(second.tools.cite, { id: '1706.03762', requireRead: false })
		).rejects.toThrow();
	});
});

describe('bibliography reports only what was consulted', () => {
	it('lists read papers by default and everything when asked', async () => {
		const { registry, tools } = createResearchTools();
		registry.register({
			id: 'a',
			title: 'Opened',
			authors: ['Ada Lovelace'],
			year: 2020,
			url: 'ua',
			depth: 'read',
			via: 'fetch_paper'
		});
		registry.register({
			id: 'b',
			title: 'Merely listed',
			authors: ['Grace Hopper'],
			year: 2021,
			url: 'ub',
			depth: 'listed',
			via: 'search_papers'
		});

		await expect(run(tools.bibliography, { readOnly: true })).resolves.toMatchObject({ count: 1 });
		await expect(run(tools.bibliography, { readOnly: false })).resolves.toMatchObject({ count: 2 });
	});

	it('carries how each source entered the run, as an audit trail', async () => {
		const { registry, tools } = createResearchTools();
		registry.register({
			id: 'a',
			title: 'Opened',
			authors: ['Ada Lovelace'],
			url: 'ua',
			depth: 'read',
			via: 'fetch_paper'
		});
		const result = (await run(tools.bibliography, { readOnly: true })) as {
			entries: { via: string }[];
		};
		expect(result.entries[0].via).toBe('fetch_paper');
	});
});
