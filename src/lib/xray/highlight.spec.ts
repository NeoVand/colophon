import { describe, it, expect } from 'vitest';
import { tokenizeJson, pretty, type Token } from './highlight';

const kinds = (src: string) => tokenizeJson(src).map((t: Token) => t.kind);
const textOf = (src: string, kind: string) =>
	tokenizeJson(src)
		.filter((t: Token) => t.kind === kind)
		.map((t: Token) => t.text);

describe('the invariant everything else rests on', () => {
	it('reproduces the input exactly, token for token', () => {
		const cases = [
			'{"a": 1}',
			'',
			'   ',
			'{"nested": {"list": [1, 2, {"deep": true}]}}',
			'{"a": "unterminated',
			'<html>502 Bad Gateway</html>',
			'{"unicode": "\\u00e9 café", "emoji": "👍"}'
		];
		for (const src of cases) {
			expect(
				tokenizeJson(src)
					.map((t) => t.text)
					.join(''),
				src
			).toBe(src);
		}
	});
});

describe('tokenizeJson', () => {
	it('separates a key from a string value', () => {
		expect(kinds('{"a": "b"}')).toEqual(['punct', 'key', 'punct', 'string', 'punct']);
	});

	it('leaves the colon with the punctuation, not with the key', () => {
		expect(textOf('{"a": 1}', 'key')).toEqual(['"a"']);
		expect(textOf('{"a": 1}', 'punct')).toEqual(['{', ': ', '}']);
	});

	it('reads numbers in every JSON spelling', () => {
		expect(textOf('[-1.5e10, 0, -0.25, 3E+7]', 'number')).toEqual([
			'-1.5e10',
			'0',
			'-0.25',
			'3E+7'
		]);
	});

	it('marks the three literals', () => {
		const src = '{"a": null, "b": true, "c": false}';
		expect(textOf(src, 'bool')).toEqual(['true', 'false']);
		expect(textOf(src, 'null')).toEqual(['null']);
	});

	it('does not find a keyword inside a string', () => {
		// The classic false positive: `"true"` is a string whose contents happen
		// to spell a literal, and colouring it as one is simply wrong.
		expect(kinds('{"a": "true"}')).not.toContain('bool');
		expect(textOf('{"a": "true"}', 'string')).toEqual(['"true"']);
	});

	it('does not find a number inside a string', () => {
		expect(kinds('{"id": "2401.12345"}')).not.toContain('number');
	});

	it('does not treat a colon inside a value as making it a key', () => {
		expect(textOf('{"a": "b: c"}', 'key')).toEqual(['"a"']);
		expect(textOf('{"a": "b: c"}', 'string')).toEqual(['"b: c"']);
	});

	it('keeps an escaped quote inside the string it belongs to', () => {
		expect(textOf('{"a\\"b": 1}', 'key')).toEqual(['"a\\"b"']);
	});

	it('has nothing to say about an empty payload', () => {
		expect(tokenizeJson('')).toEqual([]);
	});
});

describe('malformed input, which the inspector shows anyway', () => {
	it('does not throw on a body that was never JSON', () => {
		expect(() => tokenizeJson('<html>502 Bad Gateway</html>')).not.toThrow();
	});

	it('leaves a stream cut mid-string unhighlighted rather than mis-highlighted', () => {
		const src = '{"a": "unterminated';
		// No closing quote, so there is no string here to colour — and the text
		// still reaches the screen, as punctuation, unchanged.
		expect(kinds(src)).not.toContain('string');
		expect(
			tokenizeJson(src)
				.map((t) => t.text)
				.join('')
		).toBe(src);
	});

	it('handles a trailing comma and an unclosed brace', () => {
		expect(() => tokenizeJson('{"a": 1,')).not.toThrow();
		expect(textOf('{"a": 1,', 'number')).toEqual(['1']);
	});
});

describe('pretty', () => {
	it('indents valid JSON by two', () => {
		expect(pretty('{"a":1}')).toBe('{\n  "a": 1\n}');
	});

	it('hands back anything that does not parse, untouched', () => {
		expect(pretty('nope {')).toBe('nope {');
		expect(pretty('')).toBe('');
	});
});
