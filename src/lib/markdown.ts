/**
 * Markdown, rendered twice.
 *
 * Digests are written in markdown, and they have to arrive in two places that
 * want opposite things: a web page that wants semantic tags and a stylesheet,
 * and an email that wants every rule inlined on the element, because Gmail
 * strips `<style>` from the body and several mobile clients strip it entirely.
 *
 * So this is one parser with a pluggable style map. `renderMarkdown(md)` gives
 * clean semantic HTML; `renderMarkdown(md, EMAIL_STYLES)` gives the same tree
 * with `style="…"` on every tag. Two renderers would drift, and the one that
 * drifted would be the email — the one nobody looks at until it is ugly in
 * someone's inbox.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * No nested lists, no tables, no footnotes, no HTML passthrough. A dependency
 * would bring all of it, plus a sanitiser to undo the last one. What a digest
 * actually contains is headings, paragraphs, links, emphasis, code and flat
 * lists, and that is what this handles. If a digest ever needs a table, this
 * grows a table — not a parser generator.
 *
 * HTML in the source is **escaped, never passed through**. The text being
 * rendered is written by a language model out of paper abstracts, so treating
 * it as trusted markup is the one mistake here that would actually matter.
 */

/** Inline styles per tag, for the email rendering. Empty for the web. */
export type StyleMap = Partial<Record<string, string>>;

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Only schemes that cannot execute.
 *
 * `javascript:` in a link is the one injection a markdown renderer hands out
 * for free, and an agent writing links out of paper metadata is exactly the
 * situation where nobody would notice. Anything else renders as literal text.
 */
export function safeHref(url: string): string | undefined {
	const trimmed = url.trim();
	if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
	if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
	return undefined;
}

/**
 * Figure sources, and only this app's own.
 *
 * `extract_figures` and `generate_image` both publish `/figures/<name>` and the
 * agent is told, in its instructions and in both tool descriptions, to embed
 * the result with `![caption](path)`. It does exactly that — and the renderer
 * had no image rule at all, so a run that pulled six real figures out of a
 * paper printed six lines of literal markdown into the conversation. The app
 * asked for something it could not display.
 *
 * **Only `/figures/`.** Not `https://`, deliberately, and this is the one rule
 * here worth arguing about. The text being rendered is written by a language
 * model out of paper abstracts, and an `<img>` is a request the reader's
 * browser makes without being asked: a remote source is a tracking pixel at
 * best and a channel for putting text into someone else's logs at worst.
 * Anything but our own store renders as literal markdown, which is ugly and
 * cannot hurt anyone — the same trade `safeHref` makes for `javascript:`.
 *
 * The path is matched rather than parsed, and the character class is what does
 * the work: no whitespace, no quotes, no angle brackets, and no `..`, so it
 * cannot climb out of the store or break out of the attribute it lands in.
 */
