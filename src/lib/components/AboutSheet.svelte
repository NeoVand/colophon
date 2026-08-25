<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import { ICON } from '$lib/icons';

	/**
	 * What this is, in the app rather than in a README.
	 *
	 * Set in the serif reading face, because the one thing worth saying here is
	 * an argument and not a feature list. Someone who opens this has already
	 * seen the instruments; what they are missing is why they exist.
	 */
	let { open = $bindable(false) }: { open?: boolean } = $props();

	const REPO = 'https://github.com/NeoVand/colophon';
	const SIBLING = 'https://github.com/NeoVand/harnessXray';
</script>

<Sheet bind:open side="right" title="About">
	<div class="sheet">
		<p class="co-wordmark mark">colo<em>phon</em></p>
		<p class="tagline">A research companion, and an X-ray of the agent being one.</p>

		<section class="sec">
			<h3 class="co-eyebrow">what it does</h3>
			<div class="co-prose body">
				<p>
					You give Colophon a field to follow. It searches the literature, fetches full text, hands
					the long reads to a subagent with its own context window, and writes back a digest that is
					meant to be sat down with rather than skimmed. Once a period it decides whether anything
					actually happened, and if nothing did it says so and sends nothing. A quiet week is the
					product working.
				</p>
				<p>
					A citation here cannot be invented. The <code>cite</code> tool refuses anything that did not
					arrive over the network, so the bibliography lists what was cited and the library shows what
					was read — and the gap between the two is usually the most interesting thing on the screen.
				</p>
			</div>
		</section>

		<section class="sec">
			<h3 class="co-eyebrow">the one rule</h3>
			<blockquote class="rule-quote">
				Nothing is passed into the agent to make the X-ray work.
			</blockquote>
			<div class="co-prose body">
				<p>
					Every panel in the flank is folded out of what the run already publishes: tool results,
					token counts, the request bodies going over the wire. None of it is a side channel the
					agent was asked to fill in, which means none of it can be flattered — and it keeps working
					when the agent changes, which a diagram never does.
				</p>
				<p>
					That is the whole pedagogy. A readout of what <em>did</em> happen teaches more than a picture
					of what should.
				</p>
			</div>
		</section>

		<section class="sec">
			<h3 class="co-eyebrow">the stack</h3>
			<div class="co-prose body">
				<p>
					<strong>Mastra</strong> runs the agent — tools, memory, subagents, approval gates.
					<strong>SvelteKit</strong> is the app on both sides of the wire; the model key stays on
					the server, which is also why Colophon works from a network that filters AI providers.
					<strong>Neon</strong> holds what survives a thread: papers, digests, and the working
					memory that lets a new conversation still know who you are. <strong>Vercel</strong> deploys
					it.
				</p>
			</div>
		</section>

		<section class="sec">
			<h3 class="co-eyebrow">who made it</h3>
			<div class="co-prose body">
				<p>
					Built by <strong>Neo Mohsenvand</strong> at the MIT Media Lab, alongside
					<strong>harnessXray</strong>, which does the same for Deep Agents: the same visual
					language, a different set of instruments.
				</p>
			</div>

			<div class="links">
				<a class="link" href={REPO} target="_blank" rel="noreferrer noopener">
					<HugeiconsIcon icon={ICON.external} size={12} />
					<span>github.com/NeoVand/colophon</span>
				</a>
				<a class="link" href={SIBLING} target="_blank" rel="noreferrer noopener">
					<HugeiconsIcon icon={ICON.external} size={12} />
					<span>github.com/NeoVand/harnessXray</span>
				</a>
			</div>
		</section>
	</div>
</Sheet>

<style>
	.sheet {
		display: flex;
		flex-direction: column;
	}

	.mark {
		margin: 0;
		font-size: 1rem;
	}

	.tagline {
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}

	.sec {
		padding: 1.1rem 0;
	}
	.sec + .sec {
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}

	/* `.co-prose` sets a 34em measure for a page. A sheet is narrower than that
	   by design, so the measure is released and the size comes down a step —
	   the face and the rhythm are what carry the reading here, not the width. */
	.body {
		margin-top: 0.5rem;
		max-width: none;
		font-size: 0.9375rem;
		line-height: 1.6;
	}

	/* The claim the whole app rests on, given its own weight without a card:
	   one accent rule and the mono face the instruments are labelled in. */
	.rule-quote {
		margin: 0.6rem 0 0.2rem;
		padding: 0.15rem 0 0.15rem 0.75rem;
		border-left: 2px solid var(--co-accent);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--foreground);
		text-wrap: pretty;
	}

	.links {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 0.85rem;
	}

	.link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		text-decoration: none;
		transition: color 150ms ease;
	}
	.link:hover {
		color: var(--co-accent);
	}
</style>
