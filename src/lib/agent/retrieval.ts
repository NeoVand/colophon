import { env } from '$env/dynamic/private';
import { canonicalId, type Source } from './sources';

/**
 * Finding papers.
 *
 * Two services, for two different jobs:
 *
 *   **arXiv** knows what appeared this morning. Its API has real category and
 *   date filtering, which is what a daily sweep needs, and its listings are
 *   live within hours of publication.
 *
 *   **OpenAlex** knows what matters. It carries citation counts, resolved author
 *   names and DOIs, and it indexes far beyond arXiv — but it lags by days to
 *   weeks on new preprints, which makes it the wrong primary source for
 *   "what is new" and the right one for "what is important".
 *
 * harnessXray could only use OpenAlex, because arXiv's API sends no CORS header
 * and the browser refused it. Running server-side removes that constraint
 * entirely — the first real dividend of the move.
 */

/** OpenAlex's anonymous pool is ~100 requests/day *per IP*. */
const OPENALEX = 'https://api.openalex.org/works';
const ARXIV = 'https://export.arxiv.org/api/query';

export class QuotaExhausted extends Error {
	constructor(service: string, resetHours: number) {
		super(
			`${service} quota exhausted; it resets in about ${resetHours}h. ` +
				`Retrying now cannot help — this is a daily credit, not a rate limit.`
		);
		this.name = 'QuotaExhausted';
	}
}

/**
 * OpenAlex's "polite pool" is keyed on a contact address and raises the limit
 * from ~100/day to ~100,000/day.
 *
 * On a server this is not a nicety, it is load-bearing: every run shares one
 * outbound IP, so the anonymous quota is consumed by the whole application
 * rather than by one user. Left unset, a single busy afternoon exhausts it.
 * Deliberately an environment variable rather than a hardcoded address — it is
 * a contact detail, and it belongs to whoever deploys this.
 */
function politePool(params: URLSearchParams): URLSearchParams {
	if (env.OPENALEX_MAILTO) params.set('mailto', env.OPENALEX_MAILTO);
	return params;
}

export interface SearchOptions {
	limit?: number;
	/** `relevance` for a topic; `recency` for a sweep. */
	sort?: 'relevance' | 'recency';
	/** ISO date; only papers published on or after it. */
	since?: string;
	fetchImpl?: typeof fetch;
}

/* ── arXiv ──────────────────────────────────────────────────────────────── */

/**
 * One `<entry>` from an Atom feed, reduced to the fields we use.
 *
 * The abstract rides alongside `Source` rather than inside it: a Source is what
 * can be *cited*, and an abstract is evidence for deciding whether to open a
 * paper, not part of its identity.
 */
export function parseArxivAtom(xml: string): (Source & { summary: string })[] {
	const entries = xml.split('<entry>').slice(1);
	return entries.map((entry) => {
		const pick = (tag: string) => {
			const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
			return match ? decode(match[1].trim().replace(/\s+/g, ' ')) : '';
		};
		const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) =>
			decode(m[1].trim())
		);
		// The id element is a URL: http://arxiv.org/abs/2401.12345v2
		const rawId = pick('id');
		const arxivId = rawId.replace(/^.*\/abs\//, '').replace(/v\d+$/, '');
		const published = pick('published');

		return {
			id: arxivId,
			title: pick('title'),
			authors,
			year: published ? Number(published.slice(0, 4)) : undefined,
			url: `https://arxiv.org/abs/${arxivId}`,
			arxivId,
			doi: `10.48550/arXiv.${arxivId}`,
			depth: 'listed' as const,
			via: 'search_papers',
			// Carried separately from the Source shape; callers that want the
			// abstract read it off the raw result instead.
			summary: pick('summary')
		} as Source & { summary: string };
	});
}

function decode(text: string): string {
	return text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&');
}

/**
 * Build an arXiv `search_query`.
 *
 * arXiv defaults multi-term queries to **OR**, which is almost never what a
 * research question means: `all:mechanistic interpretability` returns papers
 * about mechanics *or* about interpretability, which in practice means neither.
 * Caught by running a live query and reading what came back — the API echoes
 * its interpretation in the feed title, and it said
 * `all:mechanistic OR all:interpretability`.
 *
 * So every term is ANDed. A query already carrying a field prefix (`ti:`,
 * `cat:`, `au:`) or an explicit operator is passed through untouched, because
 * at that point the caller knows what they are doing.
 */
export function arxivQuery(query: string): string {
	const trimmed = query.trim();
	if (/\b(AND|OR|ANDNOT)\b/.test(trimmed) || /\b[a-z]{2,4}:/.test(trimmed)) return trimmed;

	const terms = trimmed.split(/\s+/).filter(Boolean);
	if (terms.length <= 1) return `all:${trimmed}`;
	return terms.map((term) => `all:${term}`).join(' AND ');
}

export async function searchArxiv(
	query: string,
	{ limit = 8, sort = 'relevance', fetchImpl = fetch }: SearchOptions = {}
): Promise<(Source & { summary: string })[]> {
	const params = new URLSearchParams({
		search_query: arxivQuery(query),
		start: '0',
		max_results: String(Math.min(limit, 50)),
		sortBy: sort === 'recency' ? 'submittedDate' : 'relevance',
		sortOrder: 'descending'
	});

	const response = await fetchImpl(`${ARXIV}?${params}`);
	if (!response.ok) throw new Error(`arXiv returned HTTP ${response.status}.`);
	return parseArxivAtom(await response.text());
}

