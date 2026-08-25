<script lang="ts">
	import Tooltip from '$lib/components/ui/Tooltip.svelte';

	/**
	 * The key to the graph above it.
	 *
	 * Four marks in one row, and not a sentence anywhere. The version before this
	 * was six rows and a paragraph, which is a footnote apparatus under a drawing
	 * that is 200px tall — the explanation outweighed the thing explained. What
	 * the paragraph said is still here: it moved into the tooltip on the mark it
	 * was talking about, which is where a reader who wants it will look and where
	 * a reader who does not will never be bothered by it.
	 *
	 * Nothing obvious is listed. A plain box is a step and a dot is an end; a
	 * legend that says so is padding. These four are the marks nobody guesses:
	 * the accent means *now*, the broken taper is the only thing separating a
	 * branch the engine may skip from one it always takes, the amber pip is where
	 * a run can stop and wait for you, and the filled grey box is the graph
	 * admitting it met a builder verb this build does not recognise.
	 *
	 * The swatches are redrawn here with `GraphView`'s own geometry and tokens
	 * rather than shared, because the two are small and a reader compares shapes
	 * rather than descriptions — but they must be read together whenever either
	 * changes.
	 */

	/* The connector taper, in the same 10-wide box `GraphView` draws it in, so
	   the swatch is the mark rather than an impression of it. */
	const W = 10;
	const H = 10;
	const TOP = 1.4;
	const BOTTOM = 0.55;

	function wedge(a: number, b: number) {
		const wa = TOP + (BOTTOM - TOP) * a;
		const wb = TOP + (BOTTOM - TOP) * b;
		return `M ${W / 2 - wa} ${a * H} L ${W / 2 + wa} ${a * H} L ${W / 2 + wb} ${b * H} L ${W / 2 - wb} ${b * H} Z`;
	}

	const BROKEN = [wedge(0, 0.3), wedge(0.4, 0.68), wedge(0.78, 1)];

	const MARKS = [
		{ id: 'running', label: 'running', note: 'the step the engine is executing right now' },
		{
			id: 'conditional',
			label: 'conditional',
			note: 'this stage runs only when its predicate holds — hover the step to read it'
		},
		{ id: 'suspend', label: 'suspends', note: 'the run can stop here and wait for you' },
		{ id: 'unknown', label: 'unknown', note: 'a builder verb this build of the engine cannot read' }
	] as const;
</script>

<ul class="legend">
	{#each MARKS as mark (mark.id)}
		<li>
			<Tooltip text={mark.note} side="top">
				<span class="key">
					{#if mark.id === 'conditional'}
						<svg class="taper" viewBox="0 0 {W} {H}" aria-hidden="true">
							{#each BROKEN as d, i (i)}
								<path {d} />
							{/each}
						</svg>
					{:else}
						<span class="chip {mark.id}"></span>
					{/if}
					<span class="label">{mark.label}</span>
				</span>
			</Tooltip>
		</li>
	{/each}
</ul>

<style>
	.legend {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		/* Column gap wide enough that four marks read as four, row gap tight so
		   the fallback at 260px — two lines — still reads as one block. */
		gap: 0.1rem 0.7rem;
		margin: 0;
		/* Matched to the drawing's own inset above it, so the marks line up under
		   the pipeline rather than sitting in their own margin. */
		padding: 0.15rem 0.7rem 0.45rem;
		list-style: none;
	}

	li {
		min-width: 0;
	}

	.key {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		cursor: help;
	}

	.label {
		font-family: var(--font-mono);
		font-size: 0.5625rem;
		line-height: 1.3;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		transition: color 150ms ease;
	}
	.key:hover .label {
		color: var(--muted-foreground);
	}

	/* Same border, radius and fill as a step box in the graph, at swatch size. */
	.chip {
		flex: none;
		width: 15px;
		height: 9px;
		border: 1px solid color-mix(in oklab, var(--muted-foreground) 26%, transparent);
		border-radius: 3px;
		background: var(--background);
	}

	/* Held still and half-lit rather than pulsing: a legend that animates pulls
	   the eye off the graph, which is the thing that is actually moving. */
	.chip.running {
		border-color: var(--co-accent);
		background: color-mix(in oklab, var(--co-accent) 9%, var(--background));
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--co-accent) 22%, transparent);
	}

	.chip.suspend {
		position: relative;
	}
	.chip.suspend::after {
		content: '';
		position: absolute;
		top: 1.5px;
		right: 1.5px;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--co-approval);
	}

	.chip.unknown {
		background: var(--muted);
		border-color: color-mix(in oklab, var(--muted-foreground) 18%, transparent);
	}

	.taper {
		flex: none;
		width: 10px;
		height: 10px;
	}
	.taper path {
		fill: color-mix(in oklab, var(--muted-foreground) 40%, transparent);
	}
</style>
