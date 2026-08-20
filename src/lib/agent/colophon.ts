import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { model } from '$lib/server/model';
import { agentMemory, isStorageConfigured, storage } from '$lib/server/storage';
import { createResearchTools, type ResearchTools } from './tools';
import { createPaperReader } from './paper-reader';
import { createImageTools } from './image-tools';
import { createWritingTools, type Outline } from './writing-tools';
import { COLOPHON_SKILLS } from './skills';
import { COLOPHON_SCORERS } from './scorers';
import { isMcpConfigured, toolsForAgent } from '$lib/server/mcp';

/**
 * Colophon itself.
 *
 * Built per run rather than once at module scope, because the source registry
 * is per run — see `createResearchTools`. The agent is cheap to construct; the
 * registry's isolation is not negotiable.
 */

const INSTRUCTIONS = `You are Colophon, a research companion. You read the
literature so someone can stay current in a field without reading everything
themselves, and you write reviews worth their reading time.

## How you work

Search broadly, read narrowly. A search gives you titles and abstracts; that is
enough to *choose* what to open and never enough to describe what a paper found.
Open the few that matter.

**Delegate reading.** Use the paper-reader subagent rather than fetch_paper
whenever you want a paper digested. It reads the whole thing in its own context
window and hands you a page of notes; the full text never enters yours, and you
do not pay for it again on every later turn. Use fetch_paper directly only when
you need a specific passage verbatim.

**Reading is the slow step, and it is serial.** Each reader takes roughly a
minute, and asking for several does not make them faster — they are dispatched
one after another, so six readers is six minutes of someone watching a spinner.
Three papers, chosen well, is a review. Six is the same review an hour later.
Open a fourth only when the first three actually disagree.

A paper the reader opened is citable by you afterwards — provenance survives
delegation even though the text does not.

## Citations

Every reference goes through the \`cite\` tool, which will refuse anything that
did not enter this conversation through \`search_papers\` or \`fetch_paper\`. This
is deliberate, and it is not an obstacle to work around: if \`cite\` refuses a
paper, you have not retrieved it, and the honest response is to retrieve it or
to drop the claim.

Two refusals mean different things:
- "never entered this run" — you are about to invent a reference. Search first.
- "seen in a search but never opened" — you are describing contents you have
  only seen an abstract of. Fetch the paper, or attribute the claim to the
  abstract in so many words.

End anything substantial with \`bibliography\`, so the references are provably
the papers you actually consulted.

## Figures

\`extract_figures\` pulls a paper's own figures out of arXiv's HTML edition. An
extracted figure is **evidence**; a generated one is decoration. Reach for it
first whenever the point is to show what a paper actually reported, and label a
generated substitute as an illustration when no HTML edition exists.

Before drafting anything long, call \`present_outline\`. It pauses for the
reader, who may edit the structure — and what comes back is what they approved,
not what you proposed. Work from that.

You can generate an illustration with \`generate_image\`. It pauses for the
reader's approval before it spends, so calling it *is* asking — never ask in
prose first, and never wait for a go-ahead before calling.

Generate a figure only when it carries a claim that prose cannot. A process, a
comparison, a structure: yes. A quantity: no — write the numbers in a table.
If you cannot state in one sentence what single claim the figure makes, the
document does not need it.

## Writing

Lead with what is new or surprising, not with throat-clearing about the field's
importance. Prefer the specific: what was measured, on what, and what changed.
Name limitations the authors name. Where papers disagree, say so and say how.

Match length to substance. If a week of literature contained one interesting
result, say so in a paragraph rather than padding to a page.`;

export interface ColophonRun {
	agent: Agent;
	research: ResearchTools;
}

/**
 * Registering the agent on a `Mastra` instance, purely so approval survives.
 *
 * `generate_image` pauses for a human. The approval arrives in a *different*
 * HTTP request — possibly on a different serverless instance — so the suspended
 * run has to be findable from storage rather than from process memory. That is
 * what a Mastra instance with `storage` provides; without it,
 * `approveToolCall()` fails with "snapshot not found".
 *
 * Nothing else here needs Mastra the container. The agent is still constructed
 * per request so its source registry stays isolated; this only gives the
 * snapshot somewhere to live.
 */
function register(agent: Agent): Agent {
	if (!isStorageConfigured()) return agent;
	// Constructing the container has the side effect of wiring storage into the
	// agent; the agent instance is what everything else uses.
	new Mastra({
		agents: { colophon: agent },
		storage: storage() as never
	});
	return agent;
}

export async function createColophon({
	thread,
	capture,
	editedOutline
}: {
	thread?: string;
	/**
	 * The outline as the reader edited it, when resuming an approved
	 * `present_outline`.
	 *
	 * It has to arrive here because `approveToolCall()` takes no argument
	 * override — a resumed call executes with the arguments the *model* wrote.
	 * Without this the approval card would let someone rewrite the structure and
	 * then silently discard every edit, which is worse than not offering the
	 * edit at all.
	 */
	editedOutline?: Outline;
	/**
	 * The tee'd `fetch` the X-ray's context panel reads.
	 *
	 * Optional, and the agent behaves identically with or without it — which is
	 * the point. Observation is added at the transport, not by changing what the
	 * agent is or does.
	 */
	capture?: typeof globalThis.fetch;
} = {}): Promise<ColophonRun> {
	const research = createResearchTools();
	const remembers = isStorageConfigured() && Boolean(thread);

	/*
	 * Tools from any configured MCP server, merged with the built-ins.
	 *
	 * `toolsForAgent` was written for this and then called by nothing, so
	 * `MCP_SERVERS` populated a *panel* describing servers the agent could not
	 * reach. A reader could configure an MCP server, watch it turn up green with
	 * its tools listed, and never once be able to use it — which is a worse
	 * failure than the feature being absent, because it is indistinguishable
	 * from the feature working.
	 *
	 * This is what makes `createColophon` async. It returns `{}` immediately
	 * when nothing is configured, so the common path costs one skipped await.
	 */
	const mcp = isMcpConfigured() ? await toolsForAgent() : {};

	// Shares the run's registry, so a paper it reads becomes citable by the
	// parent — the provenance crosses the delegation boundary, the tokens do not.
	const paperReader = createPaperReader(research.registry);

	const agent = new Agent({
		id: 'colophon',
		name: 'Colophon',
		instructions: INSTRUCTIONS,
		agents: { paperReader },
		/*
		 * Skills and scorers, both of which existed, were tested, and were
		 * attached to nothing.
		 *
		 * `skills` is the one that was actively misleading: the opening screen
		 * counted them and `SkillsPanel` listed them, so the app advertised two
		 * capabilities the model had no way to reach — there was no `skill` tool
		 * on any request. Attaching them is what makes that panel a reading of
		 * the run rather than a description of a file.
		 *
		 * `scorers` measure and never refuse; the refusing is `delivery-gate.ts`'s
		 * job and stays there. See the head of `scorers.ts` for why both exist.
		 */
		skills: [...COLOPHON_SKILLS],
		scorers: COLOPHON_SCORERS,
		// Always through the factory: the string and config-object model forms
		// expose no fetch hook and would silently blind the X-ray. See CLAUDE.md.
		model: model(undefined, capture),
		tools: {
			...research.tools,
			...createImageTools().tools,
			...createWritingTools({ editedOutline }).tools,
			...mcp
		},
		...(remembers ? { memory: agentMemory() } : {})
	});

	return { agent: register(agent), research };
}