/* ── OpenAlex ───────────────────────────────────────────────────────────── */

interface OpenAlexWork {
	title?: string;
	display_name?: string;
	publication_year?: number;
	cited_by_count?: number;
	doi?: string;
	ids?: { doi?: string };
	authorships?: { author?: { display_name?: string } }[];
	primary_location?: { landing_page_url?: string };
	abstract_inverted_index?: Record<string, number[]>;
}

/**
 * OpenAlex ships abstracts as an inverted index — `{word: [positions]}` — to
 * sidestep republishing restrictions. Reassembling it is a legitimate,
 * documented use, and it is the only way to get an abstract from them.
 */
export function reassembleAbstract(inverted: Record<string, number[]> | undefined): string {
	if (!inverted) return '';
	const words: string[] = [];
	for (const [word, positions] of Object.entries(inverted)) {
		for (const position of positions) words[position] = word;
	}
	return words.join(' ').trim();
}

function toSource(work: OpenAlexWork): Source & { summary: string } {
	const doi = (work.doi ?? work.ids?.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '');
	const url = work.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : '');

	/**
	 * Find the arXiv id in the DOI *or* the landing URL.
	 *
	 * Reading only the DOI was a real bug: OpenAlex often carries a publisher
	 * DOI (or none) while its landing page is plainly an arXiv abstract URL. The
	 * same paper then entered the registry keyed by URL from a search and by
	 * arXiv id from a fetch — two entries for one paper, two rows in the library,
	 * and a bibliography that cited one id while `cite` returned the other.
	 *
	 * Loose matching in the registry hid it at citation time, which is exactly
	 * why it survived to be found by reading a bibliography.
	 */
	const arxivId =
		doi.match(/10\.48550\/arxiv\.(.+)$/i)?.[1] ??
		url.match(/arxiv\.org\/(?:abs|pdf|html)\/([^v?#]+)/i)?.[1];

	return {
		id: canonicalId({ arxivId, doi, url }),
		title: work.title ?? work.display_name ?? '(untitled)',
		authors: (work.authorships ?? [])
			.slice(0, 25)
			.map((a) => a.author?.display_name ?? '')
			.filter(Boolean),
		year: work.publication_year,
		url,
		doi: doi || undefined,
		arxivId,
		citedBy: work.cited_by_count,
		depth: 'listed',
		via: 'search_papers',
		summary: reassembleAbstract(work.abstract_inverted_index)
	};
}

export async function searchOpenAlex(
	query: string,
	{ limit = 8, sort = 'relevance', since, fetchImpl = fetch }: SearchOptions = {}
): Promise<(Source & { summary: string })[]> {
	const params = new URLSearchParams({
		search: query,
		per_page: String(Math.min(limit, 50)),
		select:
			'title,publication_year,cited_by_count,doi,ids,authorships,primary_location,abstract_inverted_index'
	});
	if (sort === 'recency') params.set('sort', 'publication_date:desc');
	if (since) params.set('filter', `from_publication_date:${since}`);

	const response = await fetchImpl(`${OPENALEX}?${politePool(params)}`);

	if (response.status === 429) {
		const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0);
		throw new QuotaExhausted('OpenAlex', reset ? Math.ceil(reset / 3600) : 24);
	}
	if (!response.ok) throw new Error(`OpenAlex returned HTTP ${response.status}.`);

	const json = (await response.json()) as { results?: OpenAlexWork[] };
	return (json.results ?? []).map(toSource);
}

/* ── the combined search ────────────────────────────────────────────────── */

/**
 * Search both, prefer arXiv's freshness, and let OpenAlex add what it knows.
 *
 * The merge is by canonical id, so a paper found in both appears once, carrying
 * arXiv's abstract and OpenAlex's citation count. OpenAlex failing — quota,
 * outage — degrades the result rather than failing the search: a review written
 * from arXiv alone is worse, not impossible.
 */
export async function searchPapers(
	query: string,
	options: SearchOptions = {}
): Promise<(Source & { summary: string })[]> {
	const [arxiv, openalex] = await Promise.allSettled([
		searchArxiv(query, options),
		searchOpenAlex(query, options)
	]);

	const merged = new Map<string, Source & { summary: string }>();
	if (arxiv.status === 'fulfilled') for (const paper of arxiv.value) merged.set(paper.id, paper);

	if (openalex.status === 'fulfilled') {
		for (const paper of openalex.value) {
			const existing = merged.get(paper.id);
			if (existing) {
				existing.citedBy = paper.citedBy ?? existing.citedBy;
				existing.doi ??= paper.doi;
				if (!existing.summary) existing.summary = paper.summary;
			} else {
				merged.set(paper.id, paper);
			}
		}
	}

	if (!merged.size && arxiv.status === 'rejected' && openalex.status === 'rejected') {
		throw arxiv.reason instanceof Error ? arxiv.reason : new Error('Both search services failed.');
	}

	return [...merged.values()].slice(0, options.limit ?? 8);
}
