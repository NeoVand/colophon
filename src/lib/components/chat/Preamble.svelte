<script lang="ts">
	import { session } from '$lib/agent/session.svelte';

	/**
	 * The empty conversation.
	 *
	 * An empty state is the only screen everyone sees, and it has one job here:
	 * make the first question cheap. A blank page with a placeholder in it asks
	 * the reader to guess both what this can do and how much to ask for at once —
	 * and the honest answer to the second is "more than you think", which is
	 * exactly what a suggestion can show and a sentence cannot.
	 *
	 * So the three examples are buttons, not decoration. Each one is a real
	 * question, and pressing it runs it. The first is a survey, the second forces
	 * two full reads and a comparison, and the third is a question with no settled
	 * answer — between them they show the shape of what this is for.
	 *
	 * The note at the bottom is deliberately last and deliberately quiet. It is
	 * the only claim on this screen that matters, and a claim of that kind reads
	 * as marketing when it is set in large type at the top.
	 */

	let {
		/**
		 * Where a chosen question goes. Defaults to running it, which is the point
		 * of the examples; a caller that would rather drop the text into the
		 * composer for editing can take it instead.
		 */
		onask
	}: { onask?: (question: string) => void } = $props();

	const QUESTIONS = [
		'What changed in sparse autoencoder evaluation this year?',
		'Read the two most-cited papers on speculative decoding and compare them.',
		'Is there a consensus yet on whether SAE features are causal?'
	];

	function ask(question: string) {
		if (session.busy) return;
		if (onask) onask(question);
		else void session.send(question);
	}
</script>

<section class="preamble">
	<p class="co-eyebrow">colophon</p>

	<p class="lede">
		Ask about a field. It searches, opens the papers that matter, reads the long ones through, and
		writes you back something with references you can check.
	</p>

	<ul class="examples">
		{#each QUESTIONS as question (question)}
			<li>
				<button onclick={() => ask(question)} disabled={session.busy}>{question}</button>
			</li>
		{/each}
	</ul>

	<p class="guarantee">
		Every reference goes through a tool that refuses anything this run did not actually retrieve. A
		citation here can be wrong about what a paper argues; it cannot be a paper that does not exist.
	</p>
</section>

<style>
	.preamble {
		padding-top: 2rem;
	}

	.lede {
		margin: 0.6rem 0 1.6rem;
		max-width: 30rem;
		font-family: var(--font-serif);
		font-size: 1.0625rem;
		line-height: 1.6;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}

	.examples {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-width: 32rem;
	}

	/* A rule on the left rather than a bordered box each: three buttons drawn as
	   three rectangles is a form, and this is meant to read as three things you
	   might say. The rule is what warms on hover, so the affordance appears
	   under the pointer instead of standing there being clicked. */
	.examples button {
		display: block;
		width: 100%;
		padding: 0.25rem 0 0.25rem 0.9rem;
		border: 0;
		border-left: 1px solid var(--border);
		border-radius: 0;
		background: transparent;
		text-align: left;
		font-family: var(--font-serif);
		font-size: 0.9375rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		cursor: pointer;
		text-wrap: pretty;
		transition:
			color 180ms ease,
			border-color 180ms ease;
	}
	.examples button:hover:not(:disabled) {
		color: var(--foreground);
		border-left-color: var(--co-accent);
	}
	.examples button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.guarantee {
		margin: 2.5rem 0 0;
		max-width: 28rem;
		font-size: 0.75rem;
		line-height: 1.6;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
		text-wrap: pretty;
	}
</style>
