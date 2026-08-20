<script lang="ts">
	import { session } from '$lib/agent/session.svelte';
	import { bands, type Part, type PartKind } from '$lib/agent/context';
	import { tokens } from '$lib/xray/format';

	/**
	 * What the model is about to be sent, as a ring.
	 *
	 * `ContextPanel` is the better instrument for asking why a request costs what
	 * it does — it is a sorted ledger with a caveat at the bottom, and that is
	 * exactly right for auditing. It is the wrong shape for *watching*: it
	 * scrolls, and the question while a run is going is narrower and constant —
	 * what is filling the window right now.
	 *
	 * One arc per band, swept in payload order rather than sorted, so the ring is
	 * a picture of the actual request instead of a chart about it. The key beside
	 * it is sorted largest-first, because the useful reading there is which one
	 * or two bands dominate.
	 *
	 * ── The empty ring is still a ring ──────────────────────────────────────
	 * This used to swap the whole drawing for the words `nothing sent yet`, which
	 * meant the instrument a fresh page shows first was a five-word caption in an
	 * empty box. A gauge that vanishes when its reading is zero teaches you to
	 * distrust the screen rather than the run.
	 *
	 * The track circle is drawn unconditionally now and the arcs paint onto it,
	 * so zero is a reading — an unfilled ring, an em dash, `idle` — in the same
	 * shape the loaded state uses. Nothing moves when the first request lands
	 * except the parts that measured something.
	 *
	 * ── Why there is no headroom arc ────────────────────────────────────────
	 * harnessXray's ring sweeps the model's input *limit*, so the unpainted part
	 * of the circle is the room left. Colophon cannot honestly draw that: the
	 * model is built server-side (`src/lib/server/model.ts` reads a private env
	 * var) and the browser is never told which one answered, let alone what its
	 * window is. A ring normalised against a guessed limit would put a fabricated
	 * number in the most prominent position on the instrument, which is the one
	 * failure this app exists to make visible. So the ring is the request, whole.
	 */

	/* The legend, as `ContextPanel` assigns it. Repeated rather than shared
	   because a gauge that imports a panel's private map is coupled to a panel. */
	const TONE: Record<string, string> = {
		system: '--co-memory',
		'tool-schema': '--co-tool',
		user: '--co-user',
		assistant: '--co-model',
		'tool-call': '--co-tool',
		'tool-result': '--co-library',
		'reasoning-ref': '--co-subagent',
		other: '--co-gate'
	};

	const ctx = $derived(session.context);

	/**
	 * Billed input tokens for *this* request, not for the turn.
	 *
	 * Zero between a context arriving and its step landing, and shown as an em
	 * dash rather than `0` — nothing has been billed for this call yet, and a
	 * zero there would read as a measurement.
	 */
	const billed = $derived(session.contextTokens);

	const merged = $derived(ctx ? bands(ctx.parts as Part[]) : []);

	const R = 38;
	const C = 2 * Math.PI * R;

	/** Each band with the point on the circle it starts at. Payload order. */
	const arcs = $derived.by(() => {
		let at = 0;
		return merged.map((b) => {
			const arc = { ...b, offset: at };
			at += b.share;
			return arc;
		});
	});

	/* Four rows at most. The key is a caption, not a table — the panel already
	   has the table, and a list long enough to need scrolling would break the one
	   rule the cockpit has. */
	const key = $derived([...merged].sort((a, b) => b.chars - a.chars).slice(0, 4));
	const rest = $derived(Math.max(0, merged.length - key.length));

	const toneOf = (kind: PartKind) => `var(${TONE[kind] ?? '--co-gate'})`;

	/**
	 * The gauge's own width, which decides whether the key gets to exist.
	 *
	 * The flank runs from about 400px to 1200px and this instrument takes a share
	 * of a shared row, so its box can be 150px or 500px. Below the threshold the
	 * key is four rows of clipped mono that name nothing; above it the key is
	 * what stops a wide box being a circle with a dead margin beside it. Measured
	 * rather than guessed from a media query, because the breakpoint that matters
	 * is this element's width and not the window's.
	 */
	let boxW = $state(0);
	const showKey = $derived(boxW >= 190 && key.length > 0);
</script>

