<script lang="ts">
	import { onMount } from 'svelte';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { ICON } from '$lib/icons';
	import {
		attributeRows,
		buildTrace,
		hotspots,
		ms,
		type TraceNode,
		type TraceSpan
	} from '$lib/agent/trace';

	/**
	 * How long everything took, and which part of it was waiting.
	 *
	 * The event timeline says what happened and in what order. This says how
	 * long each thing held the clock, and — the part no list can show — which
	 * things overlapped. Those are the two readings that turn "it took nine
	 * seconds" into something actionable: nine seconds of one model call is a
	 * model choice, nine seconds of six readers that should have run at once is
	 * a bug in how they were dispatched, and in a transcript the two are
	 * indistinguishable.
	 *
	 * ── The bar is two facts, not one ───────────────────────────────────────
	 * A span's bar is drawn at its true position on the run's clock, so
	 * overlaps are visible as overlaps rather than implied by indentation. It is
	 * then inked only where the span was doing its **own** work and left hollow
	 * where a child had the floor. So a parent that is almost entirely hollow is
	 * a parent that was almost entirely waiting, which is the single most useful
	 * thing a trace can tell you and the thing a plain duration column hides.
	 *
	 * The arithmetic behind that lives in `$lib/agent/trace` and is tested
	 * there, including the case that makes it non-obvious: two children running
	 * at once cover one stretch of wall clock, not two.
	 *
	 * ── Where the spans come from ───────────────────────────────────────────
	 * Handed in, never fetched here. `$lib/server/tracing` collects them on the
	 * server — from the run's own timings today, and from Mastra's AI tracing
	 * spans the day `@mastra/observability` is installed — and the shape is the
	 * same either way, so this component never learns which door they came
	 * through.
	 */

	let {
		spans = [],
		/** False when `COLOPHON_TRACING` is unset. The panel then says so instead of looking broken. */
		configured = true,
		/** Why it is not configured, in the words of the setting that would fix it. */
		reason = '',
		/** True when the run outran the collector's per-run cap. */
		truncated = false,
		/** Hosted in another frame's tab group; that frame draws the header. */
		bare = false
	}: {
		spans?: readonly TraceSpan[];
		configured?: boolean;
		reason?: string;
		truncated?: boolean;
		bare?: boolean;
	} = $props();

	/**
	 * Zero until mounted, on purpose.
	 *
	 * `buildTrace` only consults the clock for spans that never closed, so a
	 * finished trace measures identically on the server and in the browser and
	 * hydration has nothing to disagree about. The interval below then keeps an
	 * *unfinished* run's bars growing while you watch.
	 */
	let now = $state(0);

	onMount(() => {
		// Reads the prop rather than the derived trace: a closed trace must not
		// schedule a rebuild every half-second for the rest of the session.
		const timer = setInterval(() => {
			if (spans.some((span) => span.endedAt === undefined)) now = Date.now();
		}, 500);
		return () => clearInterval(timer);
	});

	const trace = $derived(buildTrace(spans, { now }));
	const hot = $derived(hotspots(trace, 12));

	let view = $state('flame');
	/** Hover reads, click keeps — a readout you have to hold the mouse still for is unreadable. */
	let hovered = $state('');
	let pinned = $state('');
	const shown = $derived(trace.rows.find((node) => node.key === (pinned || hovered)));

	/** Percentage of the run's total width. Guarded, because an instant run has zero duration. */
	function pct(value: number): number {
		if (trace.duration <= 0) return value > 0 ? 100 : 0;
		return (value / trace.duration) * 100;
	}

	/**
	 * The legend, applied to span types.
	 *
	 * Mastra's vocabulary maps onto the colours this app already uses for the
	 * same ideas — ochre is retrieval wherever it appears, teal is the model
	 * speaking — because a legend that means one thing in the timeline and
	 * another here is not a legend. Anything unrecognised takes the app's own
	 * accent rather than a colour borrowed from a subsystem it is not part of.
	 */
	function tone(node: TraceNode): string {
		const kind = node.span.kind;
		if (node.span.failed) return 'var(--co-error)';
		if (kind.includes('tool')) return 'var(--co-tool)';
		if (kind.startsWith('model')) return 'var(--co-model)';
		if (kind.startsWith('memory')) return 'var(--co-memory)';
		if (kind.startsWith('rag') || kind.startsWith('graph')) return 'var(--co-tool)';
		// An agent run inside another agent run is a delegation — the paper
		// reader in its own window — which is exactly what the subagent colour
		// means everywhere else.
		if (kind.startsWith('agent')) return node.depth > 0 ? 'var(--co-subagent)' : 'var(--co-accent)';
		return 'var(--co-accent)';
	}

	// No icons on the tabs: `PanelFrame` draws only the label, and declaring an
	// icon that is never rendered is a promise the chrome does not keep.
	const TABS = [
		{ id: 'flame', label: 'flame' },
		{ id: 'self', label: 'self time' }
	];

	const readout = $derived(
		trace.rows.length
			? `${trace.rows.length} span${trace.rows.length === 1 ? '' : 's'} · ${ms(trace.duration)}`
			: ''
	);