export function safeSrc(url: string): string | undefined {
	const trimmed = url.trim();
	if (!/^\/figures\/[^\s"'<>]+$/.test(trimmed)) return undefined;
	return trimmed.includes('..') ? undefined : trimmed;
}

function open(tag: string, styles: StyleMap, extra = ''): string {
	const style = styles[tag];
	return `<${tag}${style ? ` style="${style}"` : ''}${extra ? ` ${extra}` : ''}>`;
}

/**
 * A sentinel that cannot survive in the source text.
 *
 * NUL is stripped from the input before anything else runs, so a placeholder
 * built from it can never collide with something the author wrote — which is
 * the failure mode of the usual `%%TOKEN%%` approach.
 */
const HOLD = '\u0000';

/**
 * Inline markup, in the only order that works.
 *
 * Code spans are lifted out first and links second, each replaced by a
 * placeholder, because otherwise `**` inside a code span becomes bold and an
 * underscore inside a URL becomes italic — the two bugs every hand-rolled
 * renderer ships with. Escaping happens *after* extraction and *before*
 * emphasis, so the held HTML is never double-escaped and the visible text
 * always is.
 */
function inline(source: string, styles: StyleMap, images: boolean): string {
	const held: string[] = [];
	const hold = (html: string): string => `${HOLD}${held.push(html) - 1}${HOLD}`;

	// The control character is the point: `HOLD` is a NUL-delimited sentinel, so
	// any NUL arriving in the source could forge a placeholder and smuggle raw
	// HTML past the escaper. Stripping it first is what makes the sentinel safe.
	// eslint-disable-next-line no-control-regex
	let text = source.replace(/\u0000/g, '');

	// 1. Code spans — contents are literal, full stop.
	text = text.replace(/`([^`]+)`/g, (_, code: string) =>
		hold(`${open('code', styles)}${escapeHtml(code)}</code>`)
	);

	// 2. Images, before links — `![alt](src)` contains `[alt](src)`, so a link
	//    rule running first would eat the inside and leave a stray `!`.
	text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole: string, alt: string, url: string) => {
		const src = safeSrc(url);
		if (!src) {
			/*
			 * Held as literal text, not returned for later rules to pick over.
			 *
			 * `![alt](url)` contains `[alt](url)`, so simply declining leaves the
			 * link rule to claim the inside — a refused remote image came out as a
			 * stray `!` followed by a working link to the same address. Refusing
			 * an image and then rendering a link to it is not a refusal, it is a
			 * detour, and the scruffy `!` was the tell.
			 */
			return hold(escapeHtml(whole));
		}
		if (!images) {
			// An email cannot serve a relative path, so the alternative there is
			// the caption rather than a broken picture. Said plainly rather than
			// left as a silent difference between the two renderings.
			return hold(escapeHtml(alt));
		}
		return hold(
			open(
				'img',
				styles,
				`src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"`
			)
		);
	});

	// 3. Explicit links. The label is still inline markup; the href is not.
	text = text.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole: string, label: string, url: string) => {
		const href = safeHref(url);
		if (!href) return whole;
		return hold(
			`${open('a', styles, `href="${escapeHtml(href)}"`)}${inline(label, styles, images)}</a>`
		);
	});

	// 4. Bare URLs, which is how a bibliography actually writes them. The
	//    trailing class excludes sentence punctuation so "see https://x.org."
	//    does not put the full stop inside the link.
	text = text.replace(
		/(^|[\s(])(https?:\/\/[^\s<>)]*[^\s<>).,;:])/g,
		(_, lead: string, url: string) =>
			`${lead}${hold(`${open('a', styles, `href="${escapeHtml(url)}"`)}${escapeHtml(url)}</a>`)}`
	);

	text = escapeHtml(text);

	// 5. Emphasis. Bold before italic, or `**x**` leaves stray asterisks.
	text = text.replace(
		/\*\*([^*]+)\*\*/g,
		(_, s: string) => `${open('strong', styles)}${s}</strong>`
	);
	text = text.replace(
		/(^|[^*\w])\*([^*\n]+)\*/g,
		(_, lead: string, s: string) => `${lead}${open('em', styles)}${s}</em>`
	);
	text = text.replace(
		/(^|[^_\w])_([^_\n]+)_/g,
		(_, lead: string, s: string) => `${lead}${open('em', styles)}${s}</em>`
	);

	return text.replace(
		new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'),
		(_, i: string) => held[Number(i)] ?? ''
	);
}

interface Block {
	kind: 'heading' | 'para' | 'ul' | 'ol' | 'quote' | 'code' | 'hr';
	level?: number;
	lines: string[];
	lang?: string;
}