<div class="dial" class:solo={!showKey} bind:clientWidth={boxW}>
	<svg
		viewBox="-50 -50 100 100"
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="The outgoing request, by band"
	>
		<!--
			Only the arcs rotate, not the whole SVG.

			Rotating the <svg> is the one-line way to start the sweep at twelve
			o'clock, and it takes the text with it — counter-rotating each label
			then fights `text-anchor` and lands the numbers off centre. A group of
			nothing but circles is rotationally symmetric, so rotating that is free
			and the text inside stays in an untouched coordinate system.
		-->
		<g transform="rotate(-90)">
			<circle class="track" r={R} />
			{#each arcs as a (a.kind)}
				{#if a.share > 0}
					<circle
						class="arc"
						r={R}
						stroke={toneOf(a.kind)}
						stroke-dasharray="{a.share * C} {C}"
						stroke-dashoffset={-a.offset * C}
					>
						<title>{a.kind} — {Math.round(a.share * 100)}% of the request</title>
					</circle>
				{/if}
			{/each}
		</g>
		<text class="big" y="-1">{billed ? tokens(billed) : '—'}</text>
		<text class="sub" y="8">{ctx ? `${merged.length} bands` : 'idle'}</text>
	</svg>

	{#if showKey}
		<ul class="key">
			{#each key as b (b.kind)}
				<li>
					<span class="name">{b.kind}</span>
					<!-- The bar is what makes this fill a wide box. A four-row legend of
					     short mono words leaves most of a 500px cell empty; the same four
					     rows with a share bar between the name and the number use every
					     pixel of it and add the reading the ring is bad at — comparing two
					     bands that are nowhere near each other on the circle. -->
					<span class="bar"
						><i style:width="{Math.max(2, b.share * 100)}%" style:background={toneOf(b.kind)}
						></i></span
					>
					<b class="co-num">{Math.round(b.share * 100)}%</b>
				</li>
			{/each}
			{#if rest}
				<li class="more">+{rest}</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	/*
		Named `.dial`, not `.ring`, and that is not a preference.

		Tailwind ships a bare `.ring` utility, Svelte keeps our class name alongside
		its scoping hash, and utilities live in `@layer utilities` — so an unlayered
		component rule wins every property it *sets* and loses every property it
		does not. This rule never mentions `box-shadow`, so Tailwind's
		`0 0 0 1px` ring painted a hard rectangle around the cockpit's largest
		instrument, which is the box that could not be explained by reading this
		file. `tailwind-collisions.spec.ts` now fails the build on any class name
		that shares a word with a utility.
	*/
	.dial {
		height: 100%;
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	/* Without a key there is nothing to sit beside, so the ring takes the middle
	   rather than hugging the left edge with a void to its right. */
	.dial.solo {
		justify-content: center;
	}

	svg {
		height: 100%;
		/* `max-width` rather than a fixed width: the viewBox is square, so in a box
		   narrower than it is tall the ring would otherwise overflow and be clipped
		   by the instrument. `meet` shrinks it to fit instead. */
		max-width: 100%;
		flex: 0 1 auto;
		min-width: 0;
	}

	text {
		text-anchor: middle;
		dominant-baseline: middle;
		font-family: var(--font-mono);
	}
	.big {
		font-size: 13px;
		font-weight: 600;
		fill: var(--foreground);
	}
	.sub {
		font-size: 5.5px;
		letter-spacing: 0.08em;
		fill: var(--muted-foreground);
	}

	.track {
		fill: none;
		stroke: color-mix(in oklab, var(--foreground) 7%, transparent);
		stroke-width: 9;
	}
	.arc {
		fill: none;
		stroke-width: 9;
		transition: stroke-dasharray 400ms ease;
	}

	.key {
		flex: 1 1 0;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.22rem;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted-foreground);
		overflow: hidden;
	}
	.key li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}
	.key .name {
		flex: none;
		/* Fixed measure so the bars start on one line — the bars are the thing
		   being compared, and bars that begin at four different offsets cannot be. */
		width: 7.5ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.key .bar {
		flex: 1 1 0;
		min-width: 0;
		height: 4px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--foreground) 6%, transparent);
		overflow: hidden;
	}
	.key .bar i {
		display: block;
		height: 100%;
		border-radius: 999px;
		transition: width 400ms ease;
	}
	.key b {
		flex: none;
		width: 3.5ch;
		text-align: right;
		font-weight: 500;
		color: color-mix(in oklab, var(--foreground) 75%, transparent);
	}
	.more {
		opacity: 0.6;
	}
</style>
