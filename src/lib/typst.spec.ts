import { describe, it, expect } from 'vitest';
import { checkDelimiters, outline, titleOf, inspectTypst } from './typst';

/**
 * The interesting cases are all the same case: a bracket, a heading or a quote
 * that is inside something literal and must therefore not count. A reader who
 * is told their brackets are unbalanced because of a `{` in a code sample stops
 * trusting the check, and an unreliable check is worse than none.
 */

describe('outline', () => {
	it('reads levels from the run of equals signs', () => {
		const headings = outline('= Title\n\n== Method\n\n=== Ablations\n');
		expect(headings.map((h) => [h.level, h.text])).toEqual([
			[1, 'Title'],
			[2, 'Method'],
			[3, 'Ablations']
		]);
	});

	it('records 1-based line numbers so a jump lands where the reader looks', () => {
		expect(outline('#set page(margin: 2cm)\n\n= Title\n').map((h) => h.line)).toEqual([3]);
	});

	it('ignores a heading inside a raw block', () => {
		const source = '= Real\n\n```\n= not a heading\n```\n\n== Also real\n';
		expect(outline(source).map((h) => h.text)).toEqual(['Real', 'Also real']);
	});

	it('ignores a heading inside a comment, including a nested block comment', () => {
		const source = '= Real\n\n/* = hidden /* still hidden */ = hidden */\n\n== Also real\n';
		expect(outline(source).map((h) => h.text)).toEqual(['Real', 'Also real']);
	});

	it('keeps a raw span that appears inside a heading', () => {
		// The masked copy decides *whether* a line is a heading; the original
		// supplies the text. This is the test that pins the two apart.
		expect(outline('== The `#let` binding\n')[0].text).toBe('The `#let` binding');
	});

	it('drops a trailing cross-reference label from the display text', () => {
		expect(outline('= Introduction <intro>\n')[0].text).toBe('Introduction');
	});

	it('requires whitespace after the marker, as Typst does', () => {
		expect(outline('==Not a heading\n')).toEqual([]);
	});

	it('gives identically-named sections distinct keys', () => {
		// A duplicate key in a Svelte keyed each throws, and the throw aborts the
		// render — the reader is left looking at the previous document. Two
		// sections called "Results" is an ordinary thing for a paper to contain.
		const headings = outline('== Results\n\ntext\n\n== Results\n');
		expect(headings).toHaveLength(2);
		expect(new Set(headings.map((h) => h.key)).size).toBe(2);
	});
});

describe('titleOf', () => {
	it('prefers the title the author set explicitly', () => {
		const source =
			'#set document(title: "Sparse Autoencoders", author: "MMV")\n\n= Draft heading\n';
		expect(titleOf(source)).toBe('Sparse Autoencoders');
	});

	it('unescapes a quote inside the declared title', () => {
		expect(titleOf('#set document(title: "The \\"hard\\" problem")')).toBe('The "hard" problem');
	});

	it('falls back to the first top-level heading', () => {
		expect(titleOf('== Method\n\n= Attention Revisited\n')).toBe('Attention Revisited');
	});

	it('returns nothing rather than inventing a title', () => {
		expect(titleOf('Just a paragraph of prose.\n')).toBeUndefined();
	});
});

describe('checkDelimiters', () => {
	it('passes a balanced document', () => {
		expect(checkDelimiters('#figure(image("a.png"), caption: [A caption])\n')).toBeNull();
	});

	it('names the line of an opener that is never closed', () => {
		const problem = checkDelimiters('= Title\n\n#box[ some text\n');
		expect(problem?.line).toBe(3);
		expect(problem?.message).toContain('line 3');
		expect(problem?.message).toContain('never closed');
	});

	it('names both lines when a closer is the wrong shape', () => {
		const problem = checkDelimiters('#box[\n  text\n)\n');
		expect(problem?.line).toBe(3);
		expect(problem?.message).toContain('line 1');
		expect(problem?.message).toContain(']');
	});

	it('reports a closer that closes nothing', () => {
		const problem = checkDelimiters('= Title\n\ntext )\n');
		expect(problem?.line).toBe(3);
		expect(problem?.column).toBe(6);
		expect(problem?.message).toContain('closes nothing');
	});

	it('does not count brackets inside a string', () => {
		expect(checkDelimiters('#link("https://x.org/a(b")[link]\n')).toBeNull();
	});

	it('does not count brackets inside a raw block', () => {
		expect(checkDelimiters('```rust\nfn main() { let x = [1, 2; }\n```\n')).toBeNull();
	});

	it('does not count brackets inside a comment', () => {
		expect(checkDelimiters('// TODO: close this ]\n#box[ok]\n')).toBeNull();
		expect(checkDelimiters('/* [[[ */\n#box[ok]\n')).toBeNull();
	});

	it('does not count an escaped bracket', () => {
		expect(checkDelimiters('A literal \\[ in the prose.\n')).toBeNull();
	});

	it('reports an unterminated string before it reports brackets', () => {
		// Once a quote is missing, every brace after it is being counted wrongly.
		// "unbalanced { on line 400" would be a true statement about a wrong file.
		const problem = checkDelimiters('#let a = "oops\n\n#box[fine]\n');
		expect(problem?.line).toBe(1);
		expect(problem?.message).toContain('string');
	});

	it('reports an unterminated block comment', () => {
		const problem = checkDelimiters('= Title\n/* opened and left open\n#box[ok]\n');
		expect(problem?.line).toBe(2);
		expect(problem?.message).toContain('comment');
	});

	it('does not end an outer comment at the first close of a nested one', () => {
		// A single indexOf('*/') would hand `}` back to the scanner as live code.
		expect(checkDelimiters('/* outer /* inner */ still outer } */\n')).toBeNull();
	});

	it('reports the innermost unclosed opener, nearest where the writing stopped', () => {
		const problem = checkDelimiters('#box[\n  #box(\n');
		expect(problem?.line).toBe(2);
		expect(problem?.message).toContain('(');
	});
});

describe('inspectTypst', () => {
	it('answers all three questions in one pass', () => {
		const source = '#set document(title: "A Paper")\n\n= Heading\n\n#box[ok]\n';
		const reading = inspectTypst(source);
		expect(reading.title).toBe('A Paper');
		expect(reading.headings).toHaveLength(1);
		expect(reading.problem).toBeNull();
	});

	it('agrees with the single-purpose functions', () => {
		const source = '= One\n\n== Two\n\n#box[\n';
		const reading = inspectTypst(source);
		expect(reading.headings).toEqual(outline(source));
		expect(reading.problem).toEqual(checkDelimiters(source));
		expect(reading.title).toBe(titleOf(source));
	});
});
