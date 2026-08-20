import { htmlToText } from './paper';

/**
 * The figures a paper actually printed.
 *
 * An illustration Colophon generates is decoration: it says what the writer
 * understood. A figure lifted out of the paper is *evidence* — it is the thing
 * the authors chose to show, with the caption they chose to show it under. A
 * review that reproduces the real Figure 3 reads like a paper; one that
 * commissions a drawing of Figure 3 reads like an essay about a paper.
 *
 * ── Why HTML only ───────────────────────────────────────────────────────────
 * arXiv's LaTeXML edition (`arxiv.org/html/<id>`) carries the publisher's own
 * image files and the paper's own `<figcaption>`. Nothing beats it, and it
 * exists for roughly 2024-onward submissions — which is what this app searches.
 *
 * Cutting figures out of a rendered PDF page is deliberately OUT OF SCOPE. It
 * needs a PDF renderer, a caption-locator and a cropper in the serverless
 * function, and it returns page crops rather than original assets. A pre-2024
 * paper gets an honest "no HTML edition" here rather than a worse picture
 * dressed up as the same thing.
 *
 * ── Why regex and not a DOM ─────────────────────────────────────────────────
 * Same reason as `paper.ts`: this runs in a Vercel function, Node has no
 * `DOMParser`, and LaTeXML output is machine-generated and regular. This is not
 * general-purpose HTML handling and does not pretend to be.
 */

export interface ExtractedFigure {
	/**
	 * The paper's own label where its caption gives one (`fig3`), else the
	 * position. For prose that says "as Figure 3 shows" — not a key; `index` is.
	 */
	id: string;
	/** The paper's caption, markup flattened. Empty when the figure has none. */
	caption: string;
	/** Absolute URL of the image file on arxiv.org. */
	url: string;
	/** 1-based position in the document. Unique, which is why the store keys on it. */
	index: number;
}

/** The LaTeXML page a paper's figures live on. */
export function figurePageUrl(arxivId: string): string {
	return `https://arxiv.org/html/${normaliseId(arxivId)}`;
}

/** An arXiv id as it appears in a URL: no `arxiv:` prefix, no version suffix. */
export function normaliseId(arxivId: string): string {
	return arxivId
		.trim()
		.replace(/^arxiv:/i, '')
		.replace(/v\d+$/, '');
}

/**
 * An arXiv id that is safe as one path segment.
 *
 * Legacy ids carry a slash (`hep-th/9711200`) and would otherwise invent a
 * directory in the blob store. Dots survive — `2401.12345-fig1.png` is a
 * filename a person can read back to a paper.
 */
