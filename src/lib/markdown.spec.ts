import { describe, it, expect } from 'vitest';
import { renderMarkdown, toPlainText, safeHref } from './markdown';

/**
 * A hand-rolled markdown renderer earns its keep only if its failure modes are
 * pinned down. These are the ones that actually bite: escaping, the ordering of
 * inline passes, and links that execute.
 */

describe('escaping', () => {
	it('escapes HTML in ordinary text rather than passing it through', () => {
		const html = renderMarkdown('A <script>alert(1)</script> in the prose.');
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('escapes HTML inside a code span exactly once', () => {
		const html = renderMarkdown('Call `<Agent />` to start.');
		expect(html).toContain('<code>&lt;Agent /&gt;</code>');
		// The bug this catches: escaping the held HTML a second time on the way
		// out, which renders as literal &amp;lt; in the reader's client.
		expect(html).not.toContain('&amp;lt;');
	});

	it('escapes an ampersand in a URL without breaking the link', () => {
		const html = renderMarkdown('[q](https://x.org/s?a=1&b=2)');
		expect(html).toContain('href="https://x.org/s?a=1&amp;b=2"');
	});
});

describe('links that must not execute', () => {
	it('refuses a javascript: URL and leaves the source visible as text', () => {
		const html = renderMarkdown('[click](javascript:alert(1))');
		expect(html).not.toContain('href');
		expect(html).toContain('[click](javascript:alert(1))');
	});

	it('refuses data: URLs too', () => {
		expect(safeHref('data:text/html;base64,PHNjcmlwdD4=')).toBeUndefined();
	});

	it('accepts http, https and mailto, and upgrades a bare www host', () => {
		expect(safeHref('https://arxiv.org/abs/2401.1')).toBe('https://arxiv.org/abs/2401.1');
		expect(safeHref('mailto:mmv@mit.edu')).toBe('mailto:mmv@mit.edu');
		expect(safeHref('www.arxiv.org')).toBe('https://www.arxiv.org');
	});
});

describe('inline ordering — the two classic bugs', () => {
	it('does not emphasise asterisks inside a code span', () => {
		const html = renderMarkdown('Use `a ** b` for exponent.');
		expect(html).toContain('<code>a ** b</code>');
		expect(html).not.toContain('<strong>');
	});

	it('does not italicise an underscore inside a URL', () => {
		const html = renderMarkdown('See https://x.org/a_b_c for details.');
		expect(html).not.toContain('<em>');
		expect(html).toContain('href="https://x.org/a_b_c"');
	});

	it('renders bold before italic, leaving no stray asterisks', () => {
		const html = renderMarkdown('**bold** and *italic*');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
		expect(html).not.toContain('*');
	});
});

describe('autolinking', () => {
	it('links a bare URL and leaves the sentence full stop outside it', () => {
		const html = renderMarkdown('Read https://arxiv.org/abs/2401.12345.');
		expect(html).toContain('href="https://arxiv.org/abs/2401.12345"');
		expect(html).toContain('</a>.');
	});

	it('does not double-link a URL that is already an explicit link', () => {
		const html = renderMarkdown('[paper](https://arxiv.org/abs/1)');
		expect(html.match(/<a /g)).toHaveLength(1);
	});
});

describe('blocks', () => {
	it('renders headings at the right level', () => {
		expect(renderMarkdown('# One')).toContain('<h1>One</h1>');
		expect(renderMarkdown('### Three')).toContain('<h3>Three</h3>');
	});

	it('joins a wrapped paragraph into one <p>', () => {
		const html = renderMarkdown('one line\nand its continuation\n\nsecond para');
		expect(html).toContain('<p>one line and its continuation</p>');
		expect(html.match(/<p>/g)).toHaveLength(2);
	});

	it('renders bullet and numbered lists as flat lists', () => {
		expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
		expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
	});

	it('keeps a fenced code block literal, markdown included', () => {
		const html = renderMarkdown('```ts\nconst x = **not bold**;\n```');
		expect(html).toContain('const x = **not bold**;');
		expect(html).not.toContain('<strong>');
	});

	it('renders blockquotes and horizontal rules', () => {
		expect(renderMarkdown('> quoted')).toContain('<blockquote><p>quoted</p></blockquote>');
		expect(renderMarkdown('---')).toContain('<hr />');
	});

	it('survives a document that is only whitespace', () => {
		expect(renderMarkdown('   \n\n  \n')).toBe('');
	});

	it('terminates on a fence that is never closed', () => {
		const html = renderMarkdown('```\nunclosed');
		expect(html).toContain('unclosed');
	});
});

describe('style map', () => {
	it('inlines styles on the tags it names and leaves the rest bare', () => {
		const html = renderMarkdown('# T\n\nbody', { h1: 'color:red' });
		expect(html).toContain('<h1 style="color:red">T</h1>');
		expect(html).toContain('<p>body</p>');
	});

	it('puts the style before the href so both survive', () => {
		const html = renderMarkdown('[x](https://a.org)', { a: 'color:blue' });
		expect(html).toContain('<a style="color:blue" href="https://a.org">x</a>');
	});
});

describe('toPlainText', () => {
	it('strips emphasis and keeps a link target in parentheses', () => {
		const text = toPlainText('**Bold** and [a paper](https://arxiv.org/abs/1).');
		expect(text).toBe('Bold and a paper (https://arxiv.org/abs/1).');
	});

	it('uppercases headings and bullets lists', () => {
		const text = toPlainText('## Findings\n\n- first\n- second');
		expect(text).toContain('FINDINGS');
		expect(text).toContain('  • first');
	});

	it('leaves no markdown syntax behind in a realistic digest', () => {
		const text = toPlainText(
			'# Week in review\n\nOne *interesting* result, see `train.py` and\n' +
				'[the paper](https://arxiv.org/abs/2401.1).\n\n- a point\n\n> a quote\n'
		);
		expect(text).not.toMatch(/\*\*|`|^#|\]\(/m);
	});
});

/**
 * Figures the agent embedded.
 *
 * The app tells the model — in its instructions and in both figure tools'
 * descriptions — to embed a result with `![caption](path)`. It did, and the
 * renderer had no image rule at all, so a run that pulled six real figures out
 * of a paper printed six lines of literal markdown into the conversation. The
 * app was asking for something it could not display.
 */
describe('figures', () => {
	it('renders one from this app’s own store', () => {
		const html = renderMarkdown('![Figure 1 from arXiv:2404.14082](/figures/2404.14082-fig1.png)');
		expect(html).toContain('<img src="/figures/2404.14082-fig1.png"');
		expect(html).toContain('alt="Figure 1 from arXiv:2404.14082"');
		expect(html).toContain('loading="lazy"');
	});

	it('refuses a remote source', () => {
		/*
		 * The one rule here worth arguing about. An <img> is a request the
		 * reader's browser makes without being asked, and this text is written by
		 * a model out of paper abstracts — a remote source is a tracking pixel at
		 * best and a way to put text into someone else's logs at worst. Literal
		 * markdown is ugly and cannot hurt anyone.
		 */
		const html = renderMarkdown('![x](https://evil.example/pixel.png)');
		expect(html).not.toContain('<img');
		// And not a link either. Declining the image and then linking the same
		// address is a detour rather than a refusal — and it used to render as a
		// stray `!` in front of the link, which was the tell.
		expect(html).not.toContain('<a ');
		expect(html).toContain('![x](https://evil.example/pixel.png)');
	});

	it.each([
		'![x](/figures/../../etc/passwd)',
		'![x](javascript:alert(1))',
		'![x](data:image/svg+xml;base64,AAAA)',
		'![x](/other/thing.png)'
	])('refuses %s', (source) => {
		expect(renderMarkdown(source)).not.toContain('<img');
	});

	it('cannot break out of the attribute it lands in', () => {
		// The character class does this work: no quote, angle bracket or space
		// can reach the src, so this is refused outright. It then renders as
		// escaped text — which still contains the letters `onerror=`, and that is
		// not a finding: the property that matters is that no tag was built and
		// no quote survived unescaped.
		const html = renderMarkdown('![x](/figures/a"onerror="alert(1).png)');
		expect(html).not.toContain('<img');
		expect(html).not.toContain('"onerror');
		expect(html).toContain('&quot;onerror');
	});

	it('escapes the caption, which is model-written text', () => {
		const html = renderMarkdown('![<script>alert(1)</script>](/figures/a.png)');
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('does not leave a stray ! by letting the link rule run first', () => {
		// `![alt](src)` contains `[alt](src)`. A link rule running first eats the
		// inside and leaves the bang behind.
		const html = renderMarkdown('![cap](/figures/a.png)');
		expect(html).not.toContain('!<');
		expect(html).not.toContain('<a ');
	});

	it('still renders an ordinary link beside a figure', () => {
		const html = renderMarkdown('![cap](/figures/a.png) and [paper](https://arxiv.org/abs/1)');
		expect(html).toContain('<img');
		expect(html).toContain('<a href="https://arxiv.org/abs/1"');
	});

	it('renders the caption instead of a picture where a relative path cannot resolve', () => {
		// The email. A broken image icon in someone's inbox is worse than the
		// words the figure was captioned with.
		const html = renderMarkdown('![Figure 1](/figures/a.png)', {}, { images: false });
		expect(html).not.toContain('<img');
		expect(html).toContain('Figure 1');
		expect(html).not.toContain('![');
	});
});
