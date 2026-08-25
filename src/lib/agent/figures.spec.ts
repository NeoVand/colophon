import { describe, it, expect } from 'vitest';
import {
	extractFigures,
	extractPaperTitle,
	figurePageUrl,
	figureSlug,
	resolveFigureUrl
} from './figures';

/**
 * Shaped like arXiv's real LaTeXML output: a plain figure, a multi-panel figure
 * whose panels are nested `<figure>` elements, a figure whose caption carries
 * markup and maths, and one with no caption at all. Every quirk here was taken
 * from a real page rather than invented.
 */
const PAGE = `<!DOCTYPE html><html><head>
<meta name="citation_title" content="Sparse Autoencoders &amp; Composition">
<title>Sparse Autoencoders — arXiv</title></head><body>
<article class="ltx_document">
<h1 class="ltx_title ltx_title_document">Sparse Autoencoders</h1>

<figure class="ltx_figure" id="S1.F1">
  <img src="x1.png" class="ltx_graphics" alt="">
  <figcaption class="ltx_caption"><span class="ltx_tag">Figure 1:</span>
    Reconstruction error against <math><mi>k</mi></math>, for the
    <em>gated</em> variant.</figcaption>
</figure>

<figure class="ltx_figure" id="S2.F2">
  <figure class="ltx_figure ltx_figure_panel">
    <img src="pic/left.jpg">
    <figcaption class="ltx_caption">(a) Before training.</figcaption>
  </figure>
  <figure class="ltx_figure ltx_figure_panel">
    <img src="pic/right.jpg">
  </figure>
  <figcaption class="ltx_caption">Figure 2: Feature geometry, before and after.</figcaption>
</figure>

<figure class="ltx_figure" id="S3.F3">
  <img src="https://cdn.example.org/hosted.webp">
</figure>
</article></body></html>`;

const PAGE_URL = 'https://arxiv.org/html/2401.12345';

describe('extractFigures', () => {
	const figures = extractFigures(PAGE, PAGE_URL);

	it('finds every figure that carries an image, in document order', () => {
		expect(figures.map((f) => f.index)).toEqual([1, 2, 3, 4]);
		expect(figures.map((f) => f.url)).toEqual([
			'https://arxiv.org/html/2401.12345/x1.png',
			'https://arxiv.org/html/2401.12345/pic/left.jpg',
			'https://arxiv.org/html/2401.12345/pic/right.jpg',
			'https://cdn.example.org/hosted.webp'
		]);
	});

	it('flattens markup and maths out of a caption', () => {
		// LaTeXML wraps the number in a <span> and the symbols in <math>; a caption
		// pasted into a document must read as one line of prose.
		expect(figures[0].caption).toBe(
			'Figure 1: Reconstruction error against , for the gated variant.'
		);
	});

	it('does not count a multi-panel figure twice', () => {
		// The outer <figure> holds only the panels, so it contributes no image of
		// its own. A naive non-greedy tag match pairs the outer opening tag with
		// the first panel's closing one and mangles everything after it.
		expect(figures.filter((f) => f.url.includes('left.jpg'))).toHaveLength(1);
		expect(figures).toHaveLength(4);
	});

	it("gives a panel its own caption, and the parent's when it has none", () => {
		expect(figures[1].caption).toBe('(a) Before training.');
		expect(figures[2].caption).toBe('Figure 2: Feature geometry, before and after.');
	});

	it('leaves the caption empty rather than inventing one', () => {
		expect(figures[3].caption).toBe('');
	});

	it("takes the id from the paper's own numbering where the caption gives one", () => {
		expect(figures[0].id).toBe('fig1');
		// No label in "(a) Before training." — fall back to the position.
		expect(figures[1].id).toBe('fig2');
	});

	it('does not let a panel claim the number of the caption it borrowed', () => {
		// The third entry prints "Figure 2:" because it inherited it. Taking the
		// number too would collide with whichever entry is genuinely fig2.
		expect(figures[2].caption).toMatch(/^Figure 2:/);
		expect(figures[2].id).toBe('fig3');
		expect(new Set(figures.map((f) => f.id)).size).toBe(figures.length);
	});

	it('returns nothing for a page with no figures', () => {
		expect(extractFigures('<article><p>All prose.</p></article>', PAGE_URL)).toEqual([]);
	});

	it('skips a figure with no image', () => {
		const table = `<figure class="ltx_figure"><table><tr><td>1</td></tr></table>
			<figcaption>Table 1: Results.</figcaption></figure>`;
		expect(extractFigures(table, PAGE_URL)).toEqual([]);
	});

	it('survives an unbalanced closing tag', () => {
		const broken = `</figure><figure><img src="x9.png"><figcaption>Figure 9: Fine.</figcaption></figure>`;
		expect(extractFigures(broken, PAGE_URL)).toHaveLength(1);
	});

	it('drops a repeated image rather than listing the same picture twice', () => {
		const twice = `<figure><img src="x1.png"><figcaption>Figure 1: One.</figcaption></figure>
			<figure><img src="x1.png"><figcaption>Figure 1: One, again.</figcaption></figure>`;
		expect(extractFigures(twice, PAGE_URL)).toHaveLength(1);
	});

	it('accepts single-quoted and unquoted srcs', () => {
		const quoting = `<figure><img src='a.png'></figure><figure><img src=b.png></figure>`;
		expect(extractFigures(quoting, PAGE_URL).map((f) => f.url)).toEqual([
			'https://arxiv.org/html/2401.12345/a.png',
			'https://arxiv.org/html/2401.12345/b.png'
		]);
	});
});

