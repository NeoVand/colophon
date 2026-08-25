<script lang="ts">
	import { tick } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import Prose from '$lib/components/Prose.svelte';
	import ToolCallCard from './ToolCallCard.svelte';
	import ApprovalCard from './ApprovalCard.svelte';
	import OutlineCard, { type Outline } from './OutlineCard.svelte';
	import Preamble from './Preamble.svelte';

	/**
	 * The conversation.
	 *
	 * No bubbles on the assistant's side and no avatars anywhere. What Colophon
	 * writes is a document — a review, a digest, a set of notes — and putting a
	 * document in a chat bubble makes it look like a message about a document.
	 * Your own turn gets a faint wash so the alternation is still readable at a
	 * glance, which is the only thing bubbles were doing.
	 */

	let scroller = $state<HTMLDivElement>();

	/**
	 * Follow the stream only while the reader is already near the bottom.
	 *
	 * Yanking the view back down while someone is reading an earlier answer is
	 * the single most annoying thing a streaming chat can do.
	 */
	async function follow() {
		if (!scroller) return;
		const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
		if (!atBottom) return;
		await tick();
		scroller.scrollTop = scroller.scrollHeight;
	}

	// Re-runs whenever the stream appends anything: the event count is the
	// cheapest thing that changes on every chunk.
	$effect(() => {
		void session.events.length;
		follow();
	});
</script>

<div bind:this={scroller} class="scroller">
	<div class="column">
		{#if session.turns.length === 0}
			<Preamble onask={(q) => session.send(q)} />
		{/if}

		{#each session.turns as turn, i (i)}
			<article class="turn" class:you={turn.role === 'you'}>
				<p class="co-eyebrow role" class:you-ink={turn.role === 'you'}>{turn.role}</p>

				{#if turn.tools.length}
					<ul class="tools">
						{#each turn.tools as tool (tool.id)}
							<li><ToolCallCard {tool} /></li>
						{/each}
					</ul>
				{/if}

				{#if turn.thinking}
					<p class="thinking co-eyebrow">thinking…</p>
				{/if}

				{#if turn.text}
					{#if turn.role === 'you'}
						<p class="said">{turn.text}</p>
					{:else}
						<Prose text={turn.text} />
					{/if}
				{/if}

				{#if turn.approval}
					<!--
						An outline is the one approval whose arguments the reader may
						rewrite, so it gets its own card. Everything else is approve or
						decline on the literal brief the model wrote.
					-->
					{#if turn.approval.name === 'present_outline'}
						{@const outline = turn.approval.args as Outline}
						<OutlineCard
							title={outline?.title ?? ''}
							sections={outline?.sections ?? []}
							onapprove={(edited) => session.decide(turn, true, edited)}
							ondecline={() => session.decide(turn, false)}
						/>
					{:else}
						<ApprovalCard {turn} ondecide={(ok) => session.decide(turn, ok)} />
					{/if}
				{/if}

				{#if turn.error}
					<p class="error">{turn.error}</p>
				{/if}

				{#if turn.usage?.total}
					<p class="usage co-num">
						{turn.usage.input.toLocaleString()} in · {turn.usage.output.toLocaleString()} out{turn
							.usage.reasoning
							? ` · ${turn.usage.reasoning.toLocaleString()} reasoning`
							: ''}{turn.usage.cached ? ` · ${turn.usage.cached.toLocaleString()} cached` : ''}
					</p>
				{/if}
			</article>
		{/each}
	</div>
</div>

<style>
	.scroller {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		/* Overscroll containment stops a flick at the end of the conversation from
		   scrolling the page behind it, which on a trackpad reads as the layout
		   coming apart. */
		overscroll-behavior: contain;
	}

	.column {
		/* The right inset pays back the scrollbar gutter so the column looks
		   centred rather than nudged left. */
		padding: 2rem 1.5rem 2rem calc(1.5rem + var(--co-gutter));
		max-width: 46rem;
		margin: 0 auto;
	}

	.turn {
		margin-bottom: 1.75rem;
	}

	.role {
		margin: 0 0 0.4rem;
	}
	.role.you-ink {
		color: color-mix(in oklab, var(--co-user) 70%, var(--muted-foreground));
	}

	/* Your words, on a wash rather than in a bubble. The hairline defines the
	   shape far more cheaply than a heavier fill would. */
	.turn.you .said {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--co-you-edge);
		border-radius: var(--radius-sm);
		background: var(--co-you-wash);
		color: var(--foreground);
		font-size: 0.95rem;
		line-height: 1.55;
		white-space: pre-wrap;
	}

	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0 0 0.5rem;
		padding: 0;
		list-style: none;
	}

	.thinking {
		margin: 0;
		color: var(--co-model);
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.45;
		}
		50% {
			opacity: 1;
		}
	}

	.error {
		margin: 0.5rem 0 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid color-mix(in oklab, var(--co-error) 35%, transparent);
		border-radius: 3px;
		background: color-mix(in oklab, var(--co-error) 7%, transparent);
		color: var(--co-error);
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.usage {
		margin: 0.6rem 0 0;
		font-size: 0.6875rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}
</style>
