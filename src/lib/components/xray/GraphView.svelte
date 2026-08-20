<script lang="ts">
	import type { Node as StepNode, Topology } from '$lib/agent/topology';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';

	/**
	 * The workflow's real topology, drawn.
	 *
	 * Nothing here is a diagram anyone authored. The input comes from
	 * `readTopology(workflow.serializedStepGraph)` — the step graph the engine
	 * will execute — so a pipeline change redraws this and cannot drift away
	 * from it. That is the whole reason the panel is worth having: a picture you
	 * maintain by hand is a claim, and this is a reading.
	 *
	 * ── Why this is HTML and not an SVG any more ────────────────────────────
	 * The first version drew the whole thing into one `viewBox` and let
	 * `preserveAspectRatio` fit it. That is what made it a *chain*: a scaled
	 * drawing has one size, so every box came out identical and the type grew
	 * and shrank with the pane. Laid out in CSS instead, type stays at its real
	 * size from 260px to 700px, a box is exactly as wide as the name it holds,
	 * and — the reason that matters most below — a highlight can be a
	 * `box-shadow`, which is painted outside the border box and therefore
	 * cannot move anything.
	 *
	 * ── Why ranks still run top-to-bottom ───────────────────────────────────
	 * A horizontal flow that wraps was tried in the head and rejected: at 260px
	 * it breaks a seven-stage pipeline across three lines, and the wrap point
	 * looks exactly like a stage boundary that does not exist. Reading order
	 * would be a guess. Down the page, the sequence is never ambiguous at any
	 * width, the scarce axis (width) is spent on the ids you actually read, and
	 * the plentiful one (height) on the thing there is more of. Concurrency
	 * goes across: steps that share a stage share a row and a stage number.
	 *
	 * ── What the width of a box means ───────────────────────────────────────
	 * The name. That is the only per-step quantity the topology carries, it is
	 * real, and it gives the column a profile instead of five equal links.
	 * Duration deliberately does *not* set the width: timings arrive while the
	 * run is in flight, so a width driven by them would reflow the drawing mid
	 * run — the exact complaint this rewrite exists to fix. A run-time quantity
	 * rides as a fill *inside* the box, where it can change every frame and
	 * still move nothing.
	 */

	interface Props {
		topology: Topology;
		/** The step running right now, if any. Takes the accent and a halo. */
		active?: string;
		/**
		 * Optional per-step magnitude — millis elapsed, papers returned, whatever
		 * the caller has. Drawn as a fill inside the box, scaled to the largest.
		 * Unwired, the drawing is complete without it.
		 */
		weights?: Record<string, number>;
	}

	let { topology, active, weights }: Props = $props();

	interface Stage {
		key: string;
		/** `01`, `02`… Empty for the two terminals, which are not steps. */
		index: string;
		terminal: boolean;
		/** True when any step in the stage is guarded by a predicate. */
		conditional: boolean;
		running: boolean;
		nodes: { key: string; node: StepNode; fill: number }[];
	}

	/*
	 * A plain `Map`, not `SvelteMap`: it is built from scratch inside the
	 * derived and never touched again. Reactivity comes from re-running on a new
	 * `topology`, not from mutating a map in place.
	 */
	const stages: Stage[] = $derived.by(() => {
		const nodes = topology?.nodes ?? [];

		const byRank = new Map<number, StepNode[]>();
		for (const node of nodes) {
			const row = byRank.get(node.rank);
			if (row) row.push(node);
			else byRank.set(node.rank, [node]);
		}

		// Only positive, finite weights scale the fill. A single bad number
		// otherwise takes the maximum and flattens every real bar to nothing.
		const values = Object.values(weights ?? {}).filter((n) => Number.isFinite(n) && n > 0);
		const peak = values.length ? Math.max(...values) : 0;

		let step = 0;
		return [...byRank.keys()]
			.sort((a, b) => a - b)
			.map((rank) => {
				const row = [...byRank.get(rank)!].sort((a, b) => a.lane - b.lane);
				const terminal = row.length === 1 && (row[0].kind === 'start' || row[0].kind === 'end');
				if (!terminal) step += 1;

				return {
					// The rank is a Map key, so it is unique by construction — and a
					// duplicate key does not merely misdraw, it throws and aborts the
					// render, leaving the previous graph frozen on screen.
					key: `rank-${rank}`,
					index: terminal ? '' : String(step).padStart(2, '0'),
					terminal,
					conditional: row.some((n) => Boolean(n.when)),
					running: row.some((n) => n.id === active),
					nodes: row.map((node, i) => {
						const w = weights?.[node.id] ?? 0;
						const known = peak > 0 && Number.isFinite(w) && w > 0;
						return {
							// Two steps sharing an id is possible upstream; the lane index
							// keeps the key unique regardless.
							key: `${rank}:${i}:${node.id}`,
							node,
							// Floored at 5% so a step that ran, but ran fast, is still
							// visibly a bar rather than reading as "no data".
							fill: known ? Math.max(5, (w / peak) * 100) : 0
						};
					})
				};
			});
	});

	/** The drawing's only description for a screen reader; the rest is geometry. */
	const summary = $derived(
		`Workflow topology: ${topology?.nodes?.length ?? 0} stages, up to ${topology?.width ?? 1} steps at once`
	);

	/**
	 * The sentence the box has no room for.
	 *
	 * Returns empty when there is nothing to add — a tip that only repeats the
	 * label visible underneath it is noise, and an empty one means the node is
	 * rendered bare instead of as a focusable trigger nobody wants to tab through.
	 */
	function tip(node: StepNode) {
		const parts: string[] = [];
		if (node.when) parts.push(`when ${node.when}`);
		if (node.description) parts.push(node.description);
		return parts.join(' — ');
	}

	/* ── the connector ───────────────────────────────────────────────────────
	   Short and tapered rather than a long line, because a line of even weight
	   between two boxes is a link in a chain — it says "joined", not "flows
	   into". A wedge that narrows downward says which way the run goes without
	   an arrowhead, which at 10px is a smudge.

	   Drawn in a 10×12 box with `preserveAspectRatio="none"` so a squeezed panel
	   compresses the connectors instead of clipping a stage off the bottom. */
	const W = 10;
	const H = 12;
	const TOP = 1.5;
	const BOTTOM = 0.55;

	function wedge(a: number, b: number) {
		const wa = TOP + (BOTTOM - TOP) * a;
		const wb = TOP + (BOTTOM - TOP) * b;
		const y1 = a * H;
		const y2 = b * H;
		return `M ${W / 2 - wa} ${y1} L ${W / 2 + wa} ${y1} L ${W / 2 + wb} ${y2} L ${W / 2 - wb} ${y2} Z`;
	}

	const SOLID = [wedge(0, 1)];
	/* Three segments of one taper, not a dashed stroke: a dash pattern on a
	   1px line vanishes in the dark themes, where --border is 9% white. */
	const BROKEN = [wedge(0, 0.3), wedge(0.4, 0.68), wedge(0.78, 1)];

	/**
	 * ── Shrink rather than clip ─────────────────────────────────────────────
	 * `overflow: hidden` on its own made this instrument *lie*. In a short box a
	 * seven-stage pipeline drew START, scope, search, select and stopped — with
	 * no scrollbar, no fade and no marker, because the whole surface is built on
	 * the rule that nothing scrolls. A reader has no way to tell that reading
	 * from a pipeline which genuinely has three stages, and a drawing whose whole
	 * claim is "this is what will execute" cannot be allowed to show four fifths
	 * of it silently.
	 *
	 * So the drawing scales down when it would not otherwise fit. A `transform`
	 * is safe where a reflow is not: it paints outside the layout, so the
	 * measurement that decides `k` cannot be changed by applying `k` — which is
	 * what would make this an `effect_update_depth_exceeded` trap rather than two
	 * bindings. `drawnH` is the untransformed layout height and stays put.
	 *
	 * The floor is deliberate. Below about 60% the step ids stop being readable,
	 * and a drawing scaled to illegibility is no more honest than a clipped one —
	 * so under that the clip comes back, and the caller has given this instrument
	 * a box too small to hold it. Every real arrangement in the app clears it.
	 */
	let boxH = $state(0);
	let drawnH = $state(0);
	const k = $derived(drawnH > 0 && boxH > 0 ? Math.max(0.6, Math.min(1, boxH / drawnH)) : 1);
