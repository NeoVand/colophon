import { describe, it, expect, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const {
	parseArxivAtom,
	reassembleAbstract,
	searchPapers,
	searchOpenAlex,
	arxivQuery,
	QuotaExhausted
} = await import('./retrieval');

/** A real arXiv Atom response, trimmed to two entries. */
const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <updated>2023-08-02T00:41:18Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>  The dominant sequence transduction models are based on complex recurrent or
convolutional neural networks.
</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2005.14165v4</id>
    <published>2020-05-28T17:29:11Z</published>
    <title>Language Models are Few-Shot Learners &amp; more</title>
    <summary>Recent work has demonstrated substantial gains.</summary>
    <author><name>Tom B. Brown</name></author>
  </entry>
</feed>`;

describe('parseArxivAtom', () => {
	const papers = parseArxivAtom(ATOM);

	it('reads both entries', () => {
		expect(papers).toHaveLength(2);
	});

	it('strips the version suffix and the URL prefix from the id', () => {
		// arXiv ids arrive as http://arxiv.org/abs/1706.03762v7 and must reduce to
		// the versionless id, or the same paper registers twice.
		expect(papers[0].id).toBe('1706.03762');
		expect(papers[0].arxivId).toBe('1706.03762');
	});

	it('collapses the whitespace arXiv wraps titles and abstracts in', () => {
		expect(papers[0].title).toBe('Attention Is All You Need');
		expect(papers[0].summary).not.toMatch(/\n/);
		expect(papers[0].summary).toMatch(/^The dominant sequence/);
	});

	it('decodes XML entities', () => {
		expect(papers[1].title).toBe('Language Models are Few-Shot Learners & more');
	});

	it('collects every author', () => {
		expect(papers[0].authors).toEqual(['Ashish Vaswani', 'Noam Shazeer']);
	});

	it('takes the year from the published date', () => {
		expect(papers[0].year).toBe(2017);
		expect(papers[1].year).toBe(2020);
	});

	it('derives the arXiv DOI, so OpenAlex results merge onto the same id', () => {
		expect(papers[0].doi).toBe('10.48550/arXiv.1706.03762');
	});

	it('returns nothing for an empty feed rather than throwing', () => {
		expect(parseArxivAtom('<feed></feed>')).toEqual([]);
	});
});

describe('arxivQuery', () => {
	it('ANDs multiple terms, because arXiv defaults to OR', () => {
		// Verified live: arXiv echoed `all:mechanistic OR all:interpretability`
		// and returned papers about neither.
		expect(arxivQuery('mechanistic interpretability')).toBe(
			'all:mechanistic AND all:interpretability'
		);
	});

	it('leaves a single term alone', () => {
		expect(arxivQuery('transformers')).toBe('all:transformers');
	});

	it('passes through a query that already uses field prefixes', () => {
		expect(arxivQuery('cat:cs.LG')).toBe('cat:cs.LG');
		expect(arxivQuery('ti:attention AND au:Vaswani')).toBe('ti:attention AND au:Vaswani');
	});

	it('passes through an explicit operator', () => {
		expect(arxivQuery('sparse OR dense')).toBe('sparse OR dense');
	});
});

describe('reassembleAbstract', () => {
	it('rebuilds text from OpenAlex’s inverted index', () => {
		// OpenAlex ships abstracts inverted to sidestep republishing restrictions.
		expect(reassembleAbstract({ Attention: [0], is: [1], all: [2], 'you need': [3] })).toBe(
			'Attention is all you need'
		);
	});

	it('handles a word appearing more than once', () => {
		expect(reassembleAbstract({ the: [0, 2], cat: [1], hat: [3] })).toBe('the cat the hat');
	});

	it('is empty when there is no abstract', () => {
		expect(reassembleAbstract(undefined)).toBe('');
	});
});

describe('OpenAlex quota', () => {
	it('reports a daily quota as such, rather than as a retryable failure', async () => {
		const fetchImpl = vi.fn(
			async () => new Response('', { status: 429, headers: { 'x-ratelimit-reset': '7200' } })
		) as unknown as typeof fetch;
		await expect(searchOpenAlex('x', { fetchImpl })).rejects.toThrow(QuotaExhausted);
		await expect(searchOpenAlex('x', { fetchImpl })).rejects.toThrow(/about 2h/);
	});

	it('joins the polite pool only when a contact address is configured', async () => {
		// A fresh Response per call: a body can only be read once, so
		// mockResolvedValue would hand the second call an exhausted stream.
		const fetchImpl = vi.fn(async () => Response.json({ results: [] })) as unknown as typeof fetch;

		env.OPENALEX_MAILTO = undefined;
		await searchOpenAlex('x', { fetchImpl });
		expect(String(vi.mocked(fetchImpl).mock.calls[0][0])).not.toContain('mailto');

		env.OPENALEX_MAILTO = 'someone@example.org';
		await searchOpenAlex('x', { fetchImpl });
		expect(String(vi.mocked(fetchImpl).mock.calls[1][0])).toContain('mailto=someone%40example.org');
		env.OPENALEX_MAILTO = undefined;
	});
});

describe('canonical ids', () => {
	it('finds the arXiv id in a landing URL when the DOI is a publisher one', async () => {
		// The bug this covers: keyed by URL from a search and by arXiv id from a
		// fetch, the same paper became two entries and two library rows.
		const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
			if (String(url).includes('openalex')) {
				return Response.json({
					results: [
						{
							title: 'A Paper',
							doi: 'https://doi.org/10.1234/publisher.5678',
							primary_location: { landing_page_url: 'https://arxiv.org/abs/2608.13337v2' },
							publication_year: 2026
						}
					]
				});
			}
			return new Response('<feed></feed>');
		}) as unknown as typeof fetch;

		const [paper] = await searchPapers('x', { fetchImpl });
		expect(paper.arxivId).toBe('2608.13337');
		expect(paper.id).toBe('2608.13337');
	});

	it('still falls back to the DOI when there is no arXiv anywhere', async () => {
		const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
			if (String(url).includes('openalex')) {
				return Response.json({
					results: [
						{ title: 'Journal Paper', doi: 'https://doi.org/10.1234/x', publication_year: 2024 }
					]
				});
			}
			return new Response('<feed></feed>');
		}) as unknown as typeof fetch;

		const [paper] = await searchPapers('x', { fetchImpl });
		expect(paper.arxivId).toBeUndefined();
		expect(paper.id).toBe('10.1234/x');
	});
});

describe('searchPapers merge', () => {
	it('degrades rather than fails when one service is down', async () => {
		const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
			if (String(url).includes('openalex')) throw new Error('OpenAlex is down');
			return new Response(ATOM);
		}) as unknown as typeof fetch;

		const papers = await searchPapers('attention', { fetchImpl });
		// A review written from arXiv alone is worse, not impossible.
		expect(papers).toHaveLength(2);
		expect(papers[0].id).toBe('1706.03762');
	});

	it('merges a paper found in both into one entry carrying both contributions', async () => {
		const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
			if (String(url).includes('openalex')) {
				return Response.json({
					results: [
						{
							title: 'Attention Is All You Need',
							doi: 'https://doi.org/10.48550/arXiv.1706.03762',
							cited_by_count: 140000,
							publication_year: 2017,
							authorships: [{ author: { display_name: 'Ashish Vaswani' } }]
						}
					]
				});
			}
			return new Response(ATOM);
		}) as unknown as typeof fetch;

		const papers = await searchPapers('attention', { fetchImpl });
		const attention = papers.find((p) => p.id === '1706.03762');
		expect(papers.filter((p) => p.id === '1706.03762')).toHaveLength(1);
		// arXiv's abstract, OpenAlex's citation count.
		expect(attention?.summary).toMatch(/^The dominant sequence/);
		expect(attention?.citedBy).toBe(140000);
	});

	it('throws only when both services fail', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('network down');
		}) as unknown as typeof fetch;
		await expect(searchPapers('x', { fetchImpl })).rejects.toThrow();
	});
});
