<script module lang="ts">
	import type { Component } from 'svelte';

	export interface PanelSpec {
		/** Stable across releases: it is what the saved order is written in terms of. */
		id: string;
		/** Shown as the eyebrow. Lowercase; the class uppercases it. */
		label: string;
		/** A `--co-*` legend name — 'library', 'memory', 'tool'. Not a colour. */
		tone?: string;
		/** Rendered with no props. */
		component: Component;
		/**
		 * Share of the leftover height, against the other open panels. The default
		 * of 1 is an even split; raise it for an instrument that is useless with
		 * three rows visible, lower it for one whose content is a fixed handful.
		 *
		 * `0` means something different in kind: size to content, and take no
		 * share at all. That is the right answer for a readout of fixed height —
		 * a bar, a tally — which would otherwise be handed a third of the column
		 * and fill it with nothing.
		 */
		grow?: number;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import { layout, mergeOrder } from '$lib/layout.svelte';

	/**
	 * The flank, as a stack you can rearrange.
	 *
	 * Which instrument matters is a property of what you are doing, not of what
	 * we guessed: someone debugging retrieval wants the event timeline at the
	 * top and the spend readout folded away, and someone watching cost wants the
	 * reverse. So the order is yours, the folds are yours, and both survive a
	 * reload.
	 *
	 * The arrangement itself lives in `layout.svelte.ts` rather than here. This
	 * component is a view: it renders whatever order the store holds and asks
	 * the store to change it. That is what lets a menu elsewhere hide a panel
	 * without this component knowing such a menu exists.
	 *
	 * Every handle is drawn at the weight of the labels around it and comes up
	 * only under the pointer, because these controls are used once a session and
	 * the readouts are looked at all day.
	 */

	let { panels }: { panels: PanelSpec[] } = $props();

	const ids = $derived(panels.map((p) => p.id));
	const byId = $derived(new Map(panels.map((p) => [p.id, p])));

	/**
	 * What to draw: the saved order reconciled with what is mounted, minus what
	 * is hidden.
	 *
	 * Derived from `mergeOrder` rather than straight from `layout.order` so the
	 * first frame is right even before the store has been seeded — otherwise a
	 * reader with an empty localStorage gets an empty flank until `onMount` runs.
	 *
	 * Resolving through `byId` is also what guarantees the `{#each}` keys are
	 * unique: the store de-duplicates on the way in, and anything it does not
	 * know about is dropped here rather than drawn twice. A duplicate key
	 * throws, and the throw aborts the render — the previous frame simply
	 * freezes on screen.
	 */
	const ordered = $derived(
		mergeOrder(layout.order, ids)
			.map((id) => byId.get(id))
			.filter((p): p is PanelSpec => p !== undefined && layout.isVisible(p.id))
	);

	/**
	 * Seeding the store is a write, so it waits for mount rather than running in
	 * an effect that also reads the order — that shape is
	 * `effect_update_depth_exceeded`, which this codebase has shipped twice.
	 * Nothing can be dragged before mount, so nothing is racing it.
	 */
	onMount(() => layout.ensure(ids));

	let dragId = $state<string | null>(null);
	let overId = $state<string | null>(null);
	/** Which half of the row the pointer is in — the line is drawn where the drop lands. */
	let overBefore = $state(false);

	function start(e: DragEvent, id: string) {
		dragId = id;
		overId = null;
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'move';
		// Firefox starts no drag at all without payload, however unused it is.
		e.dataTransfer.setData('text/plain', id);
	}

	function over(e: DragEvent & { currentTarget: HTMLElement }, id: string) {
		if (!dragId || id === dragId) return;
		// Without this the drop event never fires — the default action for
		// dragover is "refuse".
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const box = e.currentTarget.getBoundingClientRect();
		overId = id;
		overBefore = e.clientY < box.top + box.height / 2;
	}

	function drop(e: DragEvent) {
		e.preventDefault();
		if (dragId && overId && dragId !== overId) {
			// Index in the list *without* the dragged panel, which is the frame
			// `layout.move` inserts into.
			const rest = layout.order.filter((x) => x !== dragId);
			const target = rest.indexOf(overId);
			if (target !== -1) layout.move(dragId, overBefore ? target : target + 1);
		}
		end();
	}

	function end() {
		dragId = null;
		overId = null;
	}

	/** Reordering without a pointer. Same operation, no drag. */
	function nudge(e: KeyboardEvent, id: string) {
		const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
		if (!delta) return;
		e.preventDefault();
		layout.nudge(id, delta);
	}
</script>

<div class="stack">
	{#each ordered as panel (panel.id)}
		{@const open = !layout.isCollapsed(panel.id)}
		{@const share = panel.grow ?? 1}
		{@const Panel = panel.component}
		<section
			role="group"
			aria-label={panel.label}
			class="slot"
			class:open
			class:fill={open && share > 0}
			class:dragging={dragId === panel.id}
			class:before={overId === panel.id && overBefore}
			class:after={overId === panel.id && !overBefore}
			style:flex-grow={open ? share : 0}
			style:--tone={panel.tone ? `var(--co-${panel.tone})` : 'var(--muted-foreground)'}
			animate:flip={{ duration: 220 }}
			ondragover={(e) => over(e, panel.id)}
			ondrop={drop}
		>
			<header class="head">
				<button
					class="title"
					aria-expanded={open}
					aria-controls="stack-{panel.id}"
					onclick={() => layout.toggleCollapsed(panel.id)}
				>
					<span class="chev" class:open aria-hidden="true">
						<HugeiconsIcon icon={ICON.collapse} size={11} />
					</span>
					<span class="co-eyebrow">{panel.label}</span>
				</button>

				<!--
					The handle sits at the far end rather than in front of the label.
					A grip on the left has to be inset into the column's padding to
					keep the labels aligned, and the slot clips its own overflow — so
					the tidy version is the one that disappears.
				-->
				<button
					class="grip"
					draggable="true"
					aria-label="Reorder {panel.label} — or use the arrow keys"
					ondragstart={(e) => start(e, panel.id)}
					ondragend={end}
					onkeydown={(e) => nudge(e, panel.id)}
				>
					<span class="dots" aria-hidden="true"></span>
				</button>
			</header>

			{#if open}
				<div class="body" id="stack-{panel.id}">
					<Panel />
				</div>
			{/if}
		</section>
	{:else}
		<p class="quiet">Every instrument is hidden. Turn one back on from the panel menu.</p>
	{/each}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
	}

	.slot {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
		/* Content height is the resting shape — which is what a folded panel and a
		   `grow: 0` readout both want. `flex-grow` is set inline, per panel. */
		flex-shrink: 0;
		flex-basis: auto;
		padding-bottom: 0.35rem;
	}
	/* Only a panel that is taking a share of the column negotiates for height.
	   `flex-basis: 0` rather than `auto` is the load-bearing part: with `auto`
	   the basis is the content height, and a long list wins the negotiation
	   before it starts — which is how a twelve-paper search used to push the
	   event timeline off the bottom of the screen. */
	.slot.fill {
		flex-shrink: 1;
		flex-basis: 0;
	}

	/* Hairline between instruments, and nothing else. No card, no second
	   background: the eyebrow labels and the space already say these are
	   separate things. */
	.slot + .slot {
		border-top: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
		padding-top: 0.35rem;
	}

	.slot.dragging {
		opacity: 0.4;
	}

	/* Where the panel will land, drawn on the edge it will land against. */
	.slot.before::before,
	.slot.after::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 1px;
		background: var(--co-accent);
	}
	.slot.before::before {
		top: 0;
	}
	.slot.after::after {
		bottom: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex: none;
	}

	.grip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 0.9rem;
		height: 1.1rem;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: grab;
		/* Invisible until the row is approached: this is used once a session and
		   would otherwise be permanent furniture beside every label. Opacity
		   rather than display, so nothing shifts when it arrives. */
		opacity: 0;
		transition: opacity 150ms ease;
	}
	.grip:active {
		cursor: grabbing;
	}
	.head:hover .grip,
	.grip:focus-visible {
		opacity: 1;
	}

	/* Six dots, drawn rather than fetched — the icon set has no grip, and a
	   two-by-three dot field is the one shape nobody has to learn. Two columns
	   of three: the box is two cells wide and three tall, at one dot per cell. */
	.dots {
		width: 6px;
		height: 9px;
		background-image: radial-gradient(currentColor 0.75px, transparent 1px);
		background-size: 3px 3px;
		background-position: center;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	.title {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.15rem 0;
		border: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.title .co-eyebrow {
		color: color-mix(in oklab, var(--tone) 70%, var(--muted-foreground));
		transition: color 150ms ease;
	}
	.title:hover .co-eyebrow {
		color: var(--tone);
	}

	/* One glyph that turns, rather than two that alternate. */
	.chev {
		display: inline-flex;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
		transition: transform 180ms ease;
	}
	.chev.open {
		transform: rotate(90deg);
	}

	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding-top: 0.3rem;
	}
	/*
		The panel's own root is what has to do the growing and the scrolling.
		Sizing it from here rather than inside each panel keeps the fact that
		these share a column out of components that know nothing about columns.
	*/
	.body > :global(*) {
		flex: 1;
		min-height: 0;
	}

	.quiet {
		margin: 0;
		font-size: 0.75rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}
</style>
