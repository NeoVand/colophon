/**
 * The source registry — what makes a citation impossible to invent.
 *
 * A model asked to write a review with references will produce plausible ones
 * whether or not it read anything, and no amount of prompt admonition reliably
 * stops it. So Colophon does not ask. Nothing can be cited unless it entered
 * this registry by actually arriving over the network, and the `cite` tool
 * refuses everything else.
 *
 * The registry also draws a line the model itself cannot see: a paper *found*
 * is not a paper *read*. A search returns titles and abstracts; that is enough
 * to decide whether to open something and not enough to make a claim about its
 * contents. So sources carry a depth, and `cite` can be asked to insist on
 * `read` — which is what turns "I saw this in a result list" into a refusal
 * rather than a footnote.
 */

export type Depth = 'listed' | 'read';

export interface Source {
	/** Canonical id — an arXiv id where we have one, else a DOI, else the URL. */
	id: string;
	title: string;
	authors: string[];
	year?: number;
	url: string;
	doi?: string;
	arxivId?: string;
	/** How thoroughly this entered the run. `read` means we hold its full text. */
	depth: Depth;
	/** Which tool call introduced it — the audit trail for a citation. */
	via: string;
	citedBy?: number;
}

export class UnknownSource extends Error {
	constructor(
		readonly requested: string,
		readonly known: string[]
	) {
		super(
			known.length
				? `Refusing to cite "${requested}": it never entered this run. ` +
						`Cite only what was retrieved — currently ${known.length} source(s): ${known.join(', ')}.`
				: `Refusing to cite "${requested}": nothing has been retrieved yet in this run. ` +
						`Search for and open a paper before citing it.`
		);
		this.name = 'UnknownSource';
	}
}

export class NotReadYet extends Error {
	constructor(readonly requested: string) {
		super(
			`Refusing to cite "${requested}": it was seen in a search result but never opened. ` +
				`An abstract is not evidence for a claim about a paper's contents — ` +
				`fetch the paper first, or attribute the claim to the abstract explicitly.`
		);
		this.name = 'NotReadYet';
	}
}

/**
 * One registry per run.
 *
 * Deliberately not global: two concurrent runs must not be able to cite each
 * other's sources, and a fresh run must start unable to cite anything at all.
 */
export class SourceRegistry {
	#sources = new Map<string, Source>();

	/**
	 * Record a source, or deepen one already present.
	 *
	 * Depth only ever increases. A paper that was read and later reappears in a
	 * search result has not become less known.
	 */
	register(source: Source): Source {
		const existing = this.#sources.get(source.id);
		if (existing) {
			const merged: Source = {
				...existing,
				...source,
				depth: existing.depth === 'read' ? 'read' : source.depth,
				// Keep the first attribution: how a source *entered* the run is the
				// interesting fact, not the last time it was touched.
				via: existing.via
			};
			this.#sources.set(source.id, merged);
			return merged;
		}
		this.#sources.set(source.id, source);
		return source;
	}

	get(id: string): Source | undefined {
		return this.#sources.get(id) ?? this.#byLooseMatch(id);
	}

	/**
	 * Tolerate the ways a model refers to a paper it really did retrieve —
	 * a versioned arXiv id, a full URL, a DOI, differing case.
	 *
	 * This is deliberately generous about *identifying* a source and not at all
	 * generous about whether it exists. Being strict here would produce refusals
	 * that look like the tool malfunctioning, which teaches the model to stop
	 * citing rather than to cite honestly.
	 */
	#byLooseMatch(needle: string): Source | undefined {
		const key = needle
			.trim()
			.toLowerCase()
			.replace(/^arxiv:/, '');
		const bare = key.replace(/v\d+$/, '');
		for (const source of this.#sources.values()) {
			const candidates = [source.id, source.arxivId, source.doi, source.url]
				.filter(Boolean)
				.map((c) => String(c).toLowerCase());
			if (candidates.some((c) => c === key || c.replace(/v\d+$/, '') === bare)) return source;
			if (candidates.some((c) => c.endsWith(`/${bare}`) || c.endsWith(bare))) return source;
		}
		return undefined;
	}

	/**
	 * Resolve a citation, or throw the reason it cannot be made.
	 *
	 * The two failures are distinct on purpose. "Never retrieved" is a
	 * hallucination; "found but not opened" is overreach. They deserve different
	 * corrections and the messages give them.
	 */
	cite(id: string, { require = 'listed' }: { require?: Depth } = {}): Source {
		const source = this.get(id);
		if (!source) throw new UnknownSource(id, this.ids());
		if (require === 'read' && source.depth !== 'read') throw new NotReadYet(id);
		return source;
	}

	ids(): string[] {
		return [...this.#sources.keys()];
	}

	all(): Source[] {
		return [...this.#sources.values()];
	}

	/** Everything actually opened — the honest basis for a bibliography. */
	read(): Source[] {
		return this.all().filter((s) => s.depth === 'read');
	}

	get size(): number {
		return this.#sources.size;
	}
}

/** A stable id for a paper, preferring the most specific identifier available. */
export function canonicalId(input: { arxivId?: string; doi?: string; url?: string }): string {
	if (input.arxivId) return input.arxivId.replace(/^arxiv:/i, '').replace(/v\d+$/, '');
	if (input.doi) return input.doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
	return input.url ?? '';
}

/** Author-year-title, formatted once so every surface agrees. */
export function formatCitation(source: Source): string {
	const first = source.authors[0]?.split(' ').pop() ?? 'Anon';
	const et = source.authors.length > 1 ? ' et al.' : '';
	const year = source.year ? ` (${source.year})` : '';
	return `${first}${et}${year}, "${source.title}"`;
}
