/**
 * Reading a paper, not just finding one.
 *
 * arXiv publishes two editions and they are not equal. The **HTML edition**
 * (`arxiv.org/html/<id>`) is LaTeXML output: real sections, real headings, real
 * maths, in reading order. The **PDF** is a picture of a page — two columns
 * interleaved, hyphens mid-word, figure captions dropped into the middle of a
 * sentence — and reconstructing prose from it is lossy work.
 *
 * So: HTML first, always. The PDF is the fallback for papers older than the
 * LaTeXML pipeline (roughly pre-2024) or where the author's TeX did not
 * compile, and a fallback is what it should stay.
 *
 * What lands in Postgres is metadata. The full text goes to blob storage — one
 * paper is 50–200 KB and Neon's free tier is 0.5 GB, so a few thousand papers
 * would fill it. See `src/lib/server/storage.ts`.
 */

export type Edition = 'html' | 'pdf' | 'abstract';

export interface PaperText {
	arxivId: string;
	title: string;
	/** Which edition this came from. `abstract` means the full text was unavailable. */
	edition: Edition;
	/** Section headings in document order — the shape of the argument. */
	sections: string[];
	text: string;
	chars: number;
}

const HTML_EDITION = (id: string) => `https://arxiv.org/html/${id}`;

/** Tags whose *contents* are not prose and must not be flattened into it. */
const DROP_CONTENT = /<(script|style|noscript|svg|math)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * LaTeXML wraps the paper itself in `<article class="ltx_document">`. Everything
 * outside it is arXiv's own furniture — the nav bar, the licence footer, and a
 * "Report GitHub Issue" modal whose form labels otherwise land at the very top
 * of the extracted text:
 *
 *   "Report GitHub Issue × Title: Content selection saved. … Submit"
 *
 * Found by reading the first 180 characters of a real fetch. Left in, every
 * paper begins with a bug-report form, and the model pays tokens to read it on
 * every single turn that carries the paper.
 */
export function articleOnly(html: string): string {
	const opened = html.search(/<article\b[^>]*class="[^"]*ltx_document/i);
	if (opened === -1) return html;
	const closed = html.lastIndexOf('</article>');
	return closed > opened ? html.slice(opened, closed) : html.slice(opened);
}

/**
 * Strip HTML to readable text.
 *
 * A regex rather than a DOM parser because Node has no `DOMParser` and pulling
 * in a full parser to read academic prose is disproportionate. This is not
 * general-purpose HTML handling — it targets LaTeXML's output, which is
 * regular, well-formed and machine-generated.
 *
 * Block-level tags become newlines before tags are removed, or every heading
 * would weld itself onto the paragraph beneath it.
 */
export function htmlToText(html: string): string {
	return (
		html
			.replace(DROP_CONTENT, ' ')
			.replace(/<!--[\s\S]*?-->/g, ' ')
			.replace(/<\/(p|div|section|h[1-6]|li|tr|blockquote|figcaption)>/gi, '\n')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&amp;/g, '&')
			// Collapse runs of spaces but keep paragraph breaks: the section structure
			// is the most useful thing about the HTML edition.
			.replace(/[ \t]+/g, ' ')
			.replace(/\n{3,}/g, '\n\n')
			.split('\n')
			.map((line) => line.trim())
			.join('\n')
			.trim()
	);
}

/** Headings, in document order. */
export function extractSections(html: string): string[] {
	return (
		[...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
			.map((m) => htmlToText(m[1]).replace(/\s+/g, ' ').trim())
			// LaTeXML numbers headings; keep the number, it is how papers are cited.
			.filter((heading) => heading.length > 0 && heading.length < 200)
	);
}

export class PaperUnavailable extends Error {
	constructor(
		readonly arxivId: string,
		reason: string
	) {
		super(`Could not read arXiv:${arxivId} — ${reason}`);
		this.name = 'PaperUnavailable';
	}
}

/**
 * Fetch a paper's full text.
 *
 * Returns the abstract edition rather than throwing when the full text cannot
 * be had: a review that says "only the abstract was available for this one" is
 * honest and useful, where a failed run is neither. The `edition` field is what
 * lets the caller — and the source registry's `read` depth — tell the
 * difference.
 */
export async function fetchPaper(
	arxivId: string,
	{
		fetchImpl = fetch,
		fallbackAbstract
	}: { fetchImpl?: typeof fetch; fallbackAbstract?: string } = {}
): Promise<PaperText> {
	const id = arxivId
		.replace(/^arxiv:/i, '')
		.replace(/v\d+$/, '')
		.trim();

	let response: Response | undefined;
	try {
		response = await fetchImpl(HTML_EDITION(id));
	} catch {
		response = undefined;
	}

	if (response?.ok) {
		// Strip arXiv's own furniture before anything else looks at the page.
		const html = articleOnly(await response.text());
		const sections = extractSections(html);
		const text = htmlToText(html);

		// A LaTeXML stub — the page exists but carries no article — is common for
		// papers whose TeX failed to convert. Treat it as absent, not as a paper
		// with nothing in it.
		if (text.length > 2000) {
			return {
				arxivId: id,
				title: sections[0] ?? id,
				edition: 'html',
				sections,
				text,
				chars: text.length
			};
		}
	}

	if (fallbackAbstract?.trim()) {
		return {
			arxivId: id,
			title: id,
			edition: 'abstract',
			sections: [],
			text: fallbackAbstract.trim(),
			chars: fallbackAbstract.trim().length
		};
	}

	throw new PaperUnavailable(
		id,
		'no HTML edition (common before 2024) and no abstract was supplied to fall back on.'
	);
}
