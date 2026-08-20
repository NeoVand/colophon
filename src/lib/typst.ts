/**
 * Typst, read without being compiled.
 *
 * ── This module deliberately does not compile anything ──────────────────────
 * Typst's compiler is Rust. Running it here means one of two real commitments:
 * a wasm build — roughly three megabytes, plus a virtual filesystem to satisfy
 * `#import`, plus fonts, plus the package registry it expects — or a binary on
 * the server and a job queue to call it. Both are decisions with a cost and an
 * ongoing maintenance surface, and neither belongs inside a viewer that was
 * asked to show you a document.
 *
 * What you actually need before making that decision is smaller and is text
 * processing: an outline you can navigate, and confirmation that your brackets
 * close. That is what this is. When a toolchain does arrive it goes *beside*
 * this module — `typst-compile.ts`, wasm and all — and this one keeps working
 * for the ninety-nine percent of the time you are reading rather than typesetting.
 *
 * ── How it avoids lying ─────────────────────────────────────────────────────
 * Everything here runs over a *masked* copy of the source: comments, strings
 * and raw blocks replaced by spaces, one space per character, newlines kept.
 * Positions therefore still line up with the original, and a brace inside a
 * code sample or a heading inside a comment cannot fool either the outline or
 * the bracket check. That single trick is why this is worth having rather than
 * a regex that is wrong on any interesting file.
 */

/** 1-based, both of them, so a message can be pasted at a human. */
export interface TypstProblem {
	message: string;
	line: number;
	column: number;
}

export interface TypstHeading {
	/** 1 for `=`, 2 for `==`, and so on. */
	level: number;
	text: string;
	line: number;
	/**
	 * A key for `{#each}`.
	 *
	 * Derived from the line number, not from the text, and that is the whole
	 * reason it exists. Two sections called "Results" are ordinary in a paper;
	 * two identical keys throw, and a Svelte keyed-each throw *aborts the
	 * render* — leaving the previous document on screen. The line is unique by
	 * construction: markup headings start a line, so no line holds two.
	 */
	key: string;
}

export interface TypstReading {
	title?: string;
	headings: TypstHeading[];
	/** The first thing wrong, or null. Later errors are usually its consequences. */
	problem: TypstProblem | null;
}

const MATCHING: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function positionOf(source: string, index: number): { line: number; column: number } {
	let line = 1;
	let lastBreak = -1;
	for (let i = 0; i < index && i < source.length; i++) {
		if (source[i] === '\n') {
			line++;
			lastBreak = i;
		}
	}
	return { line, column: index - lastBreak };
}

function problemAt(source: string, index: number, message: (line: number) => string): TypstProblem {
	const { line, column } = positionOf(source, index);
	return { message: message(line), line, column };
}

interface Masked {
	text: string;
	/** A literal that runs to the end of the file. Reported before brackets are. */
	unterminated: TypstProblem | null;
}

/**
 * The source with every literal region blanked out, character for character.
 *
 * Blanking rather than deleting is what keeps every index in the result usable
 * against the original string, which is how an error can name a line and a
 * column that mean something. Newlines survive blanking for the same reason.
 *
 * An unterminated string or comment is reported here rather than left to the
 * bracket scan, because once a literal runs away the bracket answer is
 * meaningless — every brace after it is either swallowed or counted twice, and
 * "unbalanced `{` on line 400" is a useless thing to say to someone who forgot
 * a quote on line 12.
 */
function mask(source: string): Masked {
	const out = source.split('');
	let unterminated: TypstProblem | null = null;

	const blank = (from: number, to: number) => {
		for (let j = Math.max(0, from); j < Math.min(to, out.length); j++) {
			if (out[j] !== '\n') out[j] = ' ';
		}
	};

	let i = 0;
	while (i < source.length) {
		const c = source[i];

		// A backslash escapes whatever follows it, including a line break. Handled
		// first so that `\"` in markup cannot be mistaken for the start of a string.
		if (c === '\\' && i + 1 < source.length) {
			blank(i, i + 2);
			i += 2;
			continue;
		}

		if (c === '/' && source[i + 1] === '/') {
			const nl = source.indexOf('\n', i);
			const stop = nl === -1 ? source.length : nl;
			blank(i, stop);
			i = stop;
			continue;
		}

		// Typst block comments nest, so this counts depth rather than searching
		// for the first `*/` — which would end an outer comment early and hand
		// the rest of the file back to the bracket scanner as live code.
		if (c === '/' && source[i + 1] === '*') {
			const start = i;
			let depth = 0;
			let j = i;
			while (j < source.length) {
				if (source[j] === '/' && source[j + 1] === '*') {
					depth++;
					j += 2;
				} else if (source[j] === '*' && source[j + 1] === '/') {
					depth--;
					j += 2;
					if (depth === 0) break;
				} else {
					j++;
				}
			}
			if (depth !== 0) {
				unterminated ??= problemAt(
					source,
					start,
					(line) =>
						`A block comment opened on line ${line} is never closed — everything after it is being read as a comment.`
				);
			}
			blank(start, j);
			i = j;
			continue;
		}

		// Raw text. The contents are literal by definition, which is exactly where
		// a code sample full of unbalanced braces lives.
		if (c === '`') {
			const fence = source.startsWith('```', i) ? '```' : '`';
			const end = source.indexOf(fence, i + fence.length);
			if (end === -1) {
				unterminated ??= problemAt(
					source,
					i,
					(line) => `A raw block opened on line ${line} with \`${fence}\` is never closed.`
				);
				blank(i, source.length);
				i = source.length;
				continue;
			}
			blank(i, end + fence.length);
			i = end + fence.length;
			continue;
		}

		if (c === '"') {
			let j = i + 1;
			let closed = false;
			while (j < source.length) {
				if (source[j] === '\\') {
					j += 2;
					continue;
				}
				if (source[j] === '"') {
					j++;
					closed = true;
					break;
				}
				// A newline ends the search. Letting a runaway string eat the rest of
				// the file turns one missing quote into an error message about line
				// four hundred, which is the opposite of useful.
				if (source[j] === '\n') break;
				j++;
			}
			if (!closed) {
				unterminated ??= problemAt(
					source,
					i,
					(line) => `A string opened on line ${line} is never closed.`
				);
			}
			blank(i, j);
			i = j;
			continue;
		}

		i++;
	}

	return { text: out.join(''), unterminated };
}