describe('resolveFigureUrl', () => {
	it('treats the page as a directory when the src does not name it', () => {
		// The bug this exists for: browser semantics drops "2401.12345" as a
		// filename and asks for /html/x1.png, which is a 404 for every figure.
		expect(resolveFigureUrl('x1.png', 'https://arxiv.org/html/2401.12345')).toBe(
			'https://arxiv.org/html/2401.12345/x1.png'
		);
	});

	it('does not repeat the directory when the src already carries it', () => {
		expect(resolveFigureUrl('2401.12345v1/x1.png', 'https://arxiv.org/html/2401.12345v1')).toBe(
			'https://arxiv.org/html/2401.12345v1/x1.png'
		);
	});

	it('matches the directory across a version mismatch', () => {
		// The src names v1 while the page is version-less. String equality calls
		// these different segments, concludes the page is a directory, and asks
		// for /html/2401.12345/2401.12345v1/x1.png — the doubled id is the tell.
		expect(resolveFigureUrl('2401.12345v1/x1.png', 'https://arxiv.org/html/2401.12345')).toBe(
			'https://arxiv.org/html/2401.12345v1/x1.png'
		);
	});

	it('leaves an absolute src alone and gives a protocol-relative one https', () => {
		expect(resolveFigureUrl('https://cdn.example.org/a.png', PAGE_URL)).toBe(
			'https://cdn.example.org/a.png'
		);
		expect(resolveFigureUrl('//cdn.example.org/a.png', PAGE_URL)).toBe(
			'https://cdn.example.org/a.png'
		);
	});

	it('resolves a root-relative src against the host', () => {
		expect(resolveFigureUrl('/html/2401.12345/x2.png', PAGE_URL)).toBe(
			'https://arxiv.org/html/2401.12345/x2.png'
		);
	});
});

describe('ids and page urls', () => {
	it('strips the prefix and version from an id', () => {
		expect(figurePageUrl('arXiv:2401.12345v3')).toBe('https://arxiv.org/html/2401.12345');
	});

	it('keeps a legacy id to one path segment', () => {
		// A slash would invent a directory in the blob store.
		expect(figureSlug('hep-th/9711200')).toBe('hep-th-9711200');
		expect(figureSlug('2401.12345')).toBe('2401.12345');
	});
});

describe('extractPaperTitle', () => {
	it("prefers arXiv's own citation metadata, entities decoded", () => {
		expect(extractPaperTitle(PAGE)).toBe('Sparse Autoencoders & Composition');
	});

	it('falls back to the document heading', () => {
		const noMeta = '<h1 class="ltx_title ltx_title_document">A Paper</h1>';
		expect(extractPaperTitle(noMeta)).toBe('A Paper');
	});

	it('returns empty rather than a guess', () => {
		expect(extractPaperTitle('<p>nothing</p>')).toBe('');
	});
});