</script>

<figure class="flow" aria-label={summary} bind:clientHeight={boxH}>
	<div class="fit" style:--k={k} bind:clientHeight={drawnH}>
		{#if !stages.length}
			<p class="quiet">No topology to draw.</p>
		{:else}
			{#each stages as stage, i (stage.key)}
				{#if i > 0}
					<div class="link" aria-hidden="true">
						<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none">
							{#each stage.conditional ? BROKEN : SOLID as d, s (s)}
								<path class="taper" {d} />
							{/each}
						</svg>
					</div>
				{/if}

				<div class="stage" class:terminal={stage.terminal} class:running={stage.running}>
					<span class="tick co-num" aria-hidden="true">
						{#if stage.terminal}<span class="pip"></span>{:else}{stage.index}{/if}
					</span>

					{#if stage.terminal}
						<span class="cap co-eyebrow">{stage.nodes[0].node.label}</span>
					{:else}
						<div class="lane">
							{#each stage.nodes as p (p.key)}
								{@const text = tip(p.node)}
								{#if text}
									<Tooltip {text} side="top">
										{@render box(p.node, p.fill)}
									</Tooltip>
								{:else}
									{@render box(p.node, p.fill)}
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</figure>

{#snippet box(node: StepNode, fill: number)}
	<span
		class="node {node.kind}"
		class:active={node.id === active}
		class:conditional={Boolean(node.when)}
	>
		{#if fill}
			<!-- Behind the label, never around it: this is the one thing on screen
			     that changes during a run, and it must not touch a measured edge. -->
			<span class="fill" style:width="{fill}%"></span>
		{/if}
		<span class="name">{node.label}</span>
		{#if node.canSuspend}
			<!-- Where the run can stop and wait for you. Amber is the approval
			     colour everywhere else in the app; it means the same here. -->
			<span class="suspend"></span>
		{/if}
	</span>
{/snippet}

<style>
	.flow {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		margin: 0;
		min-width: 0;
		min-height: 0;
		/* Still clipped, but now only as the backstop below the scale floor — see
		   the note on `k`. The padding is the halo's room: the ring is painted 6px
		   outside the last box, and a clip box flush with the boxes would slice it
		   into a corner. */
		overflow: hidden;
		padding: 0 0 6px;
	}

	/* The scaled drawing. `top center` rather than `top left` so a shrunk
	   pipeline stays under its own label instead of drifting to one side. */
	.fit {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		min-width: 0;
		transform: scale(var(--k, 1));
		transform-origin: top center;
		transition: transform 200ms ease;
	}

	.stage {
		flex: none;
		display: flex;
		align-items: flex-start;
		gap: 0.3rem;
		min-width: 0;
	}

	/* The stage number is the left rail. An index column is what a pipeline
	   readout has and a chain does not — it says these are ordered stages of one
	   process rather than five things tied together. */
	.tick {
		flex: none;
		width: 1.25rem;
		font-size: 0.5625rem;
		/* Matched to a box's full outer height (10px type on 1.15rem, plus its
		   padding and border) so the digit sits level with the name it numbers
		   rather than a pixel proud of it. */
		line-height: 1.475rem;
		text-align: right;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		transition: color 160ms ease;
	}
	.stage.running .tick {
		color: var(--co-accent);
	}

	.pip {
		display: inline-block;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		vertical-align: middle;
		background: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
	}

	.cap {
		line-height: 1.475rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	.lane {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0.3rem;
		min-width: 0;
		padding-right: 6px;
	}
	/* The tooltip wraps each box in its own trigger span. Constraining that span
	   here rather than reaching into the tooltip's styles keeps a long step id
	   ellipsised instead of pushing the panel wider than its pane. */
	.lane > :global(*) {
		min-width: 0;
		max-width: 100%;
	}

	.node {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		max-width: 100%;
		min-width: 0;
		overflow: hidden;
		padding: 0.1rem 0.34rem;
		/* Always one pixel, in every state. A border that appears on highlight is
		   two pixels of reflow per node, which is how the old drawing "moved". */
		border: 1px solid
			var(--node-line, color-mix(in oklab, var(--muted-foreground) 26%, transparent));
		border-radius: 3px;
		background: var(--background);
		font-family: var(--font-mono);
		font-size: 0.625rem;
		line-height: 1.15rem;
		color: var(--node-ink, color-mix(in oklab, var(--foreground) 78%, transparent));
		transition:
			color 160ms ease,
			border-color 160ms ease,
			background-color 160ms ease,
			box-shadow 160ms ease;
	}

	.name {
		position: relative;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* A quantity, so it is drawn in no legend colour at all — ochre here would
	   claim this bar had something to do with retrieval. */
	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		background: color-mix(in oklab, var(--muted-foreground) 13%, transparent);
		transition: width 260ms ease;
	}

	.suspend {
		flex: none;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--co-approval);
	}

	/* An entry kind this build does not recognise. Filled rather than outlined
	   differently: the broken taper already means "conditional", and one
	   convention carrying two meanings is worse than no convention. */
	.node.other {
		background: var(--muted);
		border-color: color-mix(in oklab, var(--muted-foreground) 18%, transparent);
		color: var(--muted-foreground);
	}

	/* A guarded step keeps its predicate in the tooltip; the mark is a hairline
	   inset on the leading edge, which is a colour change, not a size one. */
	.node.conditional {
		border-left-color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}

	.node:hover {
		border-color: color-mix(in oklab, var(--co-accent) 50%, transparent);
		color: var(--foreground);
	}

	/* Keyboard focus lands on the tooltip's own trigger span, which this file
	   does not own — so the lit state travels down as two custom properties the
	   box already reads, rather than as a descendant selector reaching through
	   another component's markup. */
	.lane > :global(:focus-visible) {
		--node-line: color-mix(in oklab, var(--co-accent) 50%, transparent);
		--node-ink: var(--foreground);
	}

	/* ── the running step ────────────────────────────────────────────────────
	   Colour and a halo, and nothing else. `box-shadow` paints outside the
	   border box and takes no part in layout, so the pulse cannot nudge a
	   neighbour — which is what the old stroke-width animation did. */
	.node.active {
		border-color: var(--co-accent);
		background: color-mix(in oklab, var(--co-accent) 9%, var(--background));
		color: var(--co-accent);
		animation: halo 1900ms ease-out infinite;
	}

	@keyframes halo {
		0% {
			box-shadow: 0 0 0 0 color-mix(in oklab, var(--co-accent) 42%, transparent);
		}
		70%,
		100% {
			box-shadow: 0 0 0 6px color-mix(in oklab, var(--co-accent) 0%, transparent);
		}
	}

	/* The global reduce-motion rule collapses the duration, which would leave
	   the halo parked on its last frame — fully transparent — and the running
	   step would lose its ring entirely. Hold it still and visible instead. */
	@media (prefers-reduced-motion: reduce) {
		.node.active {
			animation: none;
			box-shadow: 0 0 0 2px color-mix(in oklab, var(--co-accent) 30%, transparent);
		}
	}

	/* Fixed height, but allowed to be squeezed: in a short pane the connectors
	   give up their room before a stage is clipped off the bottom, which would
	   be a lie about the pipeline. */
	.link {
		flex: 0 1 12px;
		height: 12px;
		min-height: 3px;
		padding-left: calc(0.625rem - 5px);
	}
	.link svg {
		display: block;
		width: 10px;
		height: 100%;
	}

	.taper {
		fill: color-mix(in oklab, var(--muted-foreground) 40%, transparent);
	}

	.quiet {
		margin: 0;
		font-size: 0.75rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}
</style>
