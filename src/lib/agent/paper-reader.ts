import { Agent } from '@mastra/core/agent';
import { model, type CaptureFetch } from '$lib/server/model';
import { createReaderTools } from './tools';
import type { SourceRegistry } from './sources';

/**
 * The paper-reader subagent.
 *
 * Some jobs are expensive to read and cheap to summarise. A paper is 40–200 KB
 * — ten to fifty thousand tokens — and what is actually needed from it is a
 * page of notes. Read it in the main conversation and you pay the fifty
 * thousand again on *every* turn that follows, because a tool result stays in
 * the transcript.
 *
 * A subagent runs its own loop in its own context window and returns only its
 * final reply. Everything it read, every section it skimmed past, stays in that
 * window and is discarded with it. The parent pays once, for the notes.
 *
 * That asymmetry is the whole point, and it is why the reader is allowed a
 * 200 KB excerpt where the parent is capped at 24 KB.
 *
 * ── How long this takes, measured ───────────────────────────────────────────
 * About a minute per paper, and **the parent dispatches them one at a time**.
 * That is not obvious and it cost an afternoon to establish, so it is written
 * down here: `paper-reader.live.spec.ts` runs three readers directly and they
 * finish together, while `fanout.live.spec.ts` puts four behind the parent and
 * the turn takes 224s — four readers' worth, in series. The description below
 * used to end "several calls can run at once", which was wrong and which the
 * parent's instructions repeated back as a reason to open more papers.
 *
 * The cost lands on a person watching a spinner, so the honest place to spend
 * it is fewer, better-chosen papers. Both files are opt-in (`LIVE=1`) because
 * they spend real money; re-run them before trusting these numbers again.
 *
 * ── The reply contract ──────────────────────────────────────────────────────
 * Stated explicitly, and the discipline that makes subagents worth having. A
 * subagent that answers "here is everything I found" has *moved* the cost, not
 * removed it — the parent now pays for the same tokens under a different name.
 *
 * ── The shared registry ─────────────────────────────────────────────────────
 * The reader is given the run's registry, not its own. Fetching promotes the
 * paper to depth 'read' there, so the parent can afterwards `cite` it for a
 * claim about its contents despite never having seen the text. The provenance
 * survives the delegation; only the tokens do not.
 */

const INSTRUCTIONS = `You read ONE paper and report back. That is your whole job.

1. Call fetch_paper with the id you were given. Read what comes back properly —
   you have room for the whole thing, and this is the only chance anyone gets to
   read it.
2. Return notes in this shape, and nothing else:

**Claim** — what the paper argues, in one or two sentences.
**Method** — how they tested it, concretely. Datasets, scale, baselines.
**Evidence** — the numbers that matter. Actual figures, not "improved".
**Limitations** — what the authors themselves flag, plus anything obvious they
do not.
**Worth knowing** — one sentence on why a practitioner should or should not care.

Hard limits: at most 250 words total. No preamble, no "I read the paper", no
restating the title. If the paper is not what its title suggests, say that first
and briefly.

You cannot cite, search, or write documents. If the fetch fails, say so in one
line and stop — do not guess at contents from the title.`;

export function createPaperReader(registry: SourceRegistry, capture?: CaptureFetch): Agent {
	const { tools } = createReaderTools(registry);

	return new Agent({
		id: 'paper-reader',
		name: 'Paper reader',
		// `description` is what the parent model sees when deciding to delegate,
		// so it names the *cost* argument rather than just the capability.
		description:
			'Reads ONE arXiv paper in full and returns at most 250 words of structured notes. ' +
			'Use this instead of fetch_paper whenever you want a paper digested — it keeps the ' +
			'full text out of your own context. One paper per call, and calls are dispatched ' +
			'one after another: each takes about a minute, so four papers is four minutes.',
		instructions: INSTRUCTIONS,
		// The tee'd transport when there is one. The reader behaves identically
		// either way — observation is added at the transport, never to the agent.
		model: model(undefined, capture),
		tools
	});
}
