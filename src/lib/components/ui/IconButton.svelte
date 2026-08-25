<script lang="ts">
	import type { IconSvgElement } from '@hugeicons/svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import Tooltip from './Tooltip.svelte';

	/**
	 * The little button in a panel's header.
	 *
	 * Chrome that is not there until you look for it: transparent, muted, one
	 * glyph, no label and no border. A panel header is 1.85rem tall and already
	 * carries a name, sometimes tabs and usually a readout — anything with a box
	 * around it would win that competition and shouldn't.
	 *
	 * The name lives in the tooltip rather than beside the glyph, which is the
	 * trade this makes on purpose: an icon-only control is unreadable until
	 * hovered, so `label` is mandatory and does triple duty — tooltip, accessible
	 * name, and the thing that stops a decorative button from being added.
	 *
	 * Toggles say so. Leaving `active` undefined makes this a plain action and no
	 * `aria-pressed` is rendered; passing a boolean makes it a toggle, in which
	 * case `label` should name the *state* being toggled ("absolute tokens"),
	 * never the click ("switch to tokens") — a pressed button already says which
	 * way it is.
	 *
	 * Known cost: bits-ui's tooltip trigger is a focusable span, so a keyboard
	 * user tabs to the anchor and then to the button. Worth it — focus is also
	 * how the tooltip opens without a pointer, which is the only way these
	 * glyphs are readable at all from the keyboard.
	 */
	let {
		icon,
		label,
		onclick,
		active = undefined,
		disabled = false,
		size = 13
	}: {
		icon: IconSvgElement;
		/** Two or three words, lowercase. The accessible name and the tooltip. */
		label: string;
		onclick: () => void;
		/** Omit for an action; pass a boolean to make it a toggle. */
		active?: boolean;
		disabled?: boolean;
		size?: number;
	} = $props();
</script>

<Tooltip text={label} side="bottom">
	<button
		type="button"
		class="btn"
		class:on={active === true}
		aria-label={label}
		aria-pressed={active}
		{disabled}
		{onclick}
	>
		<HugeiconsIcon {icon} {size} />
	</button>
</Tooltip>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
		cursor: pointer;
		transition:
			color 150ms ease,
			background-color 150ms ease,
			opacity 150ms ease;
	}

	/* The hover wash is the only surface this control ever draws, and it draws it
	   only while the pointer is on it — a permanent tint would put five small
	   boxes in a header whose whole design is not having boxes. */
	.btn:hover:not(:disabled) {
		color: var(--foreground);
		background: color-mix(in oklab, var(--muted) 70%, transparent);
	}

	/* A pressed toggle takes the app's own accent rather than a panel tone: the
	   panel's colour says what subsystem you are in, and a lit button says you
	   changed something about the reading. Two different facts, two colours. */
	.btn.on {
		color: var(--co-accent);
	}

	.btn:disabled {
		opacity: 0.3;
		cursor: default;
	}
</style>
