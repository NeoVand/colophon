import { describe, it, expect, vi, beforeEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

/**
 * Repeats come back without their abstracts.
 *
 * Measured before it was written. The context panel on a real turn showed five
 * `search_papers — result` rows of ~14,000 tokens each — 48% of a 138,000-token
 * request — for four searches that between them returned 32 rows describing 25
 * distinct papers. The seven repeats were carrying full abstracts that were
 * already earlier in the very same context.
 *
 * These tests pin both halves: the repeat gets smaller, and it stays usable.
 */

const searchPapers = vi.fn();
vi.mock('./retrieval', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./retrieval')>();
	return { ...actual, searchPapers: (...args: unknown[]) => searchPapers(...args) };
});

const { createResearchTools } = await import('./tools');

type Executable = { execute: (input: unknown, ctx?: unknown) => Promise<unknown> };
const run = (tool: unknown, input: unknown) => (tool as Executable).execute(input, {});

interface Row {
	id: string;
	title: string;
	seen?: true;
	abstract?: string;
	authors?: string[];
}
interface Result {
	count: number;
	repeats: number;
	papers: Row[];
}

const PAPER = {
	id: '2608.13337',
	title: 'Where You Measure Decides What You Measure',
	authors: ['Amélie Noël', 'Jae Lee'],
	year: 2026,
	citedBy: 3,
	url: 'https://arxiv.org/abs/2608.13337',
	arxivId: '2608.13337',
	summary: 'A'.repeat(1500),
	depth: 'listed' as const
};

const OTHER = { ...PAPER, id: '2608.14922', arxivId: '2608.14922', title: 'SpIn-ViT' };

beforeEach(() => searchPapers.mockReset());

describe('first sight', () => {
	it('returns the full row, abstract included', async () => {
		searchPapers.mockResolvedValue([PAPER]);
		const { tools } = createResearchTools();
		const result = (await run(tools.search_papers, {
			query: 'x',
			limit: 8,
			sort: 'relevance'
		})) as Result;

		expect(result.repeats).toBe(0);
		expect(result.papers[0].abstract).toHaveLength(900);
		expect(result.papers[0].authors).toEqual(['Amélie Noël', 'Jae Lee']);
		expect(result.papers[0].seen).toBeUndefined();
	});
});

describe('second sight', () => {
	it('drops the abstract and marks the row seen', async () => {
		searchPapers.mockResolvedValue([PAPER]);
		const { tools } = createResearchTools();

		await run(tools.search_papers, { query: 'a', limit: 8, sort: 'relevance' });
		const second = (await run(tools.search_papers, {
			query: 'b',
			limit: 8,
			sort: 'relevance'
		})) as Result;

		expect(second.repeats).toBe(1);
		expect(second.papers[0].seen).toBe(true);
		expect(second.papers[0].abstract).toBeUndefined();
	});

	/** The ranking of *this* search still has to be readable. */
	it('keeps the title, so the new result list still means something', async () => {
		searchPapers.mockResolvedValue([PAPER]);
		const { tools } = createResearchTools();
		await run(tools.search_papers, { query: 'a', limit: 8, sort: 'relevance' });
		const second = (await run(tools.search_papers, {
			query: 'b',
			limit: 8,
			sort: 'relevance'
		})) as Result;

		expect(second.papers[0].title).toBe(PAPER.title);
		expect(second.papers[0].id).toBe(PAPER.id);
	});

	it('is a real saving, not a rounding error', async () => {
		searchPapers.mockResolvedValue([PAPER]);
		const { tools } = createResearchTools();
		const first = (await run(tools.search_papers, {
			query: 'a',
			limit: 8,
			sort: 'relevance'
		})) as Result;
		const second = (await run(tools.search_papers, {
			query: 'b',
			limit: 8,
			sort: 'relevance'
		})) as Result;

		const size = (r: Result) => JSON.stringify(r).length;
		expect(size(second)).toBeLessThan(size(first) * 0.2);
	});

	it('does not suppress a paper that is genuinely new to the run', async () => {
		searchPapers.mockResolvedValueOnce([PAPER]).mockResolvedValueOnce([PAPER, OTHER]);
		const { tools } = createResearchTools();

		await run(tools.search_papers, { query: 'a', limit: 8, sort: 'relevance' });
		const second = (await run(tools.search_papers, {
			query: 'b',
			limit: 8,
			sort: 'relevance'
		})) as Result;

		expect(second.repeats).toBe(1);
		expect(second.papers.find((p) => p.id === OTHER.id)?.abstract).toHaveLength(900);
	});
});

describe('the guarantee is unaffected', () => {
	/**
	 * The one way this optimisation could do damage: if a suppressed row also
	 * failed to register, a paper the model can see would become uncitable.
	 */
	it('a repeat is still registered, and still citable', async () => {
		searchPapers.mockResolvedValue([PAPER]);
		const { tools, registry } = createResearchTools();

		await run(tools.search_papers, { query: 'a', limit: 8, sort: 'relevance' });
		await run(tools.search_papers, { query: 'b', limit: 8, sort: 'relevance' });

		expect(registry.get(PAPER.id)).toBeDefined();
		await expect(run(tools.cite, { id: PAPER.id, requireRead: false })).resolves.toMatchObject({
			id: PAPER.id
		});
	});

	it('a fresh run has seen nothing, so isolation still holds', async () => {
		searchPapers.mockResolvedValue([PAPER]);
		const a = createResearchTools();
		await run(a.tools.search_papers, { query: 'a', limit: 8, sort: 'relevance' });

		const b = createResearchTools();
		const fresh = (await run(b.tools.search_papers, {
			query: 'a',
			limit: 8,
			sort: 'relevance'
		})) as Result;

		expect(fresh.repeats).toBe(0);
		expect(fresh.papers[0].abstract).toHaveLength(900);
	});
});