export function figureSlug(arxivId: string): string {
	return normaliseId(arxivId).replace(/\//g, '-');
}

/**
 * Resolve a figure `src` against the page it appeared on.
 *
 * arXiv's pages come in two shapes and only one of them survives plain browser
 * semantics, which is why a naive `new URL(src, pageUrl)` extracts nothing at
 * all for a whole class of papers:
 *
 *   src `2401.12345v1/x1.png` on page `/html/2401.12345v1` — the src repeats
 *       the versioned directory. Browser semantics (drop the last segment,
 *       then resolve) is exactly right.
 *   src `x1.png` on page `/html/2401.12345` — relative to the paper's own
 *       directory. Browser semantics drops `2401.12345` as though it were a
 *       filename and asks for `/html/x1.png`, which is a 404.
 *
 * So the page's last segment is a directory *unless the src already names it*.
 * The comparison ignores the version suffix, because the mismatched version is
 * precisely the case the two shapes differ on.
 */
export function resolveFigureUrl(src: string, pageUrl: string): string {
	const trimmed = src.trim();
	// Absolute, protocol-relative and inline sources are already resolved.
	if (/^(https?:)?\/\//i.test(trimmed)) return trimmed.replace(/^\/\//, 'https://');
	if (/^data:/i.test(trimmed)) return trimmed;

	const page = new URL(pageUrl);
	const bare = (segment: string) => segment.replace(/v\d+$/, '');
	const last = page.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
	const first = trimmed.replace(/^\.?\//, '').split('/')[0];
	const dir =
		bare(first) === bare(last)
			? page.pathname.replace(/[^/]*$/, '') // the src carries the directory
			: page.pathname.replace(/\/*$/, '/'); // the page *is* the directory
	return new URL(trimmed, new URL(dir, page.origin)).href;
}

/** One `<figure>` element, and the chain it hangs from. */
interface FigureNode {
	/** Offset of the opening tag, so document order can be restored. */
	at: number;
	/** Identity within this page, used only to find a panel's parent. */
	id: number;
	/** The enclosing `<figure>`, where there is one. */
	parent: number | null;
	/** This element's contents, minus every nested `<figure>` — what is *its own*. */
	own: string;
}

const FIGURE_TAG = /<figure\b[^>]*>|<\/figure\s*>/gi;

/**
 * Walk the page's `<figure>` elements, keeping track of nesting.
 *
 * A non-greedy `<figure>([\s\S]*?)</figure>` cannot do this: multi-panel
 * figures nest, so it pairs an outer opening tag with an inner closing one and
 * everything after the first panel falls out of alignment. LaTeXML emits panels
 * constantly — any paper with an (a)/(b)/(c) figure has them — so this is the
 * common case, not an edge one.
 */
function figureNodes(html: string): FigureNode[] {
	const nodes: FigureNode[] = [];
	// `tagStart` is where the opening tag begins and `start` where its contents
	// do. Both are needed: a child is cut out of its parent by the span of the
	// whole element, tags included.
	const open: {
		id: number;
		tagStart: number;
		start: number;
		children: [number, number][];
	}[] = [];
	let seq = 0;

	FIGURE_TAG.lastIndex = 0;
	for (let m = FIGURE_TAG.exec(html); m; m = FIGURE_TAG.exec(html)) {
		if (m[0][1] !== '/') {
			open.push({ id: seq++, tagStart: m.index, start: m.index + m[0].length, children: [] });
			continue;
		}
		const node = open.pop();
		// A stray `</figure>` with nothing open: malformed, and skipping it keeps
		// the rest of the page readable rather than throwing the lot away.
		if (!node) continue;

		let own = '';
		let cursor = node.start;
		for (const [from, to] of node.children) {
			own += html.slice(cursor, from);
			cursor = to;
		}
		own += html.slice(cursor, m.index);

		// A child is recorded on its parent as it closes, so the spans arrive
		// already in ascending order and the cut above needs no sort.
		const parent = open.at(-1);
		parent?.children.push([node.tagStart, m.index + m[0].length]);
		nodes.push({ at: node.tagStart, id: node.id, parent: parent?.id ?? null, own });
	}
	// Nodes are emitted as they close, which is innermost-first. A reader expects
	// "Figure 1, Figure 2" in the order the paper prints them, so sort back.
	return nodes.sort((a, b) => a.at - b.at);
}

const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i;
const FIGCAPTION = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption\s*>/i;
const LABEL = /^\s*(?:figure|fig\.?)\s*([0-9]+[a-z]?)/i;

/** A caption as prose: markup flattened, entities decoded, one line. */
function cleanCaption(fragment: string): string {
	return htmlToText(fragment).replace(/\s+/g, ' ').trim();
}

/** This element's own `<figcaption>`, if it has one. */
function ownCaption(node: FigureNode): string {
	return cleanCaption(FIGCAPTION.exec(node.own)?.[1] ?? '');
}

/**
 * The caption of the nearest enclosing figure.
 *
 * Plenty of panels carry no caption at all, and the sentence a reader needs is
 * then the parent figure's — which LaTeXML prints *after* the panels rather
 * than around them, so it cannot be picked up on the way down.
 */
function inheritedCaption(node: FigureNode, byId: Map<number, FigureNode>): string {
	for (let at = byId.get(node.parent ?? -1); at; at = byId.get(at.parent ?? -1)) {
		const found = ownCaption(at);
		if (found) return found;
	}
	return '';
}

/**
 * Every figure on an arXiv HTML page, in document order.
 *
 * One entry per `<figure>` that *directly* holds an `<img>`. That rule is what
 * keeps a multi-panel figure from being counted twice: the outer element holds
 * only the panels, so it contributes no image of its own, and each panel
 * contributes exactly one.
 *
 * `pageUrl` is the URL the HTML was actually served from — pass the response's
 * `url`, not the request's, so a redirect to the versioned page still resolves.
 */
export function extractFigures(html: string, pageUrl: string): ExtractedFigure[] {
	const nodes = figureNodes(html);
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const figures: ExtractedFigure[] = [];
	const seen = new Set<string>();

	for (const node of nodes) {
		const src = IMG_SRC.exec(node.own);
		if (!src) continue;
		const value = (src[2] ?? src[3] ?? src[4] ?? '').trim();
		if (!value) continue;

		const url = resolveFigureUrl(value, pageUrl);
		// LaTeXML repeats an image when a figure is reproduced twice; the same
		// picture under two numbers is noise in a review.
		if (seen.has(url)) continue;
		seen.add(url);

		const own = ownCaption(node);
		const index = figures.length + 1;
		figures.push({
			// The number comes from the figure's *own* caption only. A panel that
			// borrows its parent's sentence has not borrowed its parent's number —
			// letting it would give two entries the same id.
			id: `fig${LABEL.exec(own)?.[1]?.toLowerCase() ?? index}`,
			caption: own || inheritedCaption(node, byId),
			url,
			index
		});
	}
	return figures;
}

const CITATION_TITLE = /<meta[^>]*name=["']citation_title["'][^>]*content=["']([^"']+)["']/i;
const DOC_TITLE = /<h1[^>]*class="[^"]*ltx_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i;

/**
 * The paper's title, off the same page.
 *
 * Without it a run that extracts figures and never calls `fetch_paper`
 * registers a source with no title, and the bibliography prints an entry that
 * names nothing. The Highwire tag is arXiv's own statement of its metadata, so
 * it is tried before any markup archaeology.
 */
export function extractPaperTitle(html: string): string {
	const meta = CITATION_TITLE.exec(html)?.[1];
	if (meta) return cleanCaption(meta);
	const heading = DOC_TITLE.exec(html)?.[1];
	return heading ? cleanCaption(heading) : '';
}
