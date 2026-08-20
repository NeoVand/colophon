<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * One instrument. No border, no card, no box.
	 *
	 * Ported from harnessXray, where the first cockpit drew a bordered frame
	 * around every panel and produced eleven rectangles in a grid — a bento box,
	 * not a cockpit. Borders are how you say "these things are separate" when the
	 * things themselves cannot say it; a ring, a ribbon and a field of dots are
	 * already obviously three different objects, and a line around each one only
	 * adds more lines to a screen that is trying to look like an instrument panel.
	 *
	 * So separation comes from space and from tone, exactly as `docs/UI.md`
	 * requires. Each instrument is a `.co-eyebrow` in its subsystem's colour and a
	 * drawing beneath it, sitting directly on the page. The label is the only
	 * chrome.
	 *
	 * The body is a plain flex child with `min-height: 0`, which is what lets a
	 * gauge inside it size to the box rather than to its own content — the whole
	 * premise of the mode is that nothing in here scrolls.
	 */
	interface Props {
		label: string;
		/** A `--co-*` custom property name — the subsystem's own colour. */
		tone: string;
		/** A short readout beside the label. Numbers, not sentences. */
		readout?: string;
		/** Lifts the label when this instrument is doing something right now. */
		live?: boolean;
		/**
		 * Share of the row this instrument takes, as a flex grow factor.
		 *
		 * Here rather than on a wrapper in `Cockpit` because the alternative was a
		 * `:global(*:first-child)` rule reaching through a component boundary to
		 * weight one child of a flex row — the kind of selector that breaks the
		 * next time the markup gains a wrapper. The anchor asks to be the anchor.
		 */
		grow?: number;
		children: Snippet;
	}
	let { label, tone, readout, live = false, grow = 1, children }: Props = $props();
</script>

<section class="inst" class:live style:--tone="var({tone})" style:--grow={grow}>
	<header>
		<span class="co-eyebrow">{label}</span>
		{#if readout}<span class="co-num readout">{readout}</span>{/if}
	</header>
	<div class="body">{@render children()}</div>
</section>

<style>
	.inst {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
		min-height: 0;
		/* `0` basis, never `auto`: an instrument sized from its content is an
		   instrument that pushes its neighbours out of the box, and the one rule
		   the cockpit has is that nothing scrolls. */
		flex: var(--grow, 1) 1 0;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex: none;
		min-width: 0;
		padding-left: 1px;
		/* Resting at 55%, so a screen of ten labels reads as texture rather than
		   as ten competing headings. The instrument is the content. */
		color: color-mix(in oklab, var(--tone) 55%, transparent);
		transition: color 240ms ease;
	}
	.live header {
		color: var(--tone);
	}

	/* `.co-eyebrow` sets its own colour in `@layer base`; an unlayered component
	   rule beats it whatever the specificity, so the tone above wins here. */
	header .co-eyebrow {
		color: inherit;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.readout {
		margin-left: auto;
		flex: none;
		font-size: 0.5625rem;
		opacity: 0.85;
	}

	.body {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
</style>
