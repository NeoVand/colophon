/**
 * The library, reconstructed from the outside.
 *
 * The X-ray's founding rule is that nothing is passed *into* the agent to make
 * it work: what the panels show is read off what the run already publishes. For
 * the library that means folding tool results back into a picture of what has
 * been retrieved — which is a real inference, not a copy, because each tool
 * returns a different shape and none of them returns "the library".
 *
 * It lives here, as a pure function over plain data, for the same reason
 * `project()` does in `events.ts`: it depends on the exact shape of three tool
 * results, and a dependency on someone else's shape is the kind that rots
 * silently. Out here it can be tested against those shapes; buried in a
 * component it could only be tested by looking at the screen — which is how it
 * shipped once keyed on `results` when the tool returns `papers`, showing an
 * empty library through a run that had retrieved eight papers.
 */

export interface KnownPaper {
	id: string;
	title: string;
	url?: string;
	authors?: string[];
	year?: number;
	citedBy?: number;
	/** `read` means the full text came back, not merely an abstract. */
	depth: 'listed' | 'read';
	/** Set when the `cite` tool returned for it. */
	cited: boolean;
	/** Characters of full text, when it was read. */
	chars?: number;
}

/** As much of a tool's paper-shaped payload as anything here relies on. */
interface Paperish {
	id?: string;
	arxivId?: string;
	title?: string;
	url?: string;
	authors?: string[];
	year?: number;
	citedBy?: number;
	chars?: number;
	depth?: string;
}

/** arXiv ids, old and new. Enough to build a link from an id alone. */
const ARXIV_ID = /^\d{4}\.\d{4,5}$|^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/;

function linkFor(p: Paperish, id: string): string | undefined {
	if (p.url) return p.url;
	if (p.arxivId) return `https://arxiv.org/abs/${p.arxivId}`;
	// Only when the id is unambiguously an arXiv id. Guessing a URL from an
	// arbitrary id would produce links that 404, which is worse than no link.
	return ARXIV_ID.test(id) ? `https://arxiv.org/abs/${id}` : undefined;
}

/**
 * Fold one tool result into the library, in place.
 *
 * Forgiving about shape and strict about identity: a row whose id cannot be
 * worked out is dropped rather than added under a second key, because a
 * duplicate here reads as "it retrieved this twice" — a claim about the run
 * that would not be true.
 *
 * Depth only ever increases, mirroring the server's registry. A paper met
 * again in a search has not become less known.
 */
export function absorb(library: KnownPaper[], toolName: string | undefined, result: unknown): void {
	if (!result || typeof result !== 'object') return;
	const r = result as Record<string, unknown>;
	const upsert = upserter(library);

	switch (toolName) {
		// `papers`, not `results` — see the note at the top of this file.
		case 'search_papers':
			if (Array.isArray(r.papers)) for (const row of r.papers as Paperish[]) upsert(row, 'listed');
			return;

		// Returns the paper itself, keyed by `arxivId`, with `chars` for the
		// full length even when the excerpt was truncated. `edition: 'abstract'`
		// means the HTML was unavailable and no full text actually arrived, so
		// it does not count as read.
		case 'fetch_paper':
			upsert(r as Paperish, r.edition === 'abstract' ? 'listed' : 'read');
			return;

		// Carries its own depth, which is authoritative — it came from the
		// registry rather than being inferred here.
		case 'cite':
			upsert(r as Paperish, r.depth === 'read' ? 'read' : 'listed', true);
			return;
	}
}

/**
 * Fold the deep-research pipeline's papers into the same library.
 *
 * The chat agent's papers arrive as tool results; the pipeline's arrive on its
 * step outputs, because its retrieval happens inside a step rather than as a
 * call the model made. Two doors, one room — and deliberately the same `upsert`
 * behind both, so "depth only ever increases" and "a paper met twice is one
 * paper" hold however the paper got here.
 *
 * Before this the library panel said "Nothing retrieved yet" for the whole of a
 * research run that had read three papers.
 */
export function absorbPapers(
	library: KnownPaper[],
	papers: readonly {
		id: string;
		title?: string;
		year?: number;
		depth: 'listed' | 'read';
		cited?: boolean;
	}[]
): void {
	const upsert = upserter(library);
	for (const paper of papers) {
		upsert({ id: paper.id, title: paper.title, year: paper.year }, paper.depth, paper.cited);
	}
}

/** The one place a paper enters the library, whichever door it came through. */
function upserter(library: KnownPaper[]) {
	return (p: Paperish, depth: 'listed' | 'read', cited = false) => {
		const id = p.arxivId ?? p.id ?? p.url;
		if (!id) return;

		const existing = library.find((k) => k.id === id);
		if (existing) {
			if (depth === 'read') existing.depth = 'read';
			if (cited) existing.cited = true;
			if (p.chars) existing.chars = p.chars;
			if (p.year && !existing.year) existing.year = p.year;
			if (p.authors?.length && !existing.authors?.length) existing.authors = p.authors;
			existing.url ??= linkFor(p, id);
			// A later result may carry a real title where the first had only an id.
			if (p.title && (existing.title === existing.id || !existing.title)) existing.title = p.title;
			return;
		}

		library.push({
			id,
			title: p.title ?? id,
			url: linkFor(p, id),
			authors: p.authors,
			year: p.year,
			citedBy: p.citedBy,
			depth,
			cited,
			chars: p.chars
		});
	};
}
