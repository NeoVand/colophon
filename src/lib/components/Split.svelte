<script lang="ts">
	import { Pane, PaneGroup, PaneResizer, type PaneAPI } from 'paneforge';
	import { browser } from '$app/environment';
	import { FLANK_KEY } from '$lib/layout.svelte';
	import type { Snippet } from 'svelte';

	/**
	 * Two columns and the line between them.
	 *
	 * The line is the whole design problem. A splitter that announces itself is
	 * a grey bar down the middle of a reading application, permanently, in
	 * exchange for a gesture used twice a week — so at rest this is exactly the
	 * hairline the flank already had, indistinguishable from a border. It thickens
	 * and takes the accent only when the pointer is on it or a drag is under way.
	 * You find it by going where a border is and discovering it moves.
	 *
	 * Double-click puts it back. Any control that can be dragged to somewhere
	 * useless needs a way home that is not "guess the original number".
	 */

	let {
		left,
		right,
		defaultSize = 26,
		minSize = 16,
		maxSize = 52,
		storageKey = FLANK_KEY,
		onresize
	}: {
		left: Snippet;
		right: Snippet;
		/**
		 * The **right** pane's share of the width, in percent — this component
		 * exists to size a flank, and the left pane is whatever is left over.
		 */
		defaultSize?: number;
		/**
		 * How narrow the right pane may get before the drag stops following the
		 * pointer. Below about a sixth of the window it is no longer an
		 * instrument panel, it is a column of truncation.
		 */
		minSize?: number;
		/**
		 * And how wide. The left pane's floor is the complement of this, so the
		 * two constraints can never disagree. Matches the clamp in
		 * `layout.svelte.ts`: a width the store would refuse cannot be dragged to.
		 */
		maxSize?: number;
		/**
		 * Where the right pane's percent is written. Defaults to the flank's key,
		 * which is the same one `layout.svelte.ts` reads — so the width survives a
		 * reload whether or not anything wired `onresize`. A second Split needs
		 * its own key.
		 */
		storageKey?: string;
		/** Fires with the right pane's percent whenever it changes, drag included. */
		onresize?: (percent: number) => void;
	} = $props();

	/**
	 * Read once, at init, deliberately.
	 *
	 * A pane's `defaultSize` is consumed when the pane registers itself on mount,
	 * so the saved width has to be in hand before the first paint or the column
	 * visibly snaps from the default to the saved value. Reading it in `onMount`
	 * and resizing afterwards is that snap.
	 */
	function saved(): number {
		if (!browser || !storageKey) return defaultSize;
		const n = Number(localStorage.getItem(storageKey));
		return Number.isFinite(n) && n >= minSize && n <= maxSize ? n : defaultSize;
	}
	const initial = saved();

	let size = $state(initial);
	let rightPane = $state<PaneAPI | null>(null);

	let timer: ReturnType<typeof setTimeout> | undefined;

	function layoutChanged(layout: number[]) {
		const next = layout[1];
		if (next === undefined) return;
		size = next;
		onresize?.(next);

		if (!browser || !storageKey) return;
		// A drag reports every frame. localStorage is synchronous and shared with
		// the rest of the origin, so only the size you settle on gets written.
		clearTimeout(timer);
		const key = storageKey;
		timer = setTimeout(() => {
			try {
				localStorage.setItem(key, String(Math.round(next * 100) / 100));
			} catch {
				// Private browsing, or a full quota. The column still works.
			}
		}, 200);
	}

	// `resize` rather than the group's `setLayout`: it goes through the same
	// constraint solver a drag does, and it reports the result, so the reset is
	// persisted like any other move.
	const reset = () => rightPane?.resize(defaultSize);
</script>

<PaneGroup direction="horizontal" onLayoutChange={layoutChanged} style="flex: 1 1 0; min-width: 0;">
	<Pane defaultSize={100 - initial} minSize={100 - maxSize}>
		<div class="pane">{@render left()}</div>
	</Pane>

	<PaneResizer
		ondblclick={reset}
		aria-label="Resize the flank — double-click to reset"
		aria-orientation="vertical"
		aria-valuemin={minSize}
		aria-valuemax={maxSize}
		aria-valuenow={Math.round(size)}
	>
		{#snippet child({ props })}
			<div {...props} class="divider"></div>
		{/snippet}
	</PaneResizer>

	<Pane bind:this={rightPane} defaultSize={initial} {minSize} {maxSize}>
		<div class="pane">{@render right()}</div>
	</Pane>
</PaneGroup>

<style>
	.pane {
		height: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/*
		The hit area is nine pixels; the mark inside it is one. Anything narrower
		is a pointer-precision test, and anything wider *looks* like a gutter,
		which is the thing this is trying not to be.
	*/
	.divider {
		position: relative;
		flex: none;
		width: 9px;
		align-self: stretch;
	}

	.divider::after {
		content: '';
		position: absolute;
		inset: 0 auto;
		left: 50%;
		width: 1px;
		/* Grow from the centre line, so thickening reads as the *same* line
		   getting stronger rather than a new element appearing beside it. */
		transform: translateX(-50%);
		background: color-mix(in oklab, var(--border) 60%, transparent);
		transition:
			width 160ms ease,
			background-color 160ms ease;
	}

	.divider:hover::after,
	.divider:focus-visible::after {
		width: 2px;
		background: color-mix(in oklab, var(--co-accent) 65%, transparent);
	}

	/* Set by paneforge for the length of a pointer drag or a keyboard resize —
	   the one moment the line should be unambiguous. */
	.divider[data-active]::after {
		width: 2px;
		background: var(--co-accent);
	}
</style>
