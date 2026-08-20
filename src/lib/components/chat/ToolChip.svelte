<script lang="ts">
	import type { ToolRun } from '$lib/agent/session.svelte';

	/**
	 * One tool call, as a chip.
	 *
	 * Two things it says that a name alone would not:
	 *
	 * **Delegation reads differently from a tool.** A subagent gets a thicker
	 * left edge in its own colour and the *subagent's* name rather than the
	 * `agent-paperReader` tool id, because what happened is "a paper was read in
	 * its own context window" — everything it read was paid for once, inside a
	 * window that was then discarded, and only the small reply came back. That
	 * is the single most expensive event in a run and it should not look like
	 * one more chip.
	 *
	 * **Running is a state, not an absence.** A call in flight is ochre and
	 * carries an ellipsis; a finished one goes quiet. Without that, a long fetch
	 * is indistinguishable from a stalled one.
	 */
	let { tool }: { tool: ToolRun } = $props();

	const tone = $derived(
		tool.subagent
			? '--co-subagent'
			: tool.failed
				? '--co-error'
				: tool.done
					? '--co-library'
					: '--co-tool'
	);

	/**
	 * A clock that only runs while the call does.
	 *
	 * Without it a long call is silent: the paper-reader spent sixty-five seconds
	 * inside one delegation and the chip said `paper reader…` the whole time,
	 * which is exactly what a hung call looks like. A number that moves is the
	 * difference between "slow" and "stuck", and it is the only question anyone
	 * has while waiting.
	 *
	 * The interval is created and torn down by the effect, so a finished chip
	 * costs nothing — a page of them would otherwise keep a timer each, forever.
	 */
	let now = $state(performance.now());

	$effect(() => {
		if (tool.done) return;
		const id = setInterval(() => (now = performance.now()), 100);
		return () => clearInterval(id);
	});

	const ms = $derived(
		tool.done
			? tool.endedAt && tool.startedAt
				? Math.round(tool.endedAt - tool.startedAt)
				: 0
			: Math.round(now - tool.startedAt)
	);

	const title = $derived(
		tool.subagent
			? `${tool.subagent} — a subagent, in its own context window. Everything it read was paid for once and discarded; only its reply came back.`
			: tool.name
	);
</script>

<span
	class="chip"
	class:delegated={Boolean(tool.subagent)}
	class:idle={tool.done}
	style:--tone="var({tone})"
	{title}
>
	{tool.name}{tool.done ? '' : '…'}
	{#if ms > 900}<span class="ms co-num">{(ms / 1000).toFixed(1)}s</span>{/if}
</span>

<style>
	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		padding: 0.1rem 0.4rem;
		border: 1px solid color-mix(in oklab, var(--tone) 32%, transparent);
		border-radius: 3px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		line-height: 1.5;
		color: var(--tone);
		background: color-mix(in oklab, var(--tone) 6%, transparent);
		transition:
			color 200ms ease,
			border-color 200ms ease,
			background-color 200ms ease;
	}

	/* Finished work recedes. The eye should land on what is happening now. */
	.chip.idle {
		color: var(--muted-foreground);
		border-color: color-mix(in oklab, var(--border) 90%, transparent);
		background: transparent;
	}

	/* The lane marker. A delegation keeps its colour even when finished — the
	   fact that a whole second context window was spent does not stop being
	   true once it returns. */
	.chip.delegated {
		border-left-width: 2px;
		border-left-color: var(--tone);
		color: var(--tone);
		background: color-mix(in oklab, var(--tone) 7%, transparent);
	}

	.ms {
		font-size: 0.625rem;
		opacity: 0.65;
	}
</style>
