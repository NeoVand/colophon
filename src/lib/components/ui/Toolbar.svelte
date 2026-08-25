<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A row of `IconButton`s, sized to sit in a `PanelFrame`'s actions snippet.
	 *
	 * Barely a component, and that is the intent: it exists so every panel's
	 * tools sit on the same rhythm rather than each header inventing its own gap.
	 *
	 * Groups, when a panel has tools that answer different questions. The
	 * hairline between them is not decoration — it is the difference between
	 * "four buttons" and "two that change the reading, two that take something
	 * out of the app", which is the distinction a person needs before they dare
	 * press one. One group needs no rule, so `children` is the plain case.
	 */
	let {
		children,
		groups
	}: {
		/** A single group. The common case. */
		children?: Snippet;
		/** Two or more groups, separated by a hairline. */
		groups?: Snippet[];
	} = $props();
</script>

<div class="bar">
	{#if groups?.length}
		<!-- Keyed by index: snippets are opaque values with nothing to key on, and
		     the array is written literally at the call site rather than derived
		     from data, so position *is* identity here. -->
		{#each groups as group, i (i)}
			{#if i > 0}<span class="sep" aria-hidden="true"></span>{/if}
			{@render group()}
		{/each}
	{:else}
		{@render children?.()}
	{/if}
</div>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 0.05rem;
	}

	.sep {
		flex: none;
		width: 1px;
		height: 0.85rem;
		margin: 0 0.25rem;
		background: color-mix(in oklab, var(--border) 60%, transparent);
	}
</style>
