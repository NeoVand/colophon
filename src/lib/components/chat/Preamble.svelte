<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import { session } from '$lib/agent/session.svelte';
	import { SKILL_CARDS } from '$lib/agent/skills';
	import Glyph from './Glyph.svelte';

	/**
	 * The empty conversation — a hero, not a list.
	 *
	 * This is the only screen every visitor sees, and it is seen before a single
	 * token is spent, so it is the best teaching surface in the application. It
	 * has two jobs and they are not the same job.
	 *
	 * The first is to state the thesis. Colophon is not "chat with papers"; it is
	 * a claim about provenance — the set of things it can cite is exactly the set
	 * of things it actually fetched, enforced by a tool rather than by asking the
	 * model nicely. That is one equation, so it is set as one, in mono, large.
	 *
	 * The second is to make the first question cheap. A blank page asks the
	 * reader to guess both what this can do and how much to ask for at once, and
	 * the honest answer to the second is "more than you think" — which a
	 * suggestion can show and a sentence cannot. So the three examples are
	 * buttons and pressing one runs it. They are three *kinds* of question: a
	 * survey of a year, a read-both-and-compare that forces two full papers
	 * through the reader subagent, and one with no settled answer.
	 */

	let {
		/**
		 * Where a chosen question goes. Defaults to running it, which is the point
		 * of the examples; a caller that would rather drop the text into the
		 * composer for editing can take it instead.
		 */
		onask
	}: { onask?: (question: string) => void } = $props();

	/*
	 * The counts, and why one of them is derived and three are not.
	 *
	 * Skills come from the registry itself, because `skills.ts` imports nothing
	 * but `@mastra/core/skills` and SkillsPanel already pulls it into this
	 * bundle — so adding a skill updates this row for free and can never lie.
	 *
	 * The other three cannot be read the same way. `tools.ts` reaches
	 * `retrieval.ts`, which imports `$env/dynamic/private`, and
	 * `research-workflow.ts` is server-side for the same reason; importing
	 * either here would drag server code into the client bundle to win a number.
	 * So they are literals, counted from the code rather than remembered, and
	 * each one names where it was counted — a wrong number on the opening screen
	 * is worse than no number at all, and this is what makes a change to any of
	 * these one grep away instead of a silent lie.
	 *
	 *   TOOLS      createResearchTools() returns search_papers, fetch_paper,
	 *              cite and bibliography; createImageTools() adds generate_image.
	 *              colophon.ts spreads exactly those two sets onto the agent.
	 *   SUBAGENTS  createPaperReader() — the sole entry in the agent's `agents`.
	 *   STEPS      createResearchWorkflow() chains scope → search → select →
	 *              read → write.
	 */
	const TOOL_COUNT = 5;
	const SUBAGENT_COUNT = 1;
	const STEP_COUNT = 5;

	const COUNTS = [
		{ n: TOOL_COUNT, one: 'tool', many: 'tools', icon: ICON.tool, tone: 'tool' },
		{
			n: SUBAGENT_COUNT,
			one: 'subagent',
			many: 'subagents',
			icon: ICON.subagent,
			tone: 'subagent'
		},
		// Skills and workflow steps have no colour in the legend — they are not
		// subsystems, they are machinery — so they take the app's own accent
		// rather than borrowing a meaning that belongs to something else.
		{ n: SKILL_CARDS.length, one: 'skill', many: 'skills', icon: ICON.skills, tone: 'accent' },
		{ n: STEP_COUNT, one: 'step', many: 'steps', icon: ICON.workflow, tone: 'accent' }
	];

	const QUESTIONS = [
		'What changed in sparse-autoencoder evals this year?',
		'Compare the two most-cited speculative decoding papers.',
		'Is there consensus that SAE features are causal?'
	];

	function ask(question: string) {
		if (session.busy) return;
		if (onask) onask(question);
		else void session.send(question);
	}
</script>