/**
 * Balanced `()`, `[]` and `{}` — or the first place they stop being balanced.
 *
 * Three failures, three different messages, because they are three different
 * mistakes and the fix differs: a closer with nothing open is usually a stray
 * paste, a closer of the wrong shape is usually a `[` where a `(` was meant,
 * and an opener with no closer is usually the one you are still typing.
 *
 * The unclosed opener reported is the *innermost* one. It is the one nearest
 * where the writing stopped, and closing it is what reveals whether anything
 * outside it was genuinely unbalanced or merely looked that way.
 */
function delimitersIn(source: string, masked: Masked): TypstProblem | null {
	if (masked.unterminated) return masked.unterminated;

	const text = masked.text;
	const open: { char: string; index: number }[] = [];

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '(' || c === '[' || c === '{') {
			open.push({ char: c, index: i });
			continue;
		}
		if (c !== ')' && c !== ']' && c !== '}') continue;

		const top = open.pop();
		if (!top) {
			return problemAt(
				source,
				i,
				(line) => `Line ${line} has a \`${c}\` that closes nothing — no bracket is open here.`
			);
		}
		if (MATCHING[top.char] !== c) {
			const opened = positionOf(source, top.index);
			return problemAt(
				source,
				i,
				(line) =>
					`Line ${line} closes with \`${c}\`, but the innermost open bracket is the \`${top.char}\` from line ${opened.line}. That one wants \`${MATCHING[top.char]}\`.`
			);
		}
	}

	if (open.length) {
		const last = open[open.length - 1];
		return problemAt(
			source,
			last.index,
			(line) => `\`${last.char}\` opened on line ${line} is never closed.`
		);
	}

	return null;
}

/** Balanced brackets, or the first problem — named by line and column. */
export function checkDelimiters(source: string): TypstProblem | null {
	return delimitersIn(source, mask(source));
}

/**
 * A trailing `<label>` is a cross-reference target, not part of the heading.
 *
 * It belongs in the source and does not belong in a rail down the side of the
 * screen, where it is width spent on something nobody is reading.
 */
function displayHeading(text: string): string {
	return text.replace(/\s*<[A-Za-z0-9_:.-]+>\s*$/, '').trim();
}

function headingsIn(source: string, masked: Masked): TypstHeading[] {
	const lines = source.split('\n');
	const maskedLines = masked.text.split('\n');
	const headings: TypstHeading[] = [];

	for (let i = 0; i < lines.length; i++) {
		// Matched against the masked line so `=` inside a comment or a code sample
		// is not a section; the *text* comes from the original, so a heading
		// containing a raw span keeps it.
		const marker = /^(=+)[ \t]/.exec(maskedLines[i]);
		if (!marker) continue;
		const text = displayHeading(lines[i].slice(marker[1].length));
		if (!text) continue;
		headings.push({ level: marker[1].length, text, line: i + 1, key: `h${i + 1}` });
	}

	return headings;
}

/** The document's sections, in source order. Markup headings only. */
export function outline(source: string): TypstHeading[] {
	return headingsIn(source, mask(source));
}

/**
 * The title the author set explicitly, if they set one.
 *
 * One regex for the call and one for the field, rather than one for both: the
 * arguments to `#set document` can be in any order and can include `author`
 * and `date`, and a single pattern trying to cover that is a pattern nobody
 * can read six months later.
 */
function declaredTitle(source: string): string | undefined {
	const call = /#set\s+document\s*\(([^)]*)\)/.exec(source);
	if (!call) return undefined;
	const field = /title\s*:\s*"((?:\\.|[^"\\])*)"/.exec(call[1]);
	if (!field) return undefined;
	// `\"` and `\\` are the escapes that actually appear in a title.
	return field[1].replace(/\\(.)/g, '$1').trim() || undefined;
}

/**
 * What the document calls itself.
 *
 * `#set document(title: …)` wins, because it is the author saying so
 * explicitly — it is what a PDF's metadata will carry. Failing that, the first
 * top-level heading, which is what a reader would say the title is. Failing
 * both, nothing: inventing one from a filename is how a draft ends up
 * published as "untitled-3".
 *
 * Read from the raw source rather than the masked copy, since the title lives
 * inside the one kind of region masking exists to erase.
 */
export function titleOf(source: string): string | undefined {
	return declaredTitle(source) ?? outline(source).find((h) => h.level === 1)?.text;
}

/**
 * Everything a viewer wants, over one masking pass.
 *
 * The three functions above are the useful units and stay exported; this is
 * what a component should call, so that opening a document does not walk it
 * three times to answer three questions about the same characters.
 */
export function inspectTypst(source: string): TypstReading {
	const masked = mask(source);
	const headings = headingsIn(source, masked);
	return {
		title: declaredTitle(source) ?? headings.find((h) => h.level === 1)?.text,
		headings,
		problem: delimitersIn(source, masked)
	};
}
