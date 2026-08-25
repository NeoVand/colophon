<script lang="ts">
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { ICON } from '$lib/icons';
	import { session } from '$lib/agent/session.svelte';
	import { ms, tokens, truncate } from '$lib/xray/format';

	/**
	 * The vital signs.
	 *
	 * Every other panel in the X-ray answers a question. This one answers none —
	 * it is the instrument you glance at to know whether anything is wrong, and
	 * then look elsewhere. So it is one fact per row, right-aligned, tabular, in
	 * the order you would scan them: what is running, how far it has got, what
	 * it has spent, what it has touched, whether it is waiting on you.
	 *
	 * Density is the design. Nothing here is explained, because a readout that
	 * explains itself is a readout you have to read.
	 *
	 * ── The two numbers worth knowing are the cached ones ───────────────────
	 * `cached` is a share of `in`, not an addition to it, and it is the cheapest
	 * line in the bill. It is also the easiest to lose: edit an early message
	 * and every later call re-pays for the whole prefix at full price. A run
	 * whose cached share collapses mid-conversation has usually just had its
	 * history rewritten by something, and this row is where that shows.
	 */

	const usage = $derived(session.usage);

	/** Steps of the agent loop, counted off the events rather than reported. */
	const steps = $derived(session.events.filter((e) => e.event.k === 'step').length);

	/** Provider calls, which is not the same number: a step can retry. */
	const calls = $derived(session.events.filter((e) => e.event.k === 'context').length);

	/**
	 * Elapsed, taken from the last event's own stamp.
	 *
	 * No timer. `at` is milliseconds since the current turn began, and text
	 * arrives in deltas, so during a run this advances several times a second on
	 * its own and then stops exactly when the run does. A `setInterval` would
	 * keep counting after the answer had finished, which is a clock, not a
	 * measurement.
	 *
	 * It is the *turn's* elapsed time, not the conversation's — the session
	 * restarts the stopwatch on every send, and a running total across turns
	 * would mostly measure how long you took to type.
	 */
	const elapsed = $derived(
		session.events.length ? session.events[session.events.length - 1].at : 0
	);

	const toolCalls = $derived(session.turns.reduce((n, t) => n + t.tools.length, 0));
	const live = $derived(
		session.turns.reduce((n, t) => n + t.tools.filter((c) => !c.done).length, 0)
	);

	const papersRead = $derived(session.papers.filter((p) => p.depth === 'read').length);

	/** The tool a decision is pending on, if the run is holding for one. */
	const pending = $derived(session.turns.find((t) => t.approval)?.approval);

	const cachedShare = $derived(usage.input ? Math.round((usage.cached / usage.input) * 100) : 0);

	const started = $derived(session.turns.length > 0);

	const label = $derived(
		session.status === 'waiting'
			? 'waiting on you'
			: session.status === 'running'
				? 'running'
				: 'idle'
	);
</script>

{#snippet status()}
	<span class="state co-eyebrow" data-state={session.status}>
		<span class="pip" aria-hidden="true"></span>{label}
	</span>
{/snippet}

<PanelFrame
	label="run"
	icon={ICON.model}
	tone="model"
	readout={started ? ms(elapsed) : undefined}
	actions={status}
>
	{#if !started}
		<EmptyState icon={ICON.model} tone="model" title="No run yet" />
	{:else}
		<div class="scroll">
			<ul class="dial">
				<li>
					<span class="co-eyebrow k">run</span>
					<span class="co-num v dim" title={session.runId || 'not yet assigned'}>
						{session.runId ? truncate(session.runId, 14) : '—'}
					</span>
				</li>
				<li>
					<span class="co-eyebrow k">steps</span>
					<span class="co-num v"
						>{steps}{#if calls}<span class="sub"> · {calls} calls</span>{/if}</span
					>
				</li>
				<li>
					<span class="co-eyebrow k">elapsed</span>
					<span class="co-num v" title="Since this turn began">{ms(elapsed)}</span>
				</li>

				<li class="gap">
					<span class="co-eyebrow k">in</span>
					<span class="co-num v" title="Billed input across every call in this conversation">
						{tokens(usage.input)}
					</span>
				</li>
				<li>
					<span class="co-eyebrow k">cached</span>
					<span class="co-num v" title="A share of the input above, not an addition to it">
						{tokens(usage.cached)}{#if cachedShare}<span class="sub"> · {cachedShare}%</span>{/if}
					</span>
				</li>
				<li>
					<span class="co-eyebrow k">out</span>
					<span class="co-num v">
						{tokens(usage.output)}{#if usage.reasoning}<span class="sub">
								· {tokens(usage.reasoning)} reasoning</span
							>{/if}
					</span>
				</li>

				<li class="gap">
					<span class="co-eyebrow k">tools</span>
					<span class="co-num v">
						{toolCalls}{#if live}<span class="sub live"> · {live} live</span>{/if}
					</span>
				</li>
				<li>
					<span class="co-eyebrow k">papers</span>
					<!-- Read over seen: the gap is the run's selectivity, and it is the
					     only reading of the library that fits on one line. -->
					<span class="co-num v" title="Read in full, of those seen in a search">
						{papersRead}<span class="sub"> / {session.papers.length}</span>
					</span>
				</li>
				<li class:held={Boolean(pending)}>
					<span class="co-eyebrow k">approval</span>
					<span class="co-num v" title={pending ? 'The run is suspended until you decide' : ''}>
						{pending ? pending.name : 'none'}
					</span>
				</li>
			</ul>
		</div>
	{/if}
</PanelFrame>

<style>
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.4rem 0.7rem 0.7rem;
	}

	.dial {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.dial li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.18rem 0;
	}
	/* A blank line between the three groups — what is running, what it spent,
	   what it touched — so the eye lands on a group rather than on row seven. */
	.dial li.gap {
		margin-top: 0.45rem;
		padding-top: 0.35rem;
		border-top: 1px solid color-mix(in oklab, var(--border) 40%, transparent);
	}

	.k {
		flex: none;
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	.v {
		margin-left: auto;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		color: color-mix(in oklab, var(--foreground) 85%, transparent);
		white-space: nowrap;
	}
	.v.dim {
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}

	.sub {
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
	}
	.sub.live {
		color: var(--co-tool);
	}

	/* Amber is the legend's "the run is waiting on you". It appears here only
	   while that is true, so the row is a signal rather than a label. */
	.dial li.held .v {
		color: var(--co-approval);
	}
	.dial li.held .k {
		color: color-mix(in oklab, var(--co-approval) 70%, transparent);
	}

	.state {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
	}
	.pip {
		width: 5px;
		height: 5px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
		transition:
			background-color 200ms ease,
			box-shadow 200ms ease;
	}
	.state[data-state='running'] {
		color: var(--co-model);
	}
	.state[data-state='running'] .pip {
		background: var(--co-model);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--co-model) 20%, transparent);
	}
	.state[data-state='waiting'] {
		color: var(--co-approval);
	}
	.state[data-state='waiting'] .pip {
		background: var(--co-approval);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--co-approval) 22%, transparent);
	}
</style>
