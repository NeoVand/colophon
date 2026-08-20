<script lang="ts">
	import { session, type LoggedEvent } from '$lib/agent/session.svelte';

	/**
	 * The whole run as one strip, laid out over time.
	 *
	 * `EventTimeline` is a scrolling list, and a scrolling list of several hundred
	 * events answers "what happened at 3:56" while refusing to answer "what did
	 * this run look like" — the question you ask while watching rather than
	 * debugging. You cannot see the shape of something you can only see a page of.
	 *
	 * Ticks are placed by **elapsed time**, not by index. That is the whole
	 * difference: an index strip makes a ninety-second `fetch_paper` look exactly
	 * like a 40ms step, while over time the fetch is a wide empty gap. The gaps
	 * are the reading — this is a picture of waiting as much as of working.
	 *
	 * The strip buckets into ~3px columns rather than drawing one node per event.
	 * A 1px-per-event strip both disappears and puts thousands of nodes on screen
	 * for marks nobody can see; bucketing caps the node count at the strip's own
	 * width however long the run gets.
	 *
	 * Each column takes the colour of the most *significant* event in its bucket,
	 * not the most common one. The mode would bury exactly what you are scanning
	 * for: one error among twenty bookkeeping events is a minority by
	 * construction and is the only thing in the bucket worth seeing.
	 *
	 * ── Why an empty run still draws ────────────────────────────────────────
	 * This used to be dimmed to 28% and floated behind the other instruments as
	 * scenery, with a `no events yet` caption in the middle. On a fresh page that
	 * combination rendered as *nothing at all* — a faint caption at roughly 11%
	 * effective opacity smeared across the top of two live gauges — which is most
	 * of why the cockpit read as a broken screen rather than as an alternative
	 * view. Scenery needs a room to be scenery in, and a 400px flank is not one.
	 *
	 * So the empty state is a drawing, not a sentence: every column paints a short
	 * neutral stub, and the stubs in a row are a **horizon line**. Events raise
	 * the columns they land in and colour them. A run with nothing in it is a flat
	 * horizon, which is a reading; a caption saying "no events yet" is not.
	 *
	 * Height carries density, colour carries kind. The two are independent, so a
	 * quiet stretch containing one error is a short red column rather than a
	 * column that has to choose between saying "rare" and saying "bad".
	 *
	 * ── Still inert ─────────────────────────────────────────────────────────
	 * Ticks are spans with `pointer-events: none`, never buttons: a row of a
	 * hundred focusable marks would put a hundred tab stops in front of the
	 * composer. Selecting an event is the timeline's job, in the working layout.
	 */

	/** Loud beats common. Ranked by what a reader would want rescued. */
	const RANK: Record<string, number> = {
		error: 6,
		tripwire: 6,
		approval: 5,
		'tool-call': 4,
		'tool-result': 4,
		step: 3,
		context: 2,
		reasoning: 2,
		start: 1,
		done: 1,
		text: 0
	};

	/** The legend, as `EventTimeline` assigns it. Ochre asks, sage answers. */
	const TONE: Record<string, string> = {
		error: '--co-error',
		tripwire: '--co-gate',
		approval: '--co-approval',
		'tool-call': '--co-tool',
		'tool-result': '--co-library',
		step: '--co-memory',
		context: '--co-memory',
		reasoning: '--co-model',
		start: '--co-model',
		done: '--co-model',
		text: '--co-model'
	};

	/** A failed result is an error, whatever the event kind says. */
	function kindOf(row: LoggedEvent): string {
		const e = row.event;
		if (e.k === 'tool-result' && e.failed) return 'error';
		return e.k;
	}

	const rows = $derived(session.events);

	/**
	 * Nothing has happened yet, which the horizon draws differently.
	 *
	 * A flat line at 14% across the full width is a solid slab eight pixels tall,
	 * and a solid horizontal slab spanning a window is a scrollbar — that is what
	 * it was being read as. Broken into a mark per column with a gap between, the
	 * same line becomes a ruled scale: time is divided here, nothing has landed in
	 * it. The claim is the one a dial's tick marks make, and it stays true.
	 */
	const quiet = $derived(!rows.length);

	let stripW = $state(0);
	const COL = 3;

	/** The flat line an empty run draws, as a share of the strip's height. */
	const FLOOR = 0.14;

	interface Column {
		kind: string;
		n: number;
	}

	const cols = $derived.by((): Column[] => {
		const n = Math.max(1, Math.floor(stripW / COL));
		const out: Column[] = Array.from({ length: n }, () => ({ kind: '', n: 0 }));
		if (!rows.length) return out;

		// Events are appended in arrival order, so the last one carries the span.
		// A run whose events all land in the same millisecond falls back to 1 and
		// piles into the first column, which is honest: it took no time.
		const span = rows[rows.length - 1].at || 1;

		for (const row of rows) {
			const i = Math.min(n - 1, Math.max(0, Math.floor((row.at / span) * n)));
			const kind = kindOf(row);
			const col = out[i];
			col.n++;
			if (!col.kind || (RANK[kind] ?? 0) > (RANK[col.kind] ?? 0)) col.kind = kind;
		}
		return out;
	});

	/** The busiest bucket, which every other column's height is read against. */
	const peak = $derived(Math.max(1, ...cols.map((c) => c.n)));

	/* A column that caught even one event clears the horizon by a visible step
	   rather than by a fraction of a pixel — the reading is "something happened
	   here", and a 1px difference from the floor does not say that. */
	const heightOf = (c: Column) =>
		c.n ? FLOOR + (1 - FLOOR) * (0.34 + 0.66 * (c.n / peak)) : FLOOR;
</script>

<div
	class="ribbon"
	class:quiet
	bind:clientWidth={stripW}
	role="img"
	aria-label="{rows.length} events over time"
>
	{#each cols as c, i (i)}
		<span class="col">
			<i
				class="tick"
				class:on={c.n > 0}
				style:height="{heightOf(c) * 100}%"
				style:background={c.kind ? `var(${TONE[c.kind] ?? '--co-model'})` : undefined}
			></i>
		</span>
	{/each}
</div>

<style>
	.ribbon {
		height: 100%;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		/* Grown from a centre line rather than from a baseline. A run is a
		   horizon, and a horizon has weather above and below it. */
		align-items: center;
		/* No gap. At any interesting density the gaps become the picture. */
		overflow: hidden;
		/* Inert on purpose — see the note at the top. */
		pointer-events: none;
	}

	.col {
		flex: 1 1 0;
		min-width: 0;
		height: 100%;
		display: flex;
		align-items: center;
	}

	.tick {
		width: 100%;
		/* The horizon's own colour, overridden inline once a bucket has a kind. */
		background: color-mix(in oklab, var(--foreground) 14%, transparent);
		transition: height 300ms ease;
	}
	.tick.on {
		opacity: 0.62;
	}

	/* One mark per column instead of a continuous rule — see `quiet` above. The
	   column is `COL` wide, so a 1px mark reads as a scale at any strip width. */
	.ribbon.quiet .tick {
		width: 1px;
		margin-inline: auto;
	}
</style>
