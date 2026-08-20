<script lang="ts" module>
	import type { IconSvgElement } from '@hugeicons/svelte';

	export interface Tab {
		/** Must be unique across `tabs` — a duplicate key aborts the render. */
		id: string;
		label: string;
		icon?: IconSvgElement;
	}
</script>

<script lang="ts">
	import { Tabs } from 'bits-ui';
	import { HugeiconsIcon } from '@hugeicons/svelte';

	/**
	 * A row of tabs, underlined rather than boxed.
	 *
	 * This is the *bar* only — it owns which tab is current and nothing else, so
	 * the caller renders whatever the current tab means. Panels here are already
	 * separated by space and tone, and wrapping the content in a second box just
	 * to satisfy a tab widget would be exactly the furniture this app avoids.
	 *
	 * bits-ui is here for the keyboard: arrow keys move between tabs, Home and
	 * End jump to the ends, and the roving tabindex means the bar takes one stop
	 * rather than one per tab.
	 */
	let {
		tabs,
		active = $bindable(tabs[0]?.id ?? '')
	}: {
		tabs: Tab[];
		active?: string;
	} = $props();
</script>

<Tabs.Root bind:value={active}>
	<Tabs.List>
		{#snippet child({ props })}
			<div {...props} class="list">
				{#each tabs as tab (tab.id)}
					<Tabs.Trigger value={tab.id}>
						{#snippet child({ props: triggerProps })}
							<button {...triggerProps} class="tab">
								{#if tab.icon}
									<span class="ico"><HugeiconsIcon icon={tab.icon} size={12} /></span>
								{/if}
								<span>{tab.label}</span>
							</button>
						{/snippet}
					</Tabs.Trigger>
				{/each}
			</div>
		{/snippet}
	</Tabs.List>
</Tabs.Root>

<style>
	.list {
		display: flex;
		align-items: stretch;
		gap: 1.1rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}

	.tab {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0 0.4rem;
		border: 0;
		background: transparent;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		font-family: var(--font-mono);
		font-size: 0.5625rem;
		font-weight: 500;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		cursor: pointer;
		transition: color 180ms ease;
	}
	.tab:hover {
		color: var(--foreground);
	}
	.tab[data-state='active'] {
		color: var(--co-accent);
	}

	/* The underline sits *on* the list's hairline rather than above it, so the
	   active tab reads as a segment of that line being inked in. */
	.tab::after {
		content: '';
		position: absolute;
		inset: auto 0 -1px;
		height: 1px;
		background: transparent;
		transition: background-color 180ms ease;
	}
	.tab[data-state='active']::after {
		background: var(--co-accent);
	}

	.ico {
		display: inline-flex;
	}
</style>
