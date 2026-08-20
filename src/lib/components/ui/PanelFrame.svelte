<script lang="ts" module>
	import type { IconSvgElement } from '@hugeicons/svelte';

	export interface PanelTab {
		id: string;
		label: string;
		icon?: IconSvgElement;
		/** A small count beside the label. Omitted when zero. */
		count?: number;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';

	/**
	 * The frame every panel in the X-ray wears.
	 *
	 * One component, because the alternative is what shipped first: eight panels
	 * each drawing their own header slightly differently, in a stack with no
	 * shared rhythm, which reads as a settings page rather than an instrument.
	 *
	 * The anatomy is fixed and deliberately small:
	 *
	 *   ⊞ LABEL   TAB  TAB          ⋯ actions
	 *   ────────────────────────────────────  ← hairline, the only rule
	 *   content
	 *
	 * An icon and an uppercase mono label in the panel's own subsystem colour.
	 * Tabs, when a panel has more than one reading of the same thing — a tab is
	 * for *the same subject seen differently*, never for unrelated content, which
	 * is what a tab bar becomes the moment it is used as navigation.
	 *
	 * No border around the panel. The hairline under the header and the space
	 * around it are the separation; a box would make eight of these a form.
	 */
	let {
		label,
		icon,
		/** A `--co-*` name — 'library', 'tool'. Not a colour. */
		tone = 'accent',
		tabs = [],
		active = $bindable(''),
		/** A short readout in the header's right, before any actions. */
		readout,
		/**
		 * Render only the body.
		 *
		 * For a panel hosted inside another frame's tab group: the group already
		 * draws the header, and two headers stacked is exactly the "SPEND SPEND"
		 * bug in a new costume. A bare panel loses its own readout and actions —
		 * so tab a panel only when the group's header can say what it needs to.
		 */
		bare = false,
		actions,
		children
	}: {
		label: string;
		icon?: IconSvgElement;
		tone?: string;
		tabs?: PanelTab[];
		active?: string;
		readout?: string;
		bare?: boolean;
		actions?: Snippet;
		children: Snippet;
	} = $props();

	// A panel given tabs but no chosen one shows the first, rather than nothing.
	$effect.pre(() => {
		if (tabs.length && !tabs.some((t) => t.id === active)) active = tabs[0].id;
	});
</script>

<section class="panel" style:--tone="var(--co-{tone})">
	{#if !bare}
		<header>
			{#if icon}
				<span class="glyph" aria-hidden="true"><HugeiconsIcon {icon} size={12} /></span>
			{/if}
			<span class="co-eyebrow name">{label}</span>

			{#if tabs.length}
				<div class="tabs" role="tablist" aria-label={label}>
					{#each tabs as tab (tab.id)}
						<button
							role="tab"
							aria-selected={active === tab.id}
							class="tab co-eyebrow"
							class:on={active === tab.id}
							onclick={() => (active = tab.id)}
						>
							{tab.label}{#if tab.count}<span class="co-num count">{tab.count}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}

			<div class="spacer"></div>
			{#if readout}<span class="co-num readout">{readout}</span>{/if}
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</header>
	{/if}

	<div class="body">{@render children()}</div>
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		height: 100%;
		overflow: hidden;
	}

	header {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		height: 1.85rem;
		padding: 0 0.5rem 0 0.7rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
	}

	/* The label carries the subsystem's colour; the icon carries it at half
	   strength so the pair reads as one object rather than two marks. */
	.glyph {
		display: inline-flex;
		color: color-mix(in oklab, var(--tone) 60%, transparent);
	}
	.name {
		color: var(--tone);
	}

	.tabs {
		display: flex;
		align-items: center;
		gap: 0.1rem;
		margin-left: 0.5rem;
	}
	.tab {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		border: 0;
		background: transparent;
		padding: 0.1rem 0.3rem;
		border-radius: 2px;
		cursor: pointer;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		transition: color 150ms ease;
	}
	.tab:hover {
		color: var(--muted-foreground);
	}
	/* The active tab takes the panel's own tone rather than a generic accent, so
	   a glance at any header says which subsystem you are looking at. */
	.tab.on {
		color: var(--tone);
	}
	.count {
		font-size: 0.5625rem;
		opacity: 0.7;
	}

	.spacer {
		flex: 1;
	}

	.readout {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.1rem;
	}

	.body {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
</style>
