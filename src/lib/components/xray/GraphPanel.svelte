<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import { readTopology, type Topology } from '$lib/agent/topology';
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

<section class="panel">
	{#if error}
		<p class="quiet">Could not read the pipeline: {error}</p>
	{:else if !topology}
		<p class="quiet">…</p>
	{:else}
		<div class="drawing">
			<GraphView {topology} {active} />
		</div>
		<GraphLegend />
	{/if}
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-height: 0;
	}

	.drawing {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.quiet {
		margin: 0;
		font-size: 0.75rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}
</style>
