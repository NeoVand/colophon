<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import { readTopology, type Topology } from '$lib/agent/topology';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import GraphView from './GraphView.svelte';
	import GraphLegend from './GraphLegend.svelte';

	/**
	 * The research workflow's shape, fetched once and drawn.
	 *
	 * Split from `GraphView` on purpose: the view is a pure function of a
	 * topology and can be tested or reused with any graph, while this knows
	 * where Colophon's graph comes from. Fetching inside the renderer would tie
	 * a drawing to an endpoint.
	 *
	 * The topology is loaded once rather than per run because it cannot change
	 * without a deploy — it is the code's shape, not the run's. What changes per
	 * run is which node is lit.
	 */

	/** Hosted in another frame's tab group; that frame draws the header. */
	let { bare = false }: { bare?: boolean } = $props();

	let topology = $state<Topology | undefined>();
	let error = $state('');

	onMount(async () => {
		try {
			const response = await fetch('/api/graph');
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as { serializedStepGraph?: unknown };
			topology = readTopology(data.serializedStepGraph);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	});

	/**
	 * Which step is running, inferred from the event stream.
	 *
	 * The chat agent does not run this workflow — it is the *pipeline* the
	 * deep-research route uses — so during an ordinary conversation nothing is
	 * lit, and that is honest. When a workflow run does stream, its step ids
	 * arrive as tool names and light the matching node.
	 */
	const active = $derived.by(() => {
		if (!topology) return undefined;
		const ids = new Set(topology.nodes.map((n) => n.id));
		for (let i = session.events.length - 1; i >= 0; i--) {
			const event = session.events[i].event;
			if (event.k === 'tool-call' && ids.has(event.name)) return event.name;
		}
		return undefined;
	});
</script>

<PanelFrame
	{bare}
	label="graph"
	icon={ICON.graph}
	tone="subagent"
	readout={topology ? `${topology.nodes.length - 2} steps` : undefined}
>
	{#if error}
		<EmptyState
			icon={ICON.graph}
			tone="subagent"
			title="The pipeline could not be read"
			note={error}
		/>
	{:else if !topology}
		<EmptyState icon={ICON.graph} tone="subagent" title="Reading the pipeline…" />
	{:else}
		<div class="drawing">
			<GraphView {topology} {active} />
		</div>
		<GraphLegend />
	{/if}
</PanelFrame>

<style>
	.drawing {
		flex: 1;
		min-height: 0;
		display: flex;
		padding: 0.4rem 0.7rem 0;
	}
</style>
