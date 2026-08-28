<script lang="ts">
	import { onMount } from 'svelte';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { readTopology } from '$lib/agent/topology';
	import type { WorkflowEvent } from '$lib/agent/workflow-events';

	/**
	 * The deep-research pipeline, executing.
	 *
	 * `GraphPanel` draws the workflow's shape; this draws its *progress* through
	 * that shape. Both read the same source of truth — `serializedStepGraph`, the
	 * topology the engine will actually run — so a step added to
	 * `research-workflow.ts` gains a row here with no second edit, and a step
	 * removed loses one. Nothing in this file knows the names `scope` or `write`.
	 *
	 * ── The two clocks, and why only one is used ────────────────────────────
	 * A duration here is always `endedAt − startedAt` as the *engine* measured
	 * it, carried on the chunk. The obvious alternative — start a stopwatch when
	 * the frame arrives — measures the network as well as the work, and pairing
	 * a server timestamp with a browser one can produce a negative number when
	 * the two clocks disagree, which they routinely do by a second or two.
	 *
	 * That is also why a running step shows a pulse rather than a live counter.
	 * There is no honest elapsed time to show until the engine reports both of
	 * its own timestamps, and a counter that is confidently wrong about a
	 * five-minute run is worse than a mark that says only "this one, now".
	 */

	let {
		/** Projected workflow events, oldest first. Fed by the research stream. */
		events = [],
		/** True while the SSE connection is open, for the header readout. */
		running = false
	}: {
		events?: WorkflowEvent[];
		running?: boolean;
	} = $props();

	type RowState = 'waiting' | 'running' | 'done' | 'failed' | 'suspended' | 'skipped';

	interface Row {
		id: string;
		description?: string;
		state: RowState;
		/** Milliseconds, as the engine measured them. 0 when it did not say. */
		ms?: number;
		error?: string;
	}

	/*
	 * The step list is loaded once and not per run: it is the code's shape, not
	 * the run's, and it cannot change without a deploy. What changes per run is
	 * which row is lit.
	 */
	let steps = $state<{ id: string; description?: string }[]>([]);
	let topologyError = $state('');

	onMount(async () => {
		try {
			const response = await fetch('/api/graph');
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as { serializedStepGraph?: unknown };
			steps = readTopology(data.serializedStepGraph)
				.nodes.filter((n) => n.kind === 'step')
				.map((n) => ({ id: n.id, description: n.description }));
		} catch (cause) {
			topologyError = cause instanceof Error ? cause.message : String(cause);
		}
	});

	/**
	 * Topology folded with the event stream.
	 *
	 * A step the topology did not mention still gets a row, appended in the
	 * order it first spoke. Two reasons: a nested workflow reports its steps
	 * under a compound id, and a panel that silently omits a stage that actually
	 * ran is making a false claim about the pipeline — the one failure this
	 * panel must not have.
	 *
	 * Every id passes through the de-duplicating `find` on the way in, which is
	 * what keeps the `{#each}` key below unique. A duplicate key does not merely
	 * misdraw: it throws, and the throw aborts the render and leaves the
	 * previous rows frozen on screen.
	 */
	const rows = $derived.by(() => {
		const built: Row[] = [];
		// De-duplicating on the way in is what keeps the `{#each}` key unique.
		const find = (id: string) => built.find((r) => r.id === id);

		for (const step of steps) {
			if (!find(step.id)) {
				built.push({ id: step.id, description: step.description, state: 'waiting' });
			}
		}

		for (const event of events) {
			// Only the two that name a stage. A frame with no `step` — the trace
			// events that ride on the same stream once did exactly this — would
			// otherwise be given a row keyed on `undefined` and drawn as a real
			// stage that does not exist.
			if (event.k !== 'step-start' && event.k !== 'step-finish') continue;

			let row = find(event.step);
			if (!row) {
				row = { id: event.step, state: 'waiting' };
				built.push(row);
			}

			if (event.k === 'step-start') {
				row.state = 'running';
				row.ms = undefined;
				row.error = undefined;
			} else {
				row.state = event.state;
				row.ms = event.ms;
				row.error = event.error;
			}
		}

		return built;
	});

	const finished = $derived(
		rows.filter((r) => r.state !== 'waiting' && r.state !== 'running').length
	);
	const elapsed = $derived(rows.reduce((sum, r) => sum + (r.ms ?? 0), 0));
	const done = $derived(events.some((e) => e.k === 'workflow-done'));

	/** Tenths under ten seconds; whole seconds above, where tenths stop meaning anything. */
	function duration(ms: number): string {
		if (!ms) return '';
		if (ms < 1000) return `${Math.round(ms)}ms`;
		if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
		if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
		const minutes = Math.floor(ms / 60_000);
		return `${minutes}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
	}

	/**
	 * The stage names, read off the topology rather than written down here.
	 *
	 * It makes the empty state a readout too: a stage added to
	 * `research-workflow.ts` appears in this sentence, and one removed leaves
	 * it. Copy that names five steps in prose is copy that will be wrong on the
	 * day someone adds a sixth.
	 */
	const stages = $derived(steps.map((s) => s.id).join(' · '));

	const readout = $derived(
		events.length
			? `${finished}/${rows.length}${elapsed ? ` · ${duration(elapsed)}` : ''}${
					running && !done ? ' · running' : ''
				}`
			: undefined
	);
</script>

<PanelFrame label="workflow" icon={ICON.workflow} tone="subagent" {readout}>
	{#if !events.length}
		<EmptyState icon={ICON.workflow} tone="subagent" title="Nothing has run yet" note={stages} />
	{:else}
		<ol>
			{#each rows as row, index (row.id)}
				<li class="row {row.state}" class:last={index === rows.length - 1}>
					<span class="rail" aria-hidden="true"><span class="mark"></span></span>

					<div class="body">
						<p class="name co-eyebrow">{row.id}</p>
						{#if row.error}
							<p class="note error">{row.error}</p>
						{:else if row.description}
							<p class="note">{row.description}</p>
						{/if}
					</div>

					<span class="co-num timing">{duration(row.ms ?? 0)}</span>
					<span class="co-eyebrow state">{row.state}</span>
				</li>
			{/each}
		</ol>

		{#if topologyError}
			<!-- The rows still came from the run, so this is a missing caption
			     rather than a missing panel — say which, rather than looking empty. -->
			<p class="quiet">No descriptions: {topologyError}</p>
		{/if}
	{/if}
</PanelFrame>

<style>
	ol {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		margin: 0;
		padding: 0.5rem 0.7rem 0.7rem;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.34rem 0;
	}

	/* The rail is what makes five rows read as a pipeline rather than a list:
	   one hairline threaded through every mark, stopping at the last. */
	.rail {
		position: relative;
		flex: none;
		width: 9px;
		align-self: stretch;
		display: flex;
		justify-content: center;
		padding-top: 0.3rem;
	}
	.rail::after {
		content: '';
		position: absolute;
		top: 0.75rem;
		bottom: -0.34rem;
		width: 1px;
		background: color-mix(in oklab, var(--border) 70%, transparent);
	}
	.row.last .rail::after {
		display: none;
	}

	/* One glyph, four inkings — hollow while waiting, filled once run, ringed
	   while in flight. A shape that fills in reads as one scale; four different
	   badges would read as four unrelated facts. */
	.mark {
		position: relative;
		z-index: 1;
		width: 7px;
		height: 7px;
		border-radius: 999px;
		border: 1px solid color-mix(in oklab, var(--co-subagent) 45%, transparent);
		background: var(--background);
		transition:
			background-color 200ms ease,
			border-color 200ms ease;
	}
	.row.running .mark {
		background: var(--co-subagent);
		border-color: var(--co-subagent);
		animation: pulse 1.6s ease-in-out infinite;
	}
	.row.done .mark,
	.row.skipped .mark {
		background: color-mix(in oklab, var(--co-subagent) 70%, transparent);
		border-color: color-mix(in oklab, var(--co-subagent) 70%, transparent);
	}
	.row.suspended .mark {
		background: var(--co-approval);
		border-color: var(--co-approval);
	}
	.row.failed .mark {
		background: var(--co-error);
		border-color: var(--co-error);
	}

	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklab, var(--co-subagent) 40%, transparent);
		}
		50% {
			box-shadow: 0 0 0 3px color-mix(in oklab, var(--co-subagent) 0%, transparent);
		}
	}

	.body {
		flex: 1;
		min-width: 0;
	}

	.name {
		margin: 0;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
		transition: color 200ms ease;
	}
	.row.running .name,
	.row.done .name,
	.row.suspended .name {
		color: var(--co-subagent);
	}
	.row.failed .name {
		color: var(--co-error);
	}

	.note {
		margin: 0.08rem 0 0;
		font-size: 0.6875rem;
		line-height: 1.45;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
		text-wrap: pretty;
	}
	.note.error {
		color: color-mix(in oklab, var(--co-error) 82%, transparent);
	}
	.row.waiting .note {
		color: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
	}

	.timing {
		flex: none;
		padding-top: 0.16rem;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}

	.state {
		flex: none;
		width: 4.2rem;
		text-align: right;
		padding-top: 0.24rem;
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}
	.row.running .state {
		color: var(--co-subagent);
	}
	.row.failed .state {
		color: var(--co-error);
	}
	.row.suspended .state {
		color: var(--co-approval);
	}

	.quiet {
		margin: 0;
		padding: 0 0.7rem 0.6rem;
		font-size: 0.6875rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
</style>
