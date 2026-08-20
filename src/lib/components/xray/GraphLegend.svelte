<script lang="ts">
	/**
	 * The key to the graph above it.
	 *
	 * Six marks, drawn with the same geometry and the same tokens `GraphView`
	 * uses, because a legend redrawn approximately is worse than none — the
	 * reader compares shapes, not descriptions. The duplication is deliberate:
	 * each component stays self-contained, and the pair is small enough that the
	 * two are read together whenever either changes.
	 *
	 * Two marks earn their place beyond the obvious ones. The **dash** is the
	 * only thing distinguishing a branch the engine may skip from one it always
	 * takes, and that is a load-bearing difference nobody guesses. The **filled
	 * grey box** is the graph admitting it met a builder verb this build does not
	 * recognise — drawn rather than dropped, so a Mastra upgrade shows up as a
	 * visible unknown instead of a silently shorter pipeline.
	 */

	const MARKS = [
		{ id: 'terminal', label: 'start / end' },
		{ id: 'step', label: 'step' },
		{ id: 'unknown', label: 'unknown stage' },
		{ id: 'conditional', label: 'conditional' },
		{ id: 'suspend', label: 'can suspend' },
		{ id: 'running', label: 'running now' }
	] as const;
</script>

<div class="legend">
	<ul>
		{#each MARKS as mark (mark.id)}
			<li>
				<svg class="swatch {mark.id}" viewBox="0 0 22 12" aria-hidden="true">
					{#if mark.id === 'terminal'}
						<circle class="dot" cx="11" cy="6" r="3" />
					{:else if mark.id === 'conditional'}
						<path class="edge" d="M 1 10 C 7 10 15 2 21 2" />
					{:else}
						{#if mark.id === 'running'}
							<rect class="halo" x="2" y="1.5" width="18" height="9" rx="3" />
						{/if}
						<rect class="box" x="2" y="1.5" width="18" height="9" rx="3" />
						{#if mark.id === 'suspend'}
							<circle class="suspend" cx="17.5" cy="4" r="1.6" />
						{/if}
					{/if}
				</svg>
				<span>{mark.label}</span>
			</li>
		{/each}
	</ul>

	<p>A dashed edge is taken only when its predicate holds. Hover it to read the predicate.</p>
</div>

<style>
	.legend {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		/* auto-fit rather than a fixed two columns: at 22rem this settles into
		   two, and a wider host gets three without the labels reflowing. */
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: 0.15rem 0.5rem;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.625rem;
		line-height: 1.4;
		color: var(--muted-foreground);
	}

	.swatch {
		flex: none;
		width: 22px;
		height: 12px;
		overflow: visible;
	}

	.box {
		fill: var(--background);
		stroke: color-mix(in oklab, var(--muted-foreground) 30%, transparent);
		stroke-width: 0.8;
	}
	.swatch.unknown .box {
		fill: var(--muted);
		stroke: color-mix(in oklab, var(--muted-foreground) 22%, transparent);
	}
	.swatch.running .box {
		stroke: var(--co-accent);
		fill: color-mix(in oklab, var(--co-accent) 10%, var(--background));
	}

	/* Held still and half-lit rather than animated: a legend that pulses draws
	   the eye away from the graph, which is the thing that is actually moving. */
	.halo {
		fill: none;
		stroke: var(--co-accent);
		stroke-width: 2;
		opacity: 0.35;
	}

	.dot {
		fill: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}

	.edge {
		fill: none;
		stroke: color-mix(in oklab, var(--muted-foreground) 38%, transparent);
		stroke-width: 1;
		stroke-linecap: round;
		stroke-dasharray: 3 3;
	}

	.suspend {
		fill: var(--co-approval);
	}

	p {
		margin: 0;
		font-size: 0.625rem;
		line-height: 1.45;
		color: color-mix(in oklab, var(--muted-foreground) 78%, transparent);
		text-wrap: pretty;
	}
</style>
