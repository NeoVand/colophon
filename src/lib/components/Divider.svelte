<script lang="ts">
	import { PaneResizer } from 'paneforge';

	/**
	 * The seam between two panes.
	 *
	 * A hairline that thickens and takes the accent when you approach it, rather
	 * than a fat grey bar sitting there permanently. There are five of these in
	 * the layout; drawn at their resting weight they would be five more rules on
	 * a surface whose whole design is "separation comes from space".
	 *
	 * The trick is that the *hit area* is much larger than the line. The line is
	 * 1px; the grab target is 7px, centred on it via a transparent padding box.
	 * A 1px drag target is a usability bug, and a 7px visible line is furniture —
	 * this is how you get neither.
	 */
	let { direction = 'horizontal' }: { direction?: 'horizontal' | 'vertical' } = $props();
</script>

<PaneResizer class="co-divider co-divider-{direction}" />

<style>
	/*
		`:global` because the class lands on paneforge's own element, which Svelte
		does not stamp with this component's scoping hash — a scoped selector here
		matches nothing and is silently pruned.
	*/
	:global(.co-divider) {
		position: relative;
		flex: none;
		background: transparent;
		transition: background-color 160ms ease;
	}

	:global(.co-divider-horizontal) {
		width: 7px;
		margin: 0 -3px;
		cursor: col-resize;
	}
	:global(.co-divider-vertical) {
		height: 7px;
		margin: -3px 0;
		cursor: row-resize;
	}

	/* The line itself: one pixel, centred in the target. */
	:global(.co-divider)::after {
		content: '';
		position: absolute;
		background: color-mix(in oklab, var(--border) 55%, transparent);
		transition:
			background-color 160ms ease,
			transform 160ms ease;
	}
	:global(.co-divider-horizontal)::after {
		inset: 0 3px;
	}
	:global(.co-divider-vertical)::after {
		inset: 3px 0;
	}

	:global(.co-divider:hover)::after,
	:global(.co-divider[data-active])::after {
		background: color-mix(in oklab, var(--co-accent) 65%, transparent);
	}

	/* Only while actually dragging does it get visibly heavier — hovering past a
	   seam on the way somewhere else should not make the layout twitch. */
	:global(.co-divider[data-active='pointer'])::after {
		background: var(--co-accent);
	}

	:global(.co-divider:focus-visible) {
		outline: 2px solid var(--co-focus);
		outline-offset: -1px;
	}
</style>
