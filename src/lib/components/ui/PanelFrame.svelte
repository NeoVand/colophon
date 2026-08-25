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
	import Menu from './Menu.svelte';
	import { fitTabs } from '$lib/xray/tabs';

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

	/* ── the tab strip, which admits when it does not fit ──────────────────────
	 *
	 * The harness panel carries seven tabs. On a pane dragged narrow, `mcp` and
	 * `trace` simply ran off the right edge and were unreachable — and nothing
	 * said so, which is the same failure as a panel wired to nothing: a control
	 * that is silently absent.
	 *
	 * Two obvious escapes are both wrong here. Horizontal scrolling hides the
	 * overflow behind a gesture nobody makes on a desktop instrument, and
	 * dropping to icons-only throws away the labels that make an unfamiliar
	 * panel findable. So: show what fits, and put the rest behind one `⋯` that
	 * exists only when something is actually hidden. The arithmetic — including
	 * why the active tab is never the one hidden — is in `$lib/xray/tabs`, where
	 * it can be tested; this file only measures and draws.
	 *
	 * A hidden twin of the strip supplies the natural widths, because the
	 * rendered strip cannot: its width is already the answer.
	 *
	 * The widths update through `bind:clientWidth`, which is a `ResizeObserver`.
	 * Worth knowing when verifying: the in-app preview browser does not deliver
	 * ResizeObserver callbacks at all — not even for a direct style change — so
	 * dragging a divider there will not reflow the strip. A reload at the new
	 * width measures correctly, and a real browser needs neither.
	 */
	let stripW = $state(0);
	/** Natural widths in `tabs` order, read off the measuring twin. */
	let natural = $state<number[]>([]);
	let moreW = $state(0);

	/** Matches the strip's own `gap`, in px. */
	const GAP = 2;

	const fit = $derived(
		fitTabs(tabs, {
			widths: natural,
			available: stripW,
			moreWidth: moreW,
			gap: GAP,
			activeIndex: tabs.findIndex((t) => t.id === active)
		})
	);

	const overflow = $derived(
		fit.hidden.map((t) => ({
			id: t.id,
			label: t.label,
			icon: t.icon,
			selected: active === t.id,
			onselect: () => (active = t.id)
		}))
	);

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
				<div class="strip" bind:clientWidth={stripW}>
					<div class="tabs" role="tablist" aria-label={label}>
						{#each fit.shown as tab (tab.id)}
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

						{#if overflow.length}
							<Menu items={overflow} align="start">
								{#snippet trigger()}
									<span class="co-eyebrow more" title="{overflow.length} more">⋯</span>
								{/snippet}
							</Menu>
						{/if}
					</div>

					<!--
						The measuring twin: the same strip at its natural width, taken out
						of flow and hidden from everything that reads the page. It is what
						`fit` is computed from — the rendered strip cannot be measured for
						this, because its width is already the answer.
					-->
					<div class="ghost" aria-hidden="true">
						{#each tabs as tab, i (tab.id)}
							<span class="tab co-eyebrow" bind:clientWidth={natural[i]}>
								{tab.label}{#if tab.count}<span class="co-num count">{tab.count}</span>{/if}
							</span>
						{/each}
						<span class="co-eyebrow more" bind:clientWidth={moreW}>⋯</span>
					</div>
				</div>
			{/if}

			<!-- The strip already fills the gap when there are tabs; a second
			     spacer beside it would halve the room they are measured against. -->
			{#if !tabs.length}<div class="spacer"></div>{/if}
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

	/*
		The strip is the header's spacer, and that is what makes the measurement
		stable rather than circular.
	
		Sized to *fill* the room left over — `flex: 1 1 auto` — so `stripW` is the
		space available to tabs, not the width of the tabs currently shown. Sized
		to its content instead, the two chase each other: hiding a tab narrows the
		strip, which narrows the budget, which hides another. Shipped that way for
		one frame and the events panel collapsed to a bare `⋯` with all three tabs
		in the menu.
	*/
	.strip {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
		margin-left: 0.5rem;
	}

	.tabs {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	/* Out of flow, unmeasured by the layout, unreadable by a screen reader — but
	   still laid out, which is the whole point: it is the only place the tabs'
	   natural widths exist. */
	.ghost {
		position: absolute;
		top: 0;
		left: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		visibility: hidden;
		pointer-events: none;
		white-space: nowrap;
	}

	.more {
		display: inline-block;
		padding: 0 0.15rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		line-height: 1;
	}
	/* `:global` wraps the whole sequence because the hover target is `Menu`'s own
	   button, which Svelte does not stamp with this file's scoping hash — and a
	   `:global()` in the middle of a selector is not allowed. */
	:global(.strip .trigger:hover .more),
	:global(.strip .trigger.on .more) {
		color: var(--tone);
	}
	.tab {
		display: inline-flex;
		align-items: baseline;
		flex: none;
		white-space: nowrap;
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
