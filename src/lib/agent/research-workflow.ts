import { createWorkflow, createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { model } from '$lib/server/model';
import { searchPapers } from './retrieval';
import { SourceRegistry, formatReferences } from './sources';
import { createPaperReader } from './paper-reader';
import { createResearchTools } from './tools';

/**
 * Deep research, as an explicit pipeline.
 *
 * The chat agent is one loop that decides everything for itself, and that is
 * the right shape for a conversation. It is the wrong shape for the thing this
 * product is actually for: a question worth an hour, answered the same way
 * every time, with the expensive part parallelised and each stage inspectable.
 *
 * ── Why a workflow rather than a longer prompt ──────────────────────────────
 * Three things a prompt cannot give you, and this does:
 *
 * 1. **Structure you can draw.** A workflow has a step graph. That is what the
 *    X-ray's graph view reads — not a diagram anyone drew, but the topology
 *    the engine will actually execute, via `serializedStepGraph`.
 * 2. **Real parallelism.** Reading four papers is four subagents at once with
 *    a barrier after them, expressed as `.foreach(..., { concurrency })` rather
 *    than hoped for from a model that was asked nicely.
 * 3. **A place to stop.** Steps can suspend and resume, so a gate between
 *    "here is what I plan to read" and "go" is a property of the pipeline
 *    instead of a special case bolted onto a chat turn.
 *
 * ── The registry is threaded through, not rebuilt ───────────────────────────
 * Every step shares one `SourceRegistry`, for the same reason the chat agent
 * shares one with its subagent: a paper the reader opened must be citable by
 * the writer afterwards. Provenance crosses a step boundary; the text does not.
 */

/* ── what each stage hands the next ───────────────────────────────────────── */

const Plan = z.object({
	queries: z
		.array(z.string())
		.min(1)
		.max(4)
		.describe('Distinct searches. Not rephrasings of each other.'),
	angle: z.string().describe('One sentence: what would make this answer worth reading.')
});

const Selection = z.object({
	arxivIds: z
		.array(z.string())
		.max(4)
		.describe('The papers actually worth opening in full. Fewer is better.'),
	because: z.string().describe('One sentence on why these and not the others.')
});

/**
 * One shared registry per run, injected rather than global.
 *
 * `createResearchTools` already isolates per call; this makes the *workflow's*
 * isolation explicit and testable, and it is what lets the writer step cite a
 * paper only the reader step ever saw.
 */
export interface ResearchDeps {
	registry: SourceRegistry;
}

function scopeAgent() {
	return new Agent({
		id: 'research-scope',
		name: 'Scope',
		instructions: `You turn a research question into a small set of searches.

Write between one and four queries. They must be genuinely different angles —
different subfields, different vocabulary, different framings — not the same
query with the words moved around, which returns the same papers and costs the
same money.

arXiv ANDs the terms, so keep each query to the three or four words that matter.`,
		model: model()
	});
}

function selectAgent() {
	return new Agent({
		id: 'research-select',
		name: 'Select',
		instructions: `You choose which papers are worth opening in full.

You are given titles and abstracts. Opening a paper costs a whole context
window, so choose the two or three that would change the answer, not the eight
that are on topic. Prefer a paper that disagrees with the others over a fourth
that agrees.

Return arXiv ids exactly as given.`,
		model: model()
	});
}

function writeAgent(registry: SourceRegistry) {
	const { tools } = createResearchTools({ registry });
	return new Agent({
		id: 'research-write',
		name: 'Write',
		instructions: `You write the answer from notes other agents took.

Lead with what is new or surprising. Attribute in running text — (Lee et al.,
2026). Where papers disagree, say so and say how. Name limitations the authors
name.

Verify every reference through the \`cite\` tool as you write it; it will refuse
anything that did not enter this run. Do not write a references section — one is
appended for you from what you actually cited.

Match length to substance. A thin literature deserves a short answer.`,
		model: model(),
		// Only `cite`. The reading is done; this step's job is to write, and
		// giving it search would let it wander back out into retrieval.
		tools: { cite: tools.cite }
	});
}

/* ── the steps ────────────────────────────────────────────────────────────── */

export function createResearchWorkflow({ registry }: ResearchDeps) {
	const scope = createStep({
		id: 'scope',
		description: 'Turn the question into a few genuinely different searches.',
		inputSchema: z.object({ question: z.string() }),
		outputSchema: z.object({ question: z.string(), plan: Plan }),
		execute: async ({ inputData }) => {
			const { object } = await scopeAgent().generate(inputData.question, {
				structuredOutput: { schema: Plan }
			});
			return { question: inputData.question, plan: object as z.infer<typeof Plan> };
		}
	});

	const search = createStep({
		id: 'search',
		description: 'Run every planned search and pool the results.',
		inputSchema: z.object({ question: z.string(), plan: Plan }),
		outputSchema: z.object({
			question: z.string(),
			plan: Plan,
			found: z.array(
				z.object({
					id: z.string(),
					title: z.string(),
					year: z.number().optional(),
					abstract: z.string()
				})
			)
		}),
		execute: async ({ inputData }) => {
			// Concurrent: the searches are independent and each is a slow network
			// call, so doing them in series would triple the wall clock for
			// nothing. `allSettled`, because one failing provider must not lose
			// the other two queries' results.
			const settled = await Promise.allSettled(
				inputData.plan.queries.map((q) => searchPapers(q, { limit: 6, sort: 'relevance' }))
			);

			const seen = new Set<string>();
			const found: { id: string; title: string; year?: number; abstract: string }[] = [];

			for (const outcome of settled) {
				if (outcome.status !== 'fulfilled') continue;
				for (const paper of outcome.value) {
					registry.register({ ...paper, via: 'search_papers' });
					// Deduped here rather than downstream: four queries on one topic
					// overlap heavily, and handing the selector the same paper three
					// times invites it to think three papers agree.
					if (seen.has(paper.id)) continue;
					seen.add(paper.id);
					found.push({
						id: paper.id,
						title: paper.title,
						year: paper.year,
						abstract: paper.summary?.slice(0, 600) ?? ''
					});
				}
			}

			return { question: inputData.question, plan: inputData.plan, found };
		}
	});

	const select = createStep({
		id: 'select',
		description: 'Choose the few papers worth a whole context window each.',
		inputSchema: search.outputSchema,
		outputSchema: z.object({
			question: z.string(),
			plan: Plan,
			selection: Selection
		}),
		execute: async ({ inputData }) => {
			const listing = inputData.found
				.map((p) => `- ${p.id} — ${p.title}${p.year ? ` (${p.year})` : ''}\n  ${p.abstract}`)
				.join('\n');

			const { object } = await selectAgent().generate(
				`Question: ${inputData.question}\n\nAngle: ${inputData.plan.angle}\n\nCandidates:\n${listing}`,
				{ structuredOutput: { schema: Selection } }
			);

			return {
				question: inputData.question,
				plan: inputData.plan,
				selection: object as z.infer<typeof Selection>
			};
		}
	});

	const read = createStep({
		id: 'read',
		description: 'Read each chosen paper in its own context window, in parallel.',
		inputSchema: select.outputSchema,
		outputSchema: z.object({
			question: z.string(),
			notes: z.array(z.object({ arxivId: z.string(), notes: z.string() }))
		}),
		execute: async ({ inputData }) => {
			const reader = createPaperReader(registry);

			/*
			 * The expensive step, and the one that most justifies the workflow.
			 *
			 * Each reader gets its own context window, reads a whole paper, and
			 * returns at most a page. Run in series this is minutes; run together
			 * it is the slowest single paper. `allSettled` again — a paper whose
			 * HTML edition is missing must not take the review down with it.
			 */
			const settled = await Promise.allSettled(
				inputData.selection.arxivIds.map(async (arxivId) => {
					const result = await reader.generate(
						`Read arXiv:${arxivId} and report on it in the contracted form. ` +
							`The question being answered is: ${inputData.question}`
					);
					return { arxivId, notes: result.text ?? '' };
				})
			);

			const notes = settled
				.filter(
					(s): s is PromiseFulfilledResult<{ arxivId: string; notes: string }> =>
						s.status === 'fulfilled'
				)
				.map((s) => s.value)
				.filter((n) => n.notes.trim());

			return { question: inputData.question, notes };
		}
	});

	const write = createStep({
		id: 'write',
		description: 'Write the answer from the notes, citing through the registry.',
		inputSchema: read.outputSchema,
		outputSchema: z.object({
			answer: z.string(),
			citedIds: z.array(z.string()),
			papersRead: z.number()
		}),
		execute: async ({ inputData }) => {
			const notes = inputData.notes.map((n) => `### arXiv:${n.arxivId}\n${n.notes}`).join('\n\n');

			const result = await writeAgent(registry).generate(
				`Question: ${inputData.question}\n\nNotes from the papers that were read:\n\n${notes}`,
				{ maxSteps: 12 }
			);

			const cited = registry.cited();
			const body = result.text ?? '';
			const references = formatReferences(cited);

			return {
				answer:
					references && !/^##\s+references/im.test(body)
						? `${body.trimEnd()}\n\n${references}\n`
						: body,
				citedIds: cited.map((s) => s.id),
				papersRead: inputData.notes.length
			};
		}
	});

	return createWorkflow({
		id: 'deep-research',
		description:
			'Scope a question into searches, pool and dedupe results, choose what is worth ' +
			'opening, read those in parallel, then write an answer whose references are ' +
			'provably the papers consulted.',
		inputSchema: z.object({ question: z.string() }),
		outputSchema: write.outputSchema
	})
		.then(scope)
		.then(search)
		.then(select)
		.then(read)
		.then(write)
		.commit();
}