</script>

<PanelFrame
	{bare}
	label="trace"
	icon={ICON.trace}
	tone="model"
	tabs={TABS}
	bind:active={view}
	{readout}
>
	{#if !configured}
		<EmptyState
			icon={ICON.trace}
			tone="model"
			title="Tracing is off"
			note={reason || 'COLOPHON_TRACING is not set.'}
		/>
	{:else if !trace.rows.length}
		<EmptyState icon={ICON.trace} tone="model" title="Nothing timed yet" />
	{:else if view === 'flame'}
		<ul class="rows">
			{#each trace.rows as node (node.key)}
				<li>
					<button
						class="row co-bare"
						class:on={shown?.key === node.key}
						style:--tone={tone(node)}
						onmouseenter={() => (hovered = node.key)}
						onmouseleave={() => (hovered = '')}
						onfocus={() => (hovered = node.key)}
						onblur={() => (hovered = '')}
						onclick={() => (pinned = pinned === node.key ? '' : node.key)}
						aria-label={`${node.span.name}, ${ms(node.total)}, ${ms(node.self)} of it its own`}
					>
						<span class="label" style:padding-left={`${node.depth * 0.62}rem`}>
							<span class="name" class:orphan={node.orphan}>{node.span.name}</span>
						</span>

						<span class="track">
							<!-- The whole span: where it sat on the run's clock. -->
							<span
								class="bar"
								class:open={node.open}
								style:left={`${pct(node.offset)}%`}
								style:width={`${pct(node.total)}%`}
							></span>
							<!-- Inked only where nothing else was running inside it. -->
							{#each node.own as segment, i (i)}
								<span
									class="own"
									style:left={`${pct(segment.from - trace.startedAt)}%`}
									style:width={`${pct(segment.to - segment.from)}%`}
								></span>
							{/each}
						</span>

						<span class="co-num dur">{ms(node.total)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="ranked">
			{#each hot as node (node.key)}
				<li>
					<button
						class="rank co-bare"
						class:on={shown?.key === node.key}
						style:--tone={tone(node)}
						onmouseenter={() => (hovered = node.key)}
						onmouseleave={() => (hovered = '')}
						onfocus={() => (hovered = node.key)}
						onblur={() => (hovered = '')}
						onclick={() => (pinned = pinned === node.key ? '' : node.key)}
					>
						<span class="name">{node.span.name}</span>
						<span class="track short">
							<span class="own flat" style:width={`${pct(node.self)}%`}></span>
						</span>
						<span class="co-num dur">{ms(node.self)}</span>
						<span class="co-num of">of {ms(node.total)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if trace.rows.length}
		<!-- One strip rather than a floating card: an instrument reads out in a
		     fixed place, and a tooltip that moves is a tooltip you chase. -->
		<div class="strip" class:live={Boolean(shown)}>
			{#if shown}
				<p class="head">
					<span class="co-num sname" style:color={tone(shown)}>{shown.span.name}</span>
					<span class="co-eyebrow kind">{shown.span.kind.replace(/_/g, ' ')}</span>
					{#if shown.open}<span class="co-eyebrow flag">still open</span>{/if}
					{#if shown.orphan}<span class="co-eyebrow flag">parent not in this trace</span>{/if}
					{#if shown.span.failed}<span class="co-eyebrow flag bad">failed</span>{/if}
					{#if pinned}<span class="co-eyebrow flag">pinned — click again to release</span>{/if}
				</p>
				<p class="co-num nums">
					<span>+{ms(shown.offset)}</span>
					<span>{ms(shown.total)} total</span>
					<span class="own-num">{ms(shown.self)} its own</span>
					{#if shown.children.length}
						<span>{shown.children.length} child{shown.children.length === 1 ? '' : 'ren'}</span>
					{/if}
				</p>
				{#each attributeRows(shown.span) as row (row.key)}
					<p class="attr co-num"><span class="k">{row.key}</span>{row.value}</p>
				{:else}
					<p class="attr quiet">No attributes recorded on this span.</p>
				{/each}
			{:else}
				<!-- Idle, the strip is a legend for the ink beside it plus whatever is
				     wrong with this trace. Both are facts about what is on screen, so
				     neither is prose that can be cut. -->
				<p class="quiet">
					Hover a bar. Solid is its own time, hollow is waiting.{#if trace.open}
						{trace.open} span{trace.open === 1 ? ' has' : 's have'} not closed.{/if}{#if truncated}
						Truncated at the collector's cap.{/if}
				</p>
			{/if}
		</div>
	{/if}
</PanelFrame>

<style>
	.rows,
	.ranked {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		margin: 0;
		padding: 0.35rem 0.5rem 0.35rem 0.7rem;
		list-style: none;
	}

	.row,
	.rank {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.11rem 0.2rem;
		border: 0;
		border-radius: 2px;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color 150ms ease;
	}
	.row:hover,
	.rank:hover,
	.row.on,
	.rank.on {
		background: color-mix(in oklab, var(--tone) 9%, transparent);
	}

	.label {
		flex: none;
		width: 34%;
		min-width: 0;
	}

	.name {
		display: block;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--foreground) 72%, transparent);
	}
	/* Dotted, because the same dashes mean "came from outside this codebase" in
	   the MCP panel: a span whose parent never arrived is the same claim about
	   provenance, made about time. */
	.name.orphan {
		border-left: 1px dotted color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		padding-left: 0.3rem;
	}

	.track {
		position: relative;
		flex: 1;
		min-width: 0;
		height: 9px;
	}
	.track.short {
		height: 7px;
	}

	/* The full extent of the span, at low ink: this is the time it occupied. */
	.bar {
		position: absolute;
		top: 0;
		height: 100%;
		min-width: 2px;
		border-radius: 1px;
		background: color-mix(in oklab, var(--tone) 16%, transparent);
	}
	/* A span with no end has no right edge to draw, so it is not given one. */
	.bar.open {
		background: linear-gradient(
			to right,
			color-mix(in oklab, var(--tone) 16%, transparent),
			transparent
		);
	}

	/* The time the span spent on itself rather than on a child. */
	.own {
		position: absolute;
		top: 0;
		height: 100%;
		min-width: 1px;
		border-radius: 1px;
		background: color-mix(in oklab, var(--tone) 78%, transparent);
	}
	.own.flat {
		position: relative;
		display: block;
	}

	.dur {
		flex: none;
		width: 3.4rem;
		text-align: right;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}

	.ranked .name {
		flex: none;
		width: 38%;
	}
	.of {
		flex: none;
		width: 4.2rem;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 50%, transparent);
	}

	.strip {
		flex: none;
		padding: 0.45rem 0.7rem 0.55rem;
		border-top: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.45rem;
		margin: 0 0 0.2rem;
	}
	.sname {
		font-size: 0.6875rem;
	}
	.kind {
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
	.flag {
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--co-approval) 85%, transparent);
	}
	.flag.bad {
		color: var(--co-error);
	}

	.nums {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		margin: 0 0 0.25rem;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}
	.own-num {
		color: color-mix(in oklab, var(--foreground) 75%, transparent);
	}

	.attr {
		margin: 0.1rem 0 0;
		font-size: 0.5625rem;
		line-height: 1.4;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
		overflow-wrap: anywhere;
	}
	.attr .k {
		display: inline-block;
		min-width: 6.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}

	.quiet {
		margin: 0;
		font-size: 0.625rem;
		line-height: 1.5;
		max-width: 44em;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
		text-wrap: pretty;
	}
</style>
