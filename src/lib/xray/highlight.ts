/**
 * JSON syntax highlighting, in one regex and no dependency.
 *
 * The raw payload inspector shows one language, and the payloads it shows run
 * to megabytes. A real highlighter costs about a megabyte of grammar and a WASM
 * engine to answer a question this answers in forty lines, synchronously,
 * before the pane has finished opening.
 *
 * The important part is what it returns. **Tokens, not HTML.** The strings
 * being highlighted are model output and provider replies — untrusted by
 * construction — and a function that returned a marked-up string would be one
 * `{@html}` away from executing them. A token list is rendered with real
 * elements, and there is no path from a payload to the DOM as markup.
 *
 * It never parses, which is the second reason it exists in this form: a
 * response cut off mid-stream, a body that was never JSON, an error page from a
 * proxy — the inspector has to show all of them. Anything the pattern does not
 * recognise falls through as `punct` and is displayed verbatim.
 */

/** `punct` is the catch-all: braces, commas, colons, whitespace, and anything unrecognised. */
export type TokenKind = 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct';

export interface Token {
	text: string;
	kind: TokenKind;
}

const PATTERN = new RegExp(
	[
		// A key is a string followed by a colon. The colon is *looked ahead* to,
		// not consumed, so it stays in the punctuation run and dims with the
		// braces instead of glowing with the name it follows.
		'("(?:\\\\.|[^"\\\\])*")(?=\\s*:)',
		'("(?:\\\\.|[^"\\\\])*")',
		'(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)',
		'\\b(true|false)\\b',
		'\\b(null)\\b'
	].join('|'),
	'g'
);

/**
 * Split a JSON string into display tokens.
 *
 * The concatenation of every `text` is exactly the input — no character is
 * dropped, added or re-ordered. That invariant is what makes this safe to point
 * at a payload nobody has validated: whatever the pattern fails to understand
 * still reaches the screen, unchanged.
 */
export function tokenizeJson(source: string): Token[] {
	const tokens: Token[] = [];
	let last = 0;

	for (const m of source.matchAll(PATTERN)) {
		const at = m.index ?? 0;
		if (at > last) tokens.push({ text: source.slice(last, at), kind: 'punct' });

		if (m[1] !== undefined) tokens.push({ text: m[1], kind: 'key' });
		else if (m[2] !== undefined) tokens.push({ text: m[2], kind: 'string' });
		else if (m[3] !== undefined) tokens.push({ text: m[3], kind: 'number' });
		else if (m[4] !== undefined) tokens.push({ text: m[4], kind: 'bool' });
		else tokens.push({ text: m[0], kind: 'null' });

		last = at + m[0].length;
	}

	if (last < source.length) tokens.push({ text: source.slice(last), kind: 'punct' });
	return tokens;
}

/**
 * Indent it if it parses; hand it back untouched if it does not.
 *
 * The inspector's job is to show what arrived, so a body that is not JSON is
 * displayed as the thing it actually is rather than replaced by an error. Two
 * spaces, because these panes are narrow and a deep tool result at four spaces
 * spends half its width on indentation.
 */
export function pretty(source: string): string {
	try {
		return JSON.stringify(JSON.parse(source), null, 2);
	} catch {
		return source;
	}
}
