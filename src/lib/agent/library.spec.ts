import { describe, it, expect } from 'vitest';
import { absorb, absorbPapers, type KnownPaper } from './library';

/**
 * These fixtures are copied from what the tools in `tools.ts` actually return,
 * not from what would be convenient. That is the entire point of the file: the
 * first version of this code keyed on `results` while `search_papers` returns
 * `papers`, and the only symptom was an empty panel during a run that had
 * retrieved eight papers. Nothing failed, nothing logged, nothing was red.
 */

const SEARCH = {
	count: 2,
	papers: [
		{
			id: '2608.13337',
			title: 'Where You Measure Decides What You Measure',
			authors: ['Amélie Noël'],
			year: 2026,
			citedBy: 3,
			abstract: 'Ablation-based SAE evaluation…'
		},
		{
			id: '2608.14922',
			title: 'SpIn-ViT',
			authors: ['Jae Lee', 'Ada Kim'],
			year: 2026,
			citedBy: 0,
			abstract: 'A sparsity-induced vision transformer…'
		}
	]
};

const FETCH = {
	arxivId: '2608.13337',
	title: 'Where You Measure Decides What You Measure',
	edition: 'html',
	sections: ['Introduction', 'Method'],
	chars: 48_210,
	truncated: true,
	text: '…'
};

const CITE = {
	citation: 'Lee et al. (2026), "SpIn-ViT"',
	id: '2608.14922',
	title: 'SpIn-ViT',
	authors: ['Jae Lee', 'Ada Kim'],
	year: 2026,
	url: 'https://arxiv.org/abs/2608.14922',
	depth: 'listed'
};

describe('search_papers', () => {
	it('reads the `papers` key the tool actually returns', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', SEARCH);
		expect(library).toHaveLength(2);
		expect(library[0].title).toBe('Where You Measure Decides What You Measure');
		expect(library[0].depth).toBe('listed');
		expect(library[0].cited).toBe(false);
	});

	it('is not fooled by a `results` key, which no tool here returns', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', { results: SEARCH.papers });
		expect(library).toEqual([]);
	});

	it('builds an arXiv link from a bare arXiv id', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', SEARCH);
		expect(library[0].url).toBe('https://arxiv.org/abs/2608.13337');
	});

	it('invents no link for an id that is not an arXiv id', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', { papers: [{ id: '10.1234/foo', title: 'A journal paper' }] });
		expect(library[0].url).toBeUndefined();
	});
});

describe('depth', () => {
	it('promotes a listed paper to read when it is fetched', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', SEARCH);
		absorb(library, 'fetch_paper', FETCH);

		expect(library).toHaveLength(2);
		expect(library.find((p) => p.id === '2608.13337')?.depth).toBe('read');
		expect(library.find((p) => p.id === '2608.13337')?.chars).toBe(48_210);
	});

	it('never lets depth go back down', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'fetch_paper', FETCH);
		absorb(library, 'search_papers', SEARCH);
		expect(library.find((p) => p.id === '2608.13337')?.depth).toBe('read');
	});

	/**
	 * `fetch_paper` falls back to an abstract edition when arXiv has no HTML
	 * rather than throwing. Counting that as `read` would tell the reader a full
	 * text arrived when none did — and `read` is exactly the permission the
	 * `cite` tool checks before allowing a claim about contents.
	 */
	it('does not count an abstract-only fetch as read', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'fetch_paper', { ...FETCH, edition: 'abstract', chars: 900 });
		expect(library[0].depth).toBe('listed');
	});
});

describe('citation', () => {
	it('marks a paper cited and keeps the URL the tool supplied', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', SEARCH);
		absorb(library, 'cite', CITE);

		const spin = library.find((p) => p.id === '2608.14922');
		expect(spin?.cited).toBe(true);
		expect(spin?.url).toBe('https://arxiv.org/abs/2608.14922');
		expect(library).toHaveLength(2);
	});

	it('adds a paper cited without having been searched for in this run', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'cite', CITE);
		expect(library).toHaveLength(1);
		expect(library[0].cited).toBe(true);
	});
});

describe('identity', () => {
	it('does not add the same paper twice under a different key', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', SEARCH);
		absorb(library, 'fetch_paper', FETCH); // arXiv id
		absorb(library, 'cite', CITE); // plain id
		expect(library).toHaveLength(2);
	});

	it('drops a row with no usable identifier rather than keying it on nothing', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', { papers: [{ title: 'Nameless' }] });
		expect(library).toEqual([]);
	});

	it('ignores tools that are not about papers', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'generate_image', { path: '/figures/x.png', bytes: 700_000 });
		absorb(library, undefined, SEARCH);
		expect(library).toEqual([]);
	});

	it('survives a null or non-object result', () => {
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', null);
		absorb(library, 'search_papers', 'not an object');
		expect(library).toEqual([]);
	});
});

/**
 * The pipeline's door into the same library.
 *
 * Two doors, one room: the chat agent's papers arrive as tool results and the
 * pipeline's arrive on step outputs, and the rules that make the library a
 * truthful readout — depth only increases, a paper met twice is one paper —
 * have to hold whichever way in a paper came.
 */
describe('absorbPapers', () => {
	it('lists what a search step turned up', () => {
		const library: KnownPaper[] = [];
		absorbPapers(library, [{ id: '2401.00001', title: 'A paper', year: 2024, depth: 'listed' }]);

		expect(library).toEqual([
			expect.objectContaining({
				id: '2401.00001',
				title: 'A paper',
				year: 2024,
				depth: 'listed',
				cited: false,
				url: 'https://arxiv.org/abs/2401.00001'
			})
		]);
	});

	it('promotes a listed paper to read rather than adding it twice', () => {
		// A search finds it, then a reader opens it. One paper, two facts.
		const library: KnownPaper[] = [];
		absorbPapers(library, [{ id: '2401.00001', title: 'A paper', depth: 'listed' }]);
		absorbPapers(library, [{ id: '2401.00001', depth: 'read' }]);

		expect(library).toHaveLength(1);
		expect(library[0].depth).toBe('read');
		// And the title survives the second, thinner mention.
		expect(library[0].title).toBe('A paper');
	});

	it('never demotes a paper met again', () => {
		const library: KnownPaper[] = [];
		absorbPapers(library, [{ id: '2401.00001', depth: 'read' }]);
		absorbPapers(library, [{ id: '2401.00001', depth: 'listed' }]);
		expect(library[0].depth).toBe('read');
	});

	it('carries the cited flag the writer proved', () => {
		const library: KnownPaper[] = [];
		absorbPapers(library, [{ id: '2401.00002', depth: 'read', cited: true }]);
		expect(library[0].cited).toBe(true);
	});

	it('shares its identity rules with the tool-result door', () => {
		// Same room: a paper the chat agent found and one the pipeline read are
		// the same row, not two.
		const library: KnownPaper[] = [];
		absorb(library, 'search_papers', { papers: [{ id: '2401.00003', title: 'Shared' }] });
		absorbPapers(library, [{ id: '2401.00003', depth: 'read' }]);

		expect(library).toHaveLength(1);
		expect(library[0]).toMatchObject({ title: 'Shared', depth: 'read' });
	});
});
