<script lang="ts">
	import type { Node as StepNode, Topology } from '$lib/agent/topology';

	/**
	 * The workflow's real topology, drawn.
	 *
	 * Nothing here is a diagram anyone authored. The input comes from
	 * `readTopology(workflow.serializedStepGraph)` — the step graph the engine
	 * will execute — so a pipeline change redraws this and cannot drift away
	 * from it. That is the whole reason the panel is worth having: a picture you
	 * maintain by hand is a claim, and this is a reading.
	 *
	 * ── Why ranks flow top-to-bottom ────────────────────────────────────────
	 * The X-ray column is 22rem — about 350px. Left-to-right would give a seven
	 * rank pipeline roughly 50px per rank, which cannot hold `select` in mono
	 * without rotating it, and rotated labels in an instrument panel are a
	 * puzzle rather than a readout. Top-to-bottom spends the scarce axis
	 * (width) on the thing that needs it (the id you read) and the plentiful
	 * one (height) on the thing there is more of (stages). It also puts the
	 * *lane* axis across the panel, so the one number `width` measures — how
	 * many steps can be in flight at once — is literally how wide the drawing
	 * gets.
	 */

	interface Props {
		topology: Topology;
		/** The step running right now, if any. Pulses. */
		active?: string;
		onselect?: (id: string) => void;
	}

	let { topology, active, onselect }: Props = $props();

	/* ── the drawing's own units ──────────────────────────────────────────────
	   A fixed coordinate space, scaled to the container by the viewBox. VIEW_W
	   is a *design* width rather than a measured one: the component never reads
	   the DOM, so it renders identically on the server and needs no observer. */
	const VIEW_W = 240;
	const PAD_X = 12;
	const PAD_Y = 8;
	const LANE_GAP = 10;
	const RANK_GAP = 22;
	const NODE_H = 26;
	const MAX_NODE_W = 164;
	const TERM_R = 7;

	interface Placed {
		node: StepNode;
		x: number;
		y: number;
		w: number;
		h: number;
		cx: number;
		cy: number;
		terminal: boolean;
	}

	/*
	 * Plain `Map`, not `SvelteMap`, on purpose. Both maps below are built from
	 * scratch inside the derived and never touched again once it returns —
	 * reactivity comes from re-running on a new `topology`, not from mutating a
	 * map in place, which is the only thing SvelteMap exists to track.
	 */
	const layout = $derived.by(() => {
		const nodes = topology?.nodes ?? [];

		const byRank = new Map<number, StepNode[]>();
		for (const node of nodes) {
			const row = byRank.get(node.rank);
			if (row) row.push(node);
			else byRank.set(node.rank, [node]);
		}

		// One slot width for the whole drawing, not per rank, so a step on a rank
		// of its own is the same size as one that shares a rank with three
		// siblings. Boxes that resize by neighbour count read as importance.
		const lanes = Math.max(1, topology?.width ?? 1);
		const slot = Math.min(MAX_NODE_W, (VIEW_W - 2 * PAD_X - (lanes - 1) * LANE_GAP) / lanes);

		// The gap between ranks is the room an edge has to turn in, so a graph
		// that fans gets more of it and a straight pipeline gets none it cannot
		// use. Without this a four-way fan-out travels 85 units sideways in 22
		// units of drop and reads as a kink rather than a sweep.
		const rankGap = lanes > 1 ? RANK_GAP + 12 : RANK_GAP;

		// Labels are set to the box, not the other way round. At four lanes a
		// 10px label leaves seven characters and every step reads `when…`; one
		// step down buys back three characters, which is the difference between
		// a legible id and a shrug.
		const labelSize = slot >= 90 ? 10 : slot >= 60 ? 9 : 8;

		const list: Placed[] = [];
		const byId = new Map<string, Placed>();

		let y = PAD_Y;
		for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
			const row = [...byRank.get(rank)!].sort((a, b) => a.lane - b.lane);
			const terminal = row.length === 1 && (row[0].kind === 'start' || row[0].kind === 'end');
			const h = terminal ? TERM_R * 2 : NODE_H;
			const rowW = row.length * slot + (row.length - 1) * LANE_GAP;
			const x0 = (VIEW_W - rowW) / 2;

			// Index rather than `node.lane`, so a topology with a gap in its lane
			// numbering still lays out flush instead of leaving a hole.
			row.forEach((node, i) => {
				const cx = terminal ? VIEW_W / 2 : x0 + i * (slot + LANE_GAP) + slot / 2;
				const placed: Placed = {
					node,
					x: cx - slot / 2,
					y,
					w: slot,
					h,
					cx,
					cy: y + h / 2,
					terminal
				};
				list.push(placed);
				// First wins. Two steps sharing an id is already ambiguous upstream —
				// the edge list can only name one of them — so the lookup picks the
				// earlier and the render below still draws both.
				if (!byId.has(node.id)) byId.set(node.id, placed);
			});

			y += h + rankGap;
		}

		return { list, byId, height: Math.max(1, y - rankGap + PAD_Y), labelSize };
	});

	/**
	 * Edges as cubic curves.
	 *
	 * The control points sit directly below the source and directly above the
	 * target, which is what makes a fan-out leave the parent vertically and
	 * arrive at each child vertically — a swept S rather than a diagonal that
	 * meets the box at an angle. Where a rank holds one step the two endpoints
	 * share an x and the same curve resolves to a straight run; bowing it on
	 * purpose there would be decoration, and this panel's whole claim is that
	 * nothing in it is drawn for effect.
	 */
	const paths = $derived.by(() =>
		(topology?.edges ?? []).flatMap((edge, i) => {
			const from = layout.byId.get(edge.from);
			const to = layout.byId.get(edge.to);
			if (!from || !to) return [];

			const y1 = from.cy + from.h / 2;
			const y2 = to.cy - to.h / 2;
			const bend = Math.max(8, (y2 - y1) * 0.45);

			return [
				{
					// The index guarantees uniqueness whatever the input contains — a
					// duplicate key throws, and the throw aborts the render.
					key: `${i}:${edge.from}->${edge.to}`,
					d: `M ${from.cx} ${y1} C ${from.cx} ${y1 + bend} ${to.cx} ${y2 - bend} ${to.cx} ${y2}`,
					conditional: Boolean(edge.conditional),
					when: to.node.when ?? ''
				}
			];
		})
	);

	/**
	 * What the caption is talking about.
	 *
	 * Pointer hover is the fast path, but a tap has no hover and a keyboard has
	 * no pointer, so a click pins instead — the same gesture that calls
	 * `onselect`. With nothing hovered or pinned it falls through to the running
	 * step, which is the description you would have wanted anyway.
	 */
	let hovered = $state<string | null>(null);
	let pinned = $state<string | null>(null);

	const shown = $derived(layout.byId.get(hovered ?? pinned ?? active ?? '')?.node);

	/** The drawing's only description for a screen reader; the rest is geometry. */
	const summary = $derived(
		`Workflow topology: ${layout.list.length} nodes in ${topology?.width ?? 1} parallel lanes`
	);

	function select(node: StepNode) {
		pinned = pinned === node.id ? null : node.id;
		onselect?.(node.id);
	}

	function keySelect(event: KeyboardEvent, node: StepNode) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		select(node);
	}

	/**
	 * Trim a label to what its box can hold.
	 *
	 * SVG text does not wrap and will happily run out past its rect, so the
	 * budget is computed rather than guessed: JetBrains Mono advances 0.6em, and
	 * the box is inset by 6 on each side.
	 */
	function clip(text: string, w: number, size: number) {
		const max = Math.max(3, Math.floor((w - 12) / (size * 0.6)));
		return text.length > max ? `${text.slice(0, max - 1)}…` : text;
	}
