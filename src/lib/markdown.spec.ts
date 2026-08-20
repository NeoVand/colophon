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
