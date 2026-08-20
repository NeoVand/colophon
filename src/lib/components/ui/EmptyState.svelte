<script lang="ts">
	import type { IconSvgElement } from '@hugeicons/svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';

	/**
	 * What a panel says before it has anything to show.
	 *
	 * These are not placeholders and they are not apologies. An empty panel is
	 * the *first* thing anyone sees, every session, before a single token is
	 * spent — so it is the best teaching surface in the application and the one
	 * most often wasted on the word "empty".
	 *
	 * Each one answers two questions: what lands here, and why that is
	 * interesting. "Nothing written yet" is the first half. "A channel in the
	 * graph's state, not a disk — which is why it survives a reload" is the half
	 * that teaches, and it is the half worth writing.
	 *
	 * The icon is large, outlined and dim on purpose: it gives the panel a
	 * centre of gravity while it is empty, and it should be the first thing to
	 * disappear from attention once content arrives.
	 */
	let {
		icon,
		title,
		note,
		tone = 'accent'
	}: {
		icon?: IconSvgElement;
		/** One line. What lands here. */
		title: string;
		/** One or two sentences. Why it matters. */
		note?: string;
		tone?: string;
	} = $props();
</script>

<div class="empty" style:--tone="var(--co-{tone})">
	{#if icon}
		<span class="glyph" aria-hidden="true"><HugeiconsIcon {icon} size={44} /></span>
	{/if}
	<p class="title">{title}</p>
	{#if note}<p class="note">{note}</p>{/if}
</div>

<style>
	.empty {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		padding: 1.5rem 1.75rem;
		text-align: center;
	}

	/* Dim enough to be furniture, tinted enough to belong to this panel. */
	.glyph {
		display: inline-flex;
		margin-bottom: 0.7rem;
		color: color-mix(in oklab, var(--tone) 22%, transparent);
	}

	.title {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 500;
		color: color-mix(in oklab, var(--foreground) 70%, transparent);
		text-wrap: balance;
	}

	.note {
		margin: 0;
		max-width: 26em;
		font-size: 0.75rem;
		line-height: 1.55;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		text-wrap: pretty;
	}
</style>
