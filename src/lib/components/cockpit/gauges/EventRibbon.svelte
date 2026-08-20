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
	 * ── Scenery, and why it is inert ────────────────────────────────────────
	 * This runs the full width *behind* the rest of the cockpit. Ticks are spans
	 * with `pointer-events: none`, never buttons: a row of a hundred focusable
	 * marks under every other instrument would put a hundred tab stops in front
	 * of the composer and swallow clicks meant for the gauges on top of it.
	 * Selecting an event is the timeline's job, in the working layout.
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

	let stripW = $state(0);
	const COL = 3;

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
</script>

<div
	class="ribbon"
	bind:clientWidth={stripW}
	role="img"
	aria-label="{rows.length} events over time"
>
	{#each cols as c, i (i)}
		<span
			class="tick"
			style:background={c.kind ? `var(${TONE[c.kind] ?? '--co-model'})` : 'transparent'}
		></span>
	{/each}
	{#if !rows.length}
		<span class="idle">no events yet</span>
	{/if}
</div>

<style>
	.ribbon {
		position: relative;
		height: 100%;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		align-items: stretch;
		/* No gap. At any interesting density the gaps become the picture. */
		overflow: hidden;
		/*
			Faded at both ends and top and bottom instead of clipped to a rectangle.

			A hard-edged strip is a box, and the cockpit's rule is that separation
			comes from tone rather than from edges. The mask lets the horizon end in
			the page instead of against a line, which is what keeps it reading as
			scenery rather than as one more panel.
		*/
		mask-image:
			linear-gradient(to bottom, transparent, black 32%, black 68%, transparent),
			linear-gradient(to right, transparent, black 4%, black 96%, transparent);
		mask-composite: intersect;
		/* Inert on purpose — see the note at the top. */
		pointer-events: none;
	}

	.tick {
		flex: 1 1 0;
		min-width: 0;
		opacity: 0.4;
	}

	.idle {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--muted-foreground);
		opacity: 0.4;
	}
</style>
