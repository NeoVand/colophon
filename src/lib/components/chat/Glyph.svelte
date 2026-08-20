<script lang="ts">
	/**
	 * The printer's device.
	 *
	 * A colophon is the note at the back of a book saying how it was made, and
	 * for four centuries it carried a *mark* — the printer's own device, struck
	 * on the last leaf the way a maker signs work. The commonest of them was the
	 * merchant's orb-and-cross: a figure-four staff standing on a banded globe.
	 * That is what this draws. It is the oldest symbol in the trade for "here is
	 * who made this, and how", which is the claim this app makes about its own
	 * output.
	 *
	 * Deliberately not a robot and not a sparkle. Those say "a model was
	 * involved", which is the least interesting fact about anything on screen.
	 *
	 * ── Geometry, because the numbers look arbitrary and are not ──────────────
	 * The staff stops at y=11, which is the orb's north pole (16 − 5), so it
	 * stands *on* the globe. The first draft ran it through to the south pole
	 * instead, and the stave plus the band drew an equal cross inside a circle —
	 * which is the astronomical symbol for Earth, ♁, and read as a planet rather
	 * than as a maker's mark.
	 *
	 * The four's counter sits left of the stave and its crossbar overhangs to the
	 * right, which is what makes the shape legible as a numeral rather than as a
	 * pennant. Checked by rendering: it still resolves at 16px.
	 *
	 * The 24-unit box and the 1.5 default stroke match the Hugeicons stroke set,
	 * so this sits correctly beside any `ICON.*` at the same size.
	 */
	let {
		size = 28,
		/** Thinner reads better when the mark is set large; 1.5 matches ICON.*. */
		strokeWidth = 1.5
	}: {
		size?: number;
		strokeWidth?: number;
	} = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<!-- The staff, head to the orb's pole. -->
	<path d="M12 1.9V11" />
	<!-- The figure four: crossbar, then the counter closing on the staff's head. -->
	<path d="M6.6 7.3H17.4" />
	<path d="M6.6 7.3 12 1.9" />
	<!-- The orb, and its band. -->
	<circle cx="12" cy="16" r="5" />
	<path d="M7 16h10" />
</svg>

<style>
	svg {
		display: block;
	}
</style>
