import { describe, it, expect, vi } from 'vitest';
import { fetchPaper, htmlToText, extractSections, articleOnly, PaperUnavailable } from './paper';

/**
 * Shaped like arXiv's real LaTeXML output, including the furniture around the
 * article — which is the thing `articleOnly` exists to remove.
 */
const PAGE = `<!DOCTYPE html><html><head><style>.x{}</style></head><body>
<div class="ltx_page_navbar">arXiv navigation</div>
<div id="issue-modal">Report GitHub Issue × Title: Content selection saved. Describe the issue below: Submit</div>
<article class="ltx_document ltx_authors_1line">
  <h1 class="ltx_title">A Paper About Things</h1>
  <div class="ltx_authors">Ada Lovelace</div>
  <section id="S1"><h2 class="ltx_title">1 Introduction</h2>
    <p>We consider the problem of &amp; things.</p>
    <p>It is <em>hard</em>.</p>
  </section>
  <section id="S2"><h2 class="ltx_title">2 Method</h2>
    <p>We use <math><mi>x</mi></math> a technique.</p>
    <figure><figcaption>Figure 1: A diagram.</figcaption></figure>
  </section>
</article>
<footer>Licensed under CC BY 4.0</footer>
<script>console.log('tracking')</script>
</body></html>`;

describe('articleOnly', () => {
	it('drops arXiv furniture from before and after the article', () => {
		const inner = articleOnly(PAGE);
		// The bug this exists for: the issue-reporting modal otherwise lands at
		// the very top of every paper's text.
		expect(inner).not.toContain('Report GitHub Issue');
		expect(inner).not.toContain('ltx_page_navbar');
		expect(inner).not.toContain('CC BY 4.0');
		expect(inner).toContain('A Paper About Things');
	});

	it('returns the page unchanged when there is no LaTeXML article', () => {
		const plain = '<html><body><p>Not a paper.</p></body></html>';
		expect(articleOnly(plain)).toBe(plain);
	});
});

describe('htmlToText', () => {
	const text = htmlToText(articleOnly(PAGE));

	it('keeps prose and decodes entities', () => {
		expect(text).toContain('We consider the problem of & things.');
	});

	it('does not weld a heading onto the paragraph beneath it', () => {
		// Block tags become newlines before tags are stripped, or you get
		// "1 IntroductionWe consider…". `[ \t]*` not `\s*`, because \s matches the
		// newline that is precisely what should be there.
		expect(text).not.toMatch(/Introduction[ \t]*We consider/);
		expect(text).toMatch(/1 Introduction\n+We consider/);
	});

	it('drops script, style and math content rather than flattening it in', () => {
		expect(text).not.toContain('tracking');
		expect(text).not.toContain('.x{}');
		// The math *content* goes; the sentence around it survives.
		expect(text).toContain('We use');
		expect(text).toContain('a technique');
	});

	it('keeps figure captions — they carry the paper’s results', () => {
		expect(text).toContain('Figure 1: A diagram.');
	});

	it('collapses runs of spaces but preserves paragraph breaks', () => {
		expect(text).not.toMatch(/ {2,}/);
		expect(text).toMatch(/\n/);
	});
});

describe('extractSections', () => {
	it('lists headings in document order', () => {
		expect(extractSections(articleOnly(PAGE))).toEqual([
			'A Paper About Things',
			'1 Introduction',
			'2 Method'
		]);
	});
});

describe('fetchPaper', () => {
	const respond = (body: string, status = 200) =>
		vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

	it('normalises the id, stripping any version and prefix', async () => {
		const fetchImpl = respond(
			PAGE.replace('<p>We consider', '<p>' + 'x'.repeat(2500) + ' We consider')
		);
		const paper = await fetchPaper('arXiv:2404.14082v3', { fetchImpl });
		expect(paper.arxivId).toBe('2404.14082');
		expect(String(vi.mocked(fetchImpl).mock.calls[0][0])).toBe('https://arxiv.org/html/2404.14082');
	});

	it('reports the HTML edition when the article has real content', async () => {
		const long = PAGE.replace('<p>It is <em>hard</em>.</p>', `<p>${'prose '.repeat(500)}</p>`);
		const paper = await fetchPaper('2404.14082', { fetchImpl: respond(long) });
		expect(paper.edition).toBe('html');
		expect(paper.title).toBe('A Paper About Things');
		expect(paper.chars).toBeGreaterThan(2000);
	});

	it('treats a LaTeXML stub as absent rather than as an empty paper', async () => {
		// The page exists but carries almost nothing — common where the author's
		// TeX failed to convert. Falling through to the abstract is the honest
		// outcome, not returning a paper with no content.
		const stub = '<article class="ltx_document"><h1>Title</h1><p>short</p></article>';
		const paper = await fetchPaper('1234.5678', {
			fetchImpl: respond(stub),
			fallbackAbstract: 'The real abstract.'
		});
		expect(paper.edition).toBe('abstract');
		expect(paper.text).toBe('The real abstract.');
	});

	it('falls back to the abstract on a 404', async () => {
		const paper = await fetchPaper('9999.99999', {
			fetchImpl: respond('nope', 404),
			fallbackAbstract: 'Only the abstract.'
		});
		expect(paper.edition).toBe('abstract');
	});

	it('survives a network failure and still falls back', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('DNS exploded');
		}) as unknown as typeof fetch;
		const paper = await fetchPaper('1.1', { fetchImpl, fallbackAbstract: 'abs' });
		expect(paper.edition).toBe('abstract');
	});

	it('throws only when there is no text and nothing to fall back on', async () => {
		await expect(fetchPaper('9999.99999', { fetchImpl: respond('nope', 404) })).rejects.toThrow(
			PaperUnavailable
		);
	});
});
