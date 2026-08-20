<script lang="ts">
	import { Collapsible } from 'bits-ui';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import type { Snippet } from 'svelte';

	/**
	 * A section that folds away, titled the way every panel here is titled: an
	 * eyebrow and a count, sitting directly on the page.
	 *
	 * The chevron rotates rather than swapping glyph, so the header is one thing
	 * that turns instead of two things that alternate — and because `open` is
	 * bindable, a caller can persist the fold without this component knowing
	 * anything about where it is stored.
	 */
	let {
		open = $bindable(false),
		label,
		count,
		children
	}: {
		open?: boolean;
		label: string;
		/** Shown beside the label. Say how many things are folded away, not how many exist. */
		count?: number;
		children?: Snippet;
	} = $props();
</script>

<Collapsible.Root bind:open>
	<Collapsible.Trigger>
		{#snippet child({ props })}
			<button {...props} class="head">
				<span class="chev" class:open aria-hidden="true">
					<HugeiconsIcon icon={ICON.collapse} size={12} />
				</span>
				<span class="co-eyebrow">{label}</span>
				{#if count !== undefined}
					<span class="co-num count">{count}</span>
				{/if}
			</button>
		{/snippet}
	</Collapsible.Trigger>

	<!--
		`hiddenUntilFound={false}` so a closed section is not in the DOM at all.
		The default keeps it mounted for the browser's find-in-page, which is a
		reasonable default for an article and the wrong one for a panel that may
		be folding away a thousand events.
	-->
	<Collapsible.Content hiddenUntilFound={false}>
		{#snippet child({ props })}
			<div {...props} class="body">{@render children?.()}</div>
		{/snippet}
	</Collapsible.Content>
</Collapsible.Root>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.3rem 0;
		border: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.head:hover .co-eyebrow {
		color: var(--foreground);
	}

	.chev {
		display: inline-flex;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		transition: transform 180ms ease;
	}
	.chev.open {
		transform: rotate(90deg);
	}

	.count {
		margin-left: auto;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	.body {
		padding: 0.15rem 0 0.4rem;
	}
</style>
