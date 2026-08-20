import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchPapers } from './retrieval';
import { fetchPaper, articleOnly } from './paper';
import { extractFigures, extractPaperTitle, figurePageUrl, normaliseId } from './figures';
import { SourceRegistry, formatCitation, type Source } from './sources';

/**
 * The research tools, bound to one run's source registry.
 *
 * A factory rather than module-level constants, because the registry must not
 * be shared: two runs citing each other's sources would defeat the entire point
 * of having a registry, and a fresh run has to start unable to cite anything.
 * Closing over it here is what makes "one registry per run" structural rather
 * than a convention someone has to remember.
 */

/**
 * How much of a paper comes back in a tool result.
 *
 * A full paper is 40–200 KB, which is 10–50k tokens — and a tool result is
 * re-sent on *every* subsequent turn of the conversation, so a single careless
 * read can dominate the bill for the rest of the run. The cap keeps one paper
 * to roughly six thousand tokens.
 *
 * The proper fix is a subagent that digests a paper in its own context window
 * and returns a page of notes, which is how harnessXray does it. Until that
 * exists, this bound is what stands between one curious question and a very
 * expensive afternoon.
 */
const EXCERPT_CHARS = 24_000;

/**
 * What a subagent may read.
 *
 * Far larger, because a subagent's context window is *thrown away* when it
 * returns — the cost is paid once instead of on every subsequent turn. That
 * asymmetry is the entire reason subagents exist, and it is why the reader can
 * afford a whole paper while the parent cannot afford an excerpt.
 */
const SUBAGENT_EXCERPT_CHARS = 200_000;

export interface ResearchTools {
	registry: SourceRegistry;
	tools: Record<string, ReturnType<typeof createTool>>;
}

export interface ToolOptions {
	/**
	 * Share a registry across parent and subagents.
	 *
	 * This is what makes delegation work: the reader subagent fetches a paper,
	 * which promotes it to depth 'read' in the shared registry, so the *parent*
	 * can then cite it for a claim about its contents — even though the parent
	 * never saw the text.
	 */
	registry?: SourceRegistry;
	excerptChars?: number;
}