</script>

<figure class="graph">
	{#if !layout.list.length}
		<p class="quiet">No topology to draw.</p>
	{:else}
		<div class="canvas">
			<!-- `meet` rather than `slice`: the drawing shrinks to fit whichever axis
			     runs out first, so the panel never gains a scrollbar and never clips
			     a stage off the bottom, which would be a lie about the pipeline. -->
			<svg
				viewBox="0 0 {VIEW_W} {layout.height}"
				preserveAspectRatio="xMidYMid meet"
				style="--label-size: {layout.labelSize}px"
				aria-label={summary}
			>
				<g class="edges">
					{#each paths as path (path.key)}
						<path class="edge" class:conditional={path.conditional} d={path.d}>
							{#if path.conditional && path.when}
								<title>{path.when}</title>
							{/if}
						</path>
					{/each}
				</g>

				{#each layout.list as p (`${p.node.rank}:${p.node.lane}:${p.node.id}`)}
					<g
						class="node {p.node.kind}"
						class:active={p.node.id === active}
						class:lit={p.node.id === (hovered ?? pinned)}
						role="button"
						tabindex="0"
						aria-label="{p.node.label}{p.node.description ? `: ${p.node.description}` : ''}"
						onclick={() => select(p.node)}
						onkeydown={(e) => keySelect(e, p.node)}
						onmouseenter={() => (hovered = p.node.id)}
						onmouseleave={() => (hovered = null)}
						onfocus={() => (hovered = p.node.id)}
						onblur={() => (hovered = null)}
					>
						<title>{p.node.label}{p.node.description ? ` — ${p.node.description}` : ''}</title>

						{#if p.terminal}
							{#if p.node.id === active}
								<circle class="halo" cx={p.cx} cy={p.cy} r={TERM_R} />
							{/if}
							<circle class="dot" cx={p.cx} cy={p.cy} r={TERM_R - 2.5} />
						{:else}
							{#if p.node.id === active}
								<rect class="halo" x={p.x} y={p.y} width={p.w} height={p.h} rx="6" />
							{/if}
							<rect class="box" x={p.x} y={p.y} width={p.w} height={p.h} rx="6" />
							<text class="label" x={p.cx} y={p.cy} dominant-baseline="central">
								{clip(p.node.label, p.w, layout.labelSize)}
							</text>
							{#if p.node.canSuspend}
								<!-- Where the run can stop and wait for you. Amber is the approval
								     colour everywhere else in the app; it means the same here. -->
								<circle class="suspend" cx={p.x + p.w - 6} cy={p.y + 6} r="2.2" />
							{/if}
						{/if}
					</g>
				{/each}
			</svg>
		</div>

		<figcaption>
			{#if shown?.when}
				<span class="predicate co-num">when {shown.when}</span>
			{/if}
			{#if shown?.description}
				<span class="detail">{shown.description}</span>
			{:else if shown}
				<span class="detail dim">{shown.label} — no description on this step.</span>
			{:else}
				<span class="detail dim">Hover a stage to read what it does.</span>
			{/if}
		</figcaption>
	{/if}
</figure>

<style>
	.graph {
		display: flex;
		flex-direction: column;
		margin: 0;
		min-height: 0;
		gap: 0.4rem;
	}

	/* min-height:0 so the svg can be squeezed by a flex parent rather than
	   forcing the column taller than the panel and pushing the caption out. */
	.canvas {
		flex: 1 1 auto;
		min-height: 0;
		min-width: 0;
	}

	svg {
		display: block;
		width: 100%;
		height: 100%;
		max-height: 100%;
		overflow: visible;
	}

	/* An edge is content, not chrome, so it is drawn at reading strength rather
	   than at the hairline used for panel dividers — a --border hairline in the
	   dark themes is 9% white, which disappears entirely as a 1px diagonal. */
	.edge {
		fill: none;
		stroke: color-mix(in oklab, var(--muted-foreground) 38%, transparent);
		stroke-width: 1;
		stroke-linecap: round;
	}
	.edge.conditional {
		stroke-dasharray: 3 3;
	}

	.node {
		cursor: pointer;
		outline: none;
	}

	.box {
		fill: var(--background);
		stroke: color-mix(in oklab, var(--muted-foreground) 30%, transparent);
		stroke-width: 1;
		transition:
			stroke 180ms ease,
			fill 180ms ease;
	}

	/* An entry kind this build does not recognise. Filled rather than dashed:
	   the dash already means "conditional" on the edges, and one convention
	   carrying two meanings in one picture is worse than no convention. */
	.node.other .box {
		fill: var(--muted);
		stroke: color-mix(in oklab, var(--muted-foreground) 22%, transparent);
	}

	.dot {
		fill: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		stroke: none;
	}

	.label {
		font-family: var(--font-mono);
		/* Set from the layout, which knows how wide a box actually is. An inline
		   custom property rather than a presentation attribute, because CSS wins
		   over `font-size="…"` and the two would silently disagree. */
		font-size: var(--label-size, 10px);
		text-anchor: middle;
		fill: color-mix(in oklab, var(--foreground) 76%, transparent);
		pointer-events: none;
		transition: fill 180ms ease;
	}
	.node.other .label {
		fill: var(--muted-foreground);
	}

	.suspend {
		fill: var(--co-approval);
	}

	.node.lit .box,
	.node:focus-visible .box {
		stroke: color-mix(in oklab, var(--co-accent) 55%, transparent);
	}
	.node.lit .label {
		fill: var(--foreground);
	}
	.node.lit .dot,
	.node:focus-visible .dot {
		fill: var(--co-accent);
	}

	.node.active .box {
		stroke: var(--co-accent);
		fill: color-mix(in oklab, var(--co-accent) 10%, var(--background));
	}
	.node.active .label {
		fill: var(--co-accent);
	}
	.node.active .dot {
		fill: var(--co-accent);
	}

	/* The pulse: a ring that swells out of the node's own outline and fades.
	   stroke-width rather than a transform, because an SVG scale is about the
	   origin and would send the ring travelling across the drawing. */
	.halo {
		fill: none;
		stroke: var(--co-accent);
		animation: pulse 1900ms ease-out infinite;
	}

	@keyframes pulse {
		0% {
			stroke-width: 1;
			opacity: 0.7;
		}
		70%,
		100% {
			stroke-width: 6;
			opacity: 0;
		}
	}

	/* The global reduce-motion rule collapses the duration, which would leave
	   the halo frozen at opacity 0 — the running step would lose its ring
	   entirely. So hold it still and visible instead. */
	@media (prefers-reduced-motion: reduce) {
		.halo {
			animation: none;
			stroke-width: 2;
			opacity: 0.45;
		}
	}

	figcaption {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		/* Reserved rather than fitted: a caption that grows and shrinks as the
		   pointer crosses the graph makes the drawing above it jump. */
		min-height: 2.3rem;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: color-mix(in oklab, var(--foreground) 72%, transparent);
	}

	.predicate {
		font-size: 0.625rem;
		color: var(--muted-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	/* The caption's own muted voice. Deliberately not `.quiet` below: that one
	   sets its own size for the empty state, which would make the caption jump
	   a line taller the moment nothing is hovered. */
	.dim {
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
	}

	.quiet {
		margin: 0;
		font-size: 0.75rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}
</style>