<section class="preamble">
	<span class="mark"><Glyph size={38} strokeWidth={1.25} /></span>

	<!-- The whitespace between these three is load-bearing. Set flush and spaced
	     with margins instead, the line is one unbreakable word: in a chat column
	     narrowed to a third of the window it cannot wrap, so it overflows. -->
	<h2 class="headline">
		<span class="cited">Cited</span>
		<span class="op">=</span>
		<span class="got">Retrieved</span>
	</h2>

	<p class="lede">
		It searches, opens the papers that matter, and hands the long ones to a reader with a context
		window of its own. Every reference then passes through a tool that refuses anything this run did
		not retrieve — so a citation here can be wrong about what a paper argues, but it cannot be a
		paper that does not exist.
	</p>

	<hr class="rule" />

	<ul class="counts">
		{#each COUNTS as c (c.one)}
			<li style:--tone="var(--co-{c.tone})">
				<span class="ico" aria-hidden="true"><HugeiconsIcon icon={c.icon} size={12} /></span>
				<span class="co-num n">{c.n}</span>
				<span class="co-eyebrow lbl">{c.n === 1 ? c.one : c.many}</span>
			</li>
		{/each}
	</ul>

	<p class="co-eyebrow try">Try one</p>

	<ul class="pills">
		{#each QUESTIONS as question (question)}
			<li>
				<button class="co-field" onclick={() => ask(question)} disabled={session.busy}>
					{question}
				</button>
			</li>
		{/each}
	</ul>
</section>

<style>
	.preamble {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2.5rem 0 1rem;
		text-align: center;
	}

	/* The app's own voice, and the only place on this screen that uses it. */
	.mark {
		display: inline-flex;
		color: color-mix(in oklab, var(--co-accent) 78%, transparent);
	}

	/* Mono because the line is an equation, not a slogan: the two nouns name two
	   sets, and the claim is that they are the same set. Sans would ask it to be
	   read as marketing copy. */
	.headline {
		margin: 1.15rem 0 0;
		font-family: var(--font-mono);
		/* Capped rather than merely fluid: vw measures the window, and this line
		   lives in a column a third that wide, so an uncapped size wraps the
		   equation the moment anyone drags the split. */
		font-size: clamp(1.25rem, 3.2vw, 1.75rem);
		font-weight: 500;
		letter-spacing: -0.02em;
		line-height: 1.2;
		text-wrap: balance;
	}
	/* Legend colours, used for exactly what they mean elsewhere: sage is papers
	   and how well they are known, ochre is retrieval happening. */
	.cited {
		color: var(--co-library);
	}
	.got {
		color: var(--co-tool);
	}
	.op {
		margin: 0 0.08em;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}

	.lede {
		margin: 1rem 0 0;
		max-width: 30rem;
		font-family: var(--font-serif);
		font-size: 0.9375rem;
		line-height: 1.65;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}

	/* A hairline, not a divider: it separates the claim from the inventory
	   without drawing a box around either. */
	.rule {
		width: min(100%, 26rem);
		margin: 1.75rem 0 0;
		border: 0;
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}

	.counts {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: baseline;
		gap: 0.25rem 0.5rem;
		margin: 0.85rem 0 0;
		padding: 0;
		list-style: none;
	}
	.counts li {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--tone);
	}
	/* Trailing rather than leading, which matters only once the row wraps — and
	   it does, in a chat column narrowed past about 340px. A leading separator
	   starts the second line with a stray dot; a trailing one ends the first
	   line with what reads as a continuation mark. The pseudo-element lives
	   inside a toned <li>, so it needs its own colour or it takes that item's. */
	.counts li:not(:last-child)::after {
		content: '·';
		margin-left: 0.3rem;
		color: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
	}
	/* Icon at part strength, number at full: the pair reads as one readout
	   rather than as a picture standing next to a figure. Same ratio as the
	   panel headers. */
	.ico {
		display: inline-flex;
		color: color-mix(in oklab, var(--tone) 62%, transparent);
	}
	.n {
		font-size: 0.75rem;
		font-weight: 500;
	}
	.lbl {
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
	}

	.try {
		margin: 2rem 0 0;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem;
		margin: 0.7rem 0 0;
		padding: 0;
		max-width: 34rem;
		list-style: none;
	}

	/* Rounded rather than square, and this is the one place in the app that is:
	   a pill says "press me and something happens", where the hairline
	   rectangles everywhere else say "read me". The border is the affordance and
	   it is what warms on hover, so the invitation appears under the pointer. */
	.pills button {
		border: 1px solid color-mix(in oklab, var(--border) 75%, transparent);
		border-radius: 999px;
		background: transparent;
		padding: 0.32rem 0.8rem;
		font-family: var(--font-sans);
		font-size: 0.75rem;
		line-height: 1.45;
		color: color-mix(in oklab, var(--muted-foreground) 90%, transparent);
		cursor: pointer;
		text-wrap: pretty;
		transition:
			color 180ms ease,
			border-color 180ms ease,
			background-color 180ms ease;
	}
	.pills button:hover:not(:disabled) {
		color: var(--foreground);
		border-color: var(--co-accent-soft);
		background: color-mix(in oklab, var(--co-accent) 7%, transparent);
	}
	.pills button:disabled {
		cursor: default;
		opacity: 0.5;
	}
</style>
