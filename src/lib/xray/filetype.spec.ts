import { describe, it, expect } from 'vitest';
import { kindOf, faceOf, FILE_FACE, type FileKind } from './filetype';

describe('kindOf', () => {
	it('classifies the extensions the app actually meets', () => {
		expect(kindOf('paper.pdf')).toBe('pdf');
		expect(kindOf('notes.md')).toBe('doc');
		expect(kindOf('figure3.png')).toBe('image');
		expect(kindOf('results.csv')).toBe('data');
		expect(kindOf('main.ts')).toBe('code');
		expect(kindOf('log.txt')).toBe('plain');
	});

	it('is case-insensitive, because arXiv is not consistent about it', () => {
		expect(kindOf('SCAN.PDF')).toBe('pdf');
		expect(kindOf('Notes.MD')).toBe('doc');
	});

	it('ignores a query string or fragment on a URL', () => {
		expect(kindOf('https://arxiv.org/figures/fig3.png?v=2')).toBe('image');
		expect(kindOf('README.md#installation')).toBe('doc');
	});

	it('does not mistake a dot in a directory for an extension', () => {
		expect(kindOf('docs.v2/README')).toBe('plain');
		expect(kindOf('/tmp/run.2026/data.csv')).toBe('data');
	});

	it('reads a leading dot as a name, not a suffix', () => {
		expect(kindOf('.gitignore')).toBe('plain');
		expect(kindOf('.eslintrc.json')).toBe('data');
	});

	it('handles a Windows path', () => {
		expect(kindOf('C:\\Users\\neo\\main.ts')).toBe('code');
	});

	it('calls an SVG a picture rather than markup', () => {
		// It is both, and it arrives here as a figure every time.
		expect(kindOf('diagram.svg')).toBe('image');
	});

	it('falls back to plain for anything with no usable extension', () => {
		expect(kindOf('')).toBe('plain');
		expect(kindOf('README')).toBe('plain');
		expect(kindOf('file.')).toBe('plain');
		expect(kindOf('archive.xyzzy')).toBe('plain');
	});
});

describe('FILE_FACE', () => {
	const kinds = Object.keys(FILE_FACE) as FileKind[];

	it('has an entry that agrees with its own key', () => {
		for (const kind of kinds) expect(FILE_FACE[kind].kind).toBe(kind);
	});

	it('gives every kind its own --co-file-* token, never a shared one', () => {
		const tokens = kinds.map((k) => FILE_FACE[k].token);
		for (const token of tokens) expect(token.startsWith('--co-file-')).toBe(true);
		// A duplicate token would silently paint two kinds the same colour, which
		// is the one thing a legend must not do.
		expect(new Set(tokens).size).toBe(tokens.length);
	});

	it('never carries a literal colour, and falls back while the tokens are undeclared', () => {
		for (const kind of kinds) {
			const { color, token } = FILE_FACE[kind];
			expect(color).toBe(`var(${token}, var(--muted-foreground))`);
			expect(color).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|oklch/i);
		}
	});

	it('labels every kind for the readers who cannot see the glyph', () => {
		for (const kind of kinds) expect(FILE_FACE[kind].label.length).toBeGreaterThan(0);
	});
});

describe('faceOf', () => {
	it('is kindOf and the table in one call', () => {
		expect(faceOf('paper.pdf')).toBe(FILE_FACE.pdf);
		expect(faceOf('unknowable')).toBe(FILE_FACE.plain);
	});
});