export function createResearchTools(options: ToolOptions = {}): ResearchTools {
	const registry = options.registry ?? new SourceRegistry();
	const excerptChars = options.excerptChars ?? EXCERPT_CHARS;

	const search_papers = createTool({
		id: 'search_papers',
		description:
			'Search arXiv and OpenAlex for papers. Returns titles, authors, years, citation counts ' +
			'and abstracts. Use sort "recency" to find what is new, "relevance" for a topic. ' +
			'A result marked `seen: true` was already returned by an earlier search in this run — ' +
			'its abstract is above and is not repeated. It is still citable and still fetchable. ' +
			'Papers found here can be cited, but only as abstracts — fetch_paper before making any ' +
			'claim about what a paper actually contains.',
		inputSchema: z.object({
			query: z.string().describe('Topic or phrase. Terms are ANDed.'),
			limit: z.number().int().min(1).max(20).default(8),
			sort: z.enum(['relevance', 'recency']).default('relevance')
		}),
		execute: async ({ query, limit, sort }) => {
			const found = await searchPapers(query, { limit, sort });

			/*
			 * A paper met before comes back without its abstract.
			 *
			 * Measured, not guessed. A single research turn made four searches on
			 * near-identical queries and the context panel showed the result: five
			 * `search_papers — result` rows of ~14,000 tokens each, 48% of a
			 * 138,000-token request, for 25 distinct papers across 32 result rows.
			 * Seven of those rows were the same papers described a second and third
			 * time, and every repeat stayed in the window for every remaining call
			 * of the turn.
			 *
			 * The registry already knows what has been seen, so the repeat carries
			 * `seen: true` and no abstract. This is not hiding anything: the full
			 * abstract is earlier in the very same context, which is precisely why
			 * repeating it buys nothing. The title stays so the ranking of *this*
			 * search is still readable.
			 *
			 * Caching makes the waste cheaper than it looks — that turn was 92%
			 * cached — but a cached token is not a free token, and 141 kB on the
			 * wire for every step is latency nobody is caching away.
			 */
			const rows = found.map((p) => {
				const seen = Boolean(registry.get(p.id));
				registry.register({ ...p, via: 'search_papers' });

				return {
					id: p.id,
					title: p.title,
					...(seen
						? { seen: true as const }
						: {
								authors: p.authors.slice(0, 4),
								year: p.year,
								citedBy: p.citedBy,
								// Bounded: eight full abstracts is already a few thousand
								// tokens, and this result is re-sent on every later call.
								abstract: p.summary?.slice(0, 900) ?? ''
							})
				};
			});

			return {
				count: found.length,
				repeats: rows.filter((r) => 'seen' in r).length,
				papers: rows
			};
		}
	});

	const fetch_paper = createTool({
		id: 'fetch_paper',
		description:
			"Read a paper's full text from arXiv's HTML edition. Returns its section headings and " +
			'an excerpt. Only after this can the paper be cited for claims about its contents. ' +
			'Reading is expensive — read the papers that matter, not every result.',
		inputSchema: z.object({
			arxivId: z.string().describe('arXiv id, e.g. 2404.14082. Any version suffix is ignored.')
		}),
		execute: async ({ arxivId }) => {
			const known = registry.get(arxivId);
			const paper = await fetchPaper(arxivId, { fallbackAbstract: undefined });

			// Promote to `read` so `cite` will accept it for claims about content.
			const source: Source = {
				...(known ?? {
					id: paper.arxivId,
					title: paper.title,
					authors: [],
					url: `https://arxiv.org/abs/${paper.arxivId}`,
					arxivId: paper.arxivId,
					via: 'fetch_paper'
				}),
				depth: paper.edition === 'html' ? 'read' : 'listed'
			};
			registry.register(source);

			const truncated = paper.chars > excerptChars;
			return {
				arxivId: paper.arxivId,
				title: known?.title ?? paper.title,
				edition: paper.edition,
				sections: paper.sections,
				chars: paper.chars,
				truncated,
				text: paper.text.slice(0, excerptChars),
				...(truncated
					? {
							note: `Excerpt only — ${paper.chars} characters total. The section list above is complete; ask about a specific section if you need more.`
						}
					: {})
			};
		}
	});

	/**
	 * The paper's own pictures.
	 *
	 * This is the tool that makes a review look like a paper rather than an
	 * essay about one. Everything else here returns text; this returns the
	 * figure the authors chose to publish, under the caption they wrote for it.
	 *
	 * ── Why the store is reached by dynamic import ──────────────────────────
	 * `figure-fetch` pulls in the blob store, which pulls in Postgres. Importing
	 * that at module scope would put a database in the graph of every test that
	 * only wanted to check a citation refusal, and of the workflow module that
	 * never stores a byte. Loading it inside `execute` keeps the cost where the
	 * work is.
	 */
	const extract_figures = createTool({
		id: 'extract_figures',
		description:
			"Pull the REAL figures out of a paper — the publisher's own image files, under the " +
			"paper's own captions — and store them under /figures/. An extracted figure is " +
			'EVIDENCE: it is what the authors chose to show. A generated one is decoration. Prefer ' +
			'this over generate_image whenever the point is to show what a paper actually reported, ' +
			"and embed the result with ![caption](path). Reads arXiv's HTML edition, which exists " +
			'for roughly 2024 onward; a paper without one returns no figures rather than a ' +
			'substitute.',
		inputSchema: z.object({
			arxivId: z.string().describe('arXiv id, e.g. 2404.14082. Any version suffix is ignored.'),
			max: z
				.number()
				.int()
				.min(1)
				.max(12)
				.default(4)
				.describe('How many to take, in document order. A review rarely needs more than two.')
		}),
		execute: async ({ arxivId, max }) => {
			const id = normaliseId(arxivId);
			const pageUrl = figurePageUrl(id);

			let response: Response | undefined;
			try {
				response = await fetch(pageUrl);
			} catch {
				response = undefined;
			}
			if (!response?.ok) {
				return {
					count: 0,
					figures: [],
					note:
						`arXiv:${id} has no HTML edition, which is normal before 2024. Its figures cannot ` +
						`be extracted — describe them from the text, or use generate_image and say the ` +
						`figure is an illustration rather than the paper's own.`
				};
			}

			const html = await response.text();
			// Furniture first: arXiv's own navigation carries images, and without
			// this a paper's "figures" can begin with the site logo.
			const found = extractFigures(articleOnly(html), response.url || pageUrl);

			/*
			 * Registered at `listed`, deliberately not at `read`.
			 *
			 * Holding a paper's figures is enough to attribute a figure to it and
			 * not enough to make a claim about its argument — that is what
			 * `fetch_paper` is for, and `register` only ever raises depth, so a
			 * paper already read stays read. Registering at `read` here would let
			 * a run that never opened the prose cite it for the prose, which is
			 * the one thing this app exists to make impossible.
			 */
			const known = registry.get(id);
			registry.register({
				id,
				title: known?.title || extractPaperTitle(html) || id,
				authors: known?.authors ?? [],
				year: known?.year,
				url: known?.url ?? `https://arxiv.org/abs/${id}`,
				arxivId: id,
				depth: 'listed',
				via: 'extract_figures'
			});

			if (!found.length) {
				return {
					count: 0,
					figures: [],
					note: `The HTML edition of arXiv:${id} contains no figures.`
				};
			}

			const { storeFigure } = await import('$lib/server/figure-fetch');
			const stored: { path: string; caption: string }[] = [];
			const skipped: string[] = [];
			let halted = '';

			for (const figure of found.slice(0, max)) {
				try {
					const result = await storeFigure(id, figure);
					if (result.ok) stored.push({ path: result.figure.path, caption: result.figure.caption });
					else skipped.push(result.reason);
				} catch (error) {
					// A full blob store stops everything, not just this figure — but
					// the figures already stored are real and must still come back.
					halted = error instanceof Error ? error.message : String(error);
					break;
				}
			}

			return {
				count: stored.length,
				figures: stored,
				note: [
					stored.length
						? `Embed with ![caption](path). Attribute each one in its caption text — ` +
							`"Figure from arXiv:${id}" — and embed only a figure that carries a claim the ` +
							`prose needs.`
						: `Found ${found.length} figures in arXiv:${id} but stored none.`,
					`arXiv:${id} is citable as a listed source; call fetch_paper before claiming ` +
						`anything about what it argues.`,
					skipped.length ? `Skipped ${skipped.length}: ${skipped.slice(0, 3).join('; ')}.` : '',
					halted
				]
					.filter(Boolean)
					.join(' ')
			};
		}
	});

	const cite = createTool({
		id: 'cite',
		description:
			'Turn a retrieved paper into a citation. REFUSES anything that did not enter this run ' +
			'through search_papers or fetch_paper — you cannot cite a paper you have not retrieved. ' +
			'Set requireRead when the claim is about what the paper contains rather than what its ' +
			'abstract says.',
		inputSchema: z.object({
			id: z.string().describe('arXiv id, DOI or URL of a paper retrieved in this run.'),
			requireRead: z
				.boolean()
				.default(true)
				.describe('Insist the paper was actually opened, not merely listed in a search.')
		}),
		execute: async ({ id, requireRead }) => {
			// The throw is the feature: it becomes a tool-error the model must
			// respond to, rather than a citation nobody checked.
			const source = registry.cite(id, { require: requireRead ? 'read' : 'listed' });
			return {
				citation: formatCitation(source),
				id: source.id,
				title: source.title,
				authors: source.authors,
				year: source.year,
				url: source.url,
				doi: source.doi,
				depth: source.depth
			};
		}
	});

	const bibliography = createTool({
		id: 'bibliography',
		description:
			'List everything retrieved in this run, so a document can end with references that are ' +
			'provably the ones actually consulted.',
		inputSchema: z.object({
			readOnly: z
				.boolean()
				.default(true)
				.describe('Only papers actually opened, rather than everything seen in a search.')
		}),
		execute: async ({ readOnly }) => {
			const sources = readOnly ? registry.read() : registry.all();
			return {
				count: sources.length,
				entries: sources.map((s) => ({
					id: s.id,
					citation: formatCitation(s),
					url: s.url,
					depth: s.depth,
					// How it entered the run — the audit trail behind the citation.
					via: s.via
				}))
			};
		}
	});

	return {
		registry,
		tools: { search_papers, fetch_paper, extract_figures, cite, bibliography }
	};
}

/**
 * The tool set a paper-reader subagent carries: reading, and nothing else.
 *
 * No search (it is given an id), no cite (it reports notes, not references),
 * no bibliography. A subagent whose reply contract is "notes on one paper"
 * should not be able to wander.
 */
export function createReaderTools(registry: SourceRegistry): ResearchTools {
	const full = createResearchTools({ registry, excerptChars: SUBAGENT_EXCERPT_CHARS });
	// Reading and figures, and nothing else. The earlier version was reading
	// alone, on the argument that a subagent with a reply contract "should not be
	// able to wander" — which is right about *search* and wrong about figures. A
	// reader that has the paper open is exactly the thing best placed to bring
	// back its central figure, and extract_figures cannot wander: it can only
	// return assets from the paper it was already given.
	return {
		registry,
		tools: {
			fetch_paper: full.tools.fetch_paper,
			extract_figures: full.tools.extract_figures
		}
	};
}
