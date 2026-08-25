<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import { readTopology, type Topology } from '$lib/agent/topology';
	import { agentTopology, type AgentShape } from '$lib/agent/agent-topology';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import GraphView from './GraphView.svelte';
	import GraphLegend from './GraphLegend.svelte';

	/**
	 * Whichever machine is running, drawn.
	 *
	 * ── What was wrong, and what the fix actually is ────────────────────────
	 * This panel drew the deep-research workflow's step graph, always — during
	 * ordinary conversations included, when the chat agent never executes that
	 * workflow. Its "which node is lit" matched tool-call names against workflow
	 * step ids, which cannot match. It was a correct picture of the wrong
	 * subject, and dead by construction in every normal run.
	 *
	 * The fix is not to choose one of the two subjects. It is that this draws
	 * **the machine that is executing**: the pipeline while deep research is in
	 * flight, and the agent loop the rest of the time. Both are readings —
	 * `/api/graph` returns `serializedStepGraph`, the topology the engine will
	 * run, and `/api/agent/shape` returns what the built agent answers when you
	 * ask it what it has. Neither is a diagram anyone maintains.
	 *
	 * Both are fetched once at mount, because neither can change without a
	 * deploy. What changes per run is which node is lit and how big its fill is,
	 * and both of those come from events.
	 *
	 * `?thread=` on the shape request is load-bearing: `getMemory()` returns
	 * undefined for an agent built without one, so a shape fetched without the
	 * thread would draw an agent that cannot remember.
	 */

	/** Hosted in another frame's tab group; that frame draws the header. */
	let { bare = false }: { bare?: boolean } = $props();

	let pipeline = $state<Topology | undefined>();
	let loop = $state<Topology | undefined>();
	let error = $state('');

	const load = async (url: string) => {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.json();
	};

	const fail = (cause: unknown) => {
		error = cause instanceof Error ? cause.message : String(cause);
	};

	// The pipeline's shape depends on nothing but the deploy.
	onMount(async () => {
		try {
			const graph = (await load('/api/graph')) as { serializedStepGraph?: unknown };
			pipeline = readTopology(graph.serializedStepGraph);
		} catch (cause) {
			fail(cause);
		}
	});

	/**
	 * The agent's shape depends on the thread, so it waits for one.
	 *
	 * An `onMount` here drew an agent with no memory, every time, and the reason
	 * is mount order: a child's `onMount` runs before its parent's, and the
	 * parent is where `session.restore()` mints the thread. So this fetched
	 * `?thread=` empty, `getMemory()` returned undefined for an agent built
	 * without one, and the drawing said the agent could not remember — for an
	 * app whose memory is one of the things it is for. It looked correct until a
	 * hot reload happened to run it a second time with a thread in hand.
	 *
	 * An effect instead, so the shape follows the thread rather than racing it.
	 * `fetched` is a plain `let`, deliberately: state read inside the effect that
	 * the effect also writes is `effect_update_depth_exceeded`, which this file's
	 * sibling has already shipped twice.
	 */
	let fetched = '';
	$effect(() => {
		const thread = session.thread;
		if (!thread || thread === fetched) return;
		fetched = thread;
		load(`/api/agent/shape?thread=${encodeURIComponent(thread)}`)
			.then((shape: AgentShape) => (loop = agentTopology(shape)))
			.catch(fail);
	});

	const research = $derived(session.mode === 'research');
	const topology = $derived(research ? pipeline : loop);

	/**
	 * The node in flight, read off the events the run is publishing.
	 *
	 * Two subjects, two sources, one rule: a thing is lit while it has started
	 * and not finished. Nothing is lit between runs, which is honest — the
	 * previous answer's last tool is not running now.
	 */
	const active = $derived.by(() => {
		if (!topology) return undefined;

		if (research) {
			// Step ids from the pipeline's own chunks, which do match the node ids
			// because both come from `research-workflow.ts`.
			//
			// A plain `Set`, not `SvelteSet`: it is built from scratch inside this
			// derived and unreachable once it returns. Reactivity comes from
			// re-running on new events, not from mutating a set something else reads.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const open = new Set<string>();
			for (const { event } of session.events) {
				if (event.k !== 'stage') continue;
				if (event.state === 'start') open.add(event.step);
				else open.delete(event.step);
			}
			return [...open].pop();
		}

		// Tool names, which match because the nodes are keyed on the tool's real
		// id — `agent-paperReader` and not the pretty name shown on the box.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const open = new Set<string>();
		for (const { event } of session.events) {
			if (event.k === 'tool-call') open.add(event.name);
			else if (event.k === 'tool-result' && event.name) open.delete(event.name);
		}
		return [...open].pop();
	});

	/**
	 * A real quantity per node, drawn as a fill inside the box.
	 *
	 * For the loop it is how many times each tool was reached for this
	 * conversation, which is the profile that tells you what the agent actually
	 * does with what it was given — three searches and one read is a different
	 * animal from one search and four reads. For the pipeline it is milliseconds
	 * per stage, off the engine's own clock.
	 */
	const weights = $derived.by(() => {
		const out: Record<string, number> = {};
		for (const { event } of session.events) {
			if (research) {
				if (event.k === 'stage' && event.state !== 'start' && event.ms) {
					out[event.step] = (out[event.step] ?? 0) + event.ms;
				}
			} else if (event.k === 'tool-call') {
				out[event.name] = (out[event.name] ?? 0) + 1;
			}
		}
		return out;
	});

	const readout = $derived.by(() => {
		if (!topology) return undefined;
		const steps = topology.nodes.filter((n) => n.kind === 'step').length;
		return research ? `pipeline · ${steps} steps` : `loop · ${steps - 1} tools`;
	});
</script>

<PanelFrame {bare} label="graph" icon={ICON.graph} tone="subagent" {readout}>
	{#if error}
		<EmptyState icon={ICON.graph} tone="subagent" title="Could not read the machine" note={error} />
	{:else if !topology}
		<EmptyState icon={ICON.graph} tone="subagent" title="Reading the machine…" />
	{:else}
		<div class="drawing">
			<GraphView {topology} {active} {weights} />
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
