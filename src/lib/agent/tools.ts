import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchPapers } from './retrieval';
import { fetchPaper } from './paper';
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

export interface ResearchTools {
	registry: SourceRegistry;
	tools: Record<string, ReturnType<typeof createTool>>;
}

export function createResearchTools(): ResearchTools {
	const registry = new SourceRegistry();

	const search_papers = createTool({
		id: 'search_papers',
		description:
			'Search arXiv and OpenAlex for papers. Returns titles, authors, years, citation counts ' +
			'and abstracts. Use sort "recency" to find what is new, "relevance" for a topic. ' +
			'Papers found here can be cited, but only as abstracts — fetch_paper before making any ' +
			'claim about what a paper actually contains.',
		inputSchema: z.object({
			query: z.string().describe('Topic or phrase. Terms are ANDed.'),
			limit: z.number().int().min(1).max(20).default(8),
			sort: z.enum(['relevance', 'recency']).default('relevance')
		}),
		execute: async ({ query, limit, sort }) => {
			const found = await searchPapers(query, { limit, sort });
			for (const paper of found) registry.register({ ...paper, via: 'search_papers' });

			return {
				count: found.length,
				papers: found.map((p) => ({
					id: p.id,
					title: p.title,
					authors: p.authors.slice(0, 4),
					year: p.year,
					citedBy: p.citedBy,
					// Bounded: eight full abstracts is already a few thousand tokens,
					// and this result is re-sent on every later turn.
					abstract: p.summary?.slice(0, 900) ?? ''
				}))
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

			const truncated = paper.chars > EXCERPT_CHARS;
			return {
				arxivId: paper.arxivId,
				title: known?.title ?? paper.title,
				edition: paper.edition,
				sections: paper.sections,
				chars: paper.chars,
				truncated,
				text: paper.text.slice(0, EXCERPT_CHARS),
				...(truncated
					? {
							note: `Excerpt only — ${paper.chars} characters total. The section list above is complete; ask about a specific section if you need more.`
						}
					: {})
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
		tools: { search_papers, fetch_paper, cite, bibliography }
	};
}