/** Lines → blocks. Kept separate from rendering so both stay legible. */
function blocksOf(markdown: string): Block[] {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const blocks: Block[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) {
			i++;
			continue;
		}

		// Fenced code. Consumed wholesale, including blank lines, and never parsed.
		const fence = line.match(/^\s*```+\s*(\S*)/);
		if (fence) {
			const body: string[] = [];
			i++;
			while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) body.push(lines[i++]);
			i++; // the closing fence, or the end of the document
			blocks.push({ kind: 'code', lines: body, lang: fence[1] || undefined });
			continue;
		}

		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			blocks.push({ kind: 'heading', level: heading[1].length, lines: [heading[2].trim()] });
			i++;
			continue;
		}

		if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
			blocks.push({ kind: 'hr', lines: [] });
			i++;
			continue;
		}

		if (/^\s*>/.test(line)) {
			const body: string[] = [];
			while (i < lines.length && /^\s*>/.test(lines[i])) {
				body.push(lines[i].replace(/^\s*>\s?/, ''));
				i++;
			}
			blocks.push({ kind: 'quote', lines: body });
			continue;
		}

		if (/^\s*[-*+]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
				i++;
			}
			blocks.push({ kind: 'ul', lines: items });
			continue;
		}

		if (/^\s*\d+[.)]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
				i++;
			}
			blocks.push({ kind: 'ol', lines: items });
			continue;
		}

		// A paragraph runs until a blank line or the start of another block.
		//
		// The first line is consumed unconditionally, before the loop. Everything
		// above has already excluded every block opener, so the guard below can
		// only ever be redundant — but if the two lists of patterns ever drift
		// apart, the redundant version stalls and this one does not. An infinite
		// loop inside a request handler is not a bug worth leaving to a coincidence.
		const body: string[] = [lines[i++].trim()];
		while (
			i < lines.length &&
			lines[i].trim() &&
			!/^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*>|\s*```)/.test(lines[i]) &&
			!/^\s*(?:[-*_]\s*){3,}$/.test(lines[i])
		) {
			body.push(lines[i].trim());
			i++;
		}
		blocks.push({ kind: 'para', lines: body });
	}

	return blocks;
}

export function renderMarkdown(
	markdown: string,
	styles: StyleMap = {},
	{
		/**
		 * Render `![alt](/figures/…)` as a picture.
		 *
		 * True for the web, where the store is one origin away. False for the
		 * email, where a relative source cannot resolve — there the caption is
		 * rendered instead, which is a smaller thing than a broken image icon and
		 * an honest one. Making figures appear in a digest needs an absolute
		 * origin, which this app has no configuration for; when it does, this
		 * becomes a base URL rather than a boolean.
		 */
		images = true
	}: { images?: boolean } = {}
): string {
	const html: string[] = [];

	for (const block of blocksOf(markdown)) {
		switch (block.kind) {
			case 'heading': {
				const tag = `h${block.level}`;
				html.push(`${open(tag, styles)}${inline(block.lines[0], styles, images)}</${tag}>`);
				break;
			}
			case 'para':
				html.push(`${open('p', styles)}${inline(block.lines.join(' '), styles, images)}</p>`);
				break;
			case 'ul':
			case 'ol': {
				const tag = block.kind;
				const items = block.lines
					.map((item) => `${open('li', styles)}${inline(item, styles, images)}</li>`)
					.join('');
				html.push(`${open(tag, styles)}${items}</${tag}>`);
				break;
			}
			case 'quote':
				html.push(
					`${open('blockquote', styles)}${open('p', styles)}` +
						`${inline(block.lines.join(' '), styles, images)}</p></blockquote>`
				);
				break;
			case 'code':
				html.push(
					`${open('pre', styles)}${open('code', styles)}` +
						`${escapeHtml(block.lines.join('\n'))}</code></pre>`
				);
				break;
			case 'hr':
				html.push(open('hr', styles).replace(/>$/, ' />'));
				break;
		}
	}

	return html.join('\n');
}

/**
 * The same document with the markup taken off, for the `text/plain` part.
 *
 * Not an afterthought: a mail client showing the plain part is showing it to
 * someone who chose plain text, and `**bold**` littered through it reads as a
 * bug. Links keep their target in parentheses, because a reader who cannot
 * click still needs the URL.
 */
export function toPlainText(markdown: string): string {
	const strip = (s: string): string =>
		s
			.replace(/`([^`]+)`/g, '$1')
			.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, '$1 ($2)')
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2')
			.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1$2');

	const out: string[] = [];

	for (const block of blocksOf(markdown)) {
		switch (block.kind) {
			case 'heading':
				out.push(strip(block.lines[0]).toUpperCase(), '');
				break;
			case 'para':
				out.push(strip(block.lines.join(' ')), '');
				break;
			case 'ul':
				out.push(...block.lines.map((l) => `  • ${strip(l)}`), '');
				break;
			case 'ol':
				out.push(...block.lines.map((l, n) => `  ${n + 1}. ${strip(l)}`), '');
				break;
			case 'quote':
				out.push(...block.lines.map((l) => `  | ${strip(l)}`), '');
				break;
			case 'code':
				out.push(...block.lines.map((l) => `    ${l}`), '');
				break;
			case 'hr':
				out.push('—'.repeat(40), '');
				break;
		}
	}

	return out
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
