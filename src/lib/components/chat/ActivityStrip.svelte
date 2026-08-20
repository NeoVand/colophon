<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { slide } from 'svelte/transition';
	import { ICON } from '$lib/icons';
	import { session } from '$lib/agent/session.svelte';

	/**
	 * One line, while something is happening.
	 *
	 * The header's dot answers "is it working" from across the room. This answers
	 * the next four questions, which are the ones you have while you are actually
	 * sitting in front of it: *what* is it doing, how long has it been doing it,
	 * how many rounds of the loop it has taken, and what it has spent so far.
	 *
	 * Those numbers all exist in the X-ray already, and that is the point of
	 * repeating one line of them here: nobody opens a panel to find out whether a
	 * run is stuck. A research turn can spend ninety seconds inside a single
	 * delegation, and without a number that moves, ninety seconds of working is
	 * indistinguishable from a hang.
	 *
	 * It disappears when idle rather than going grey. A permanent bar showing
	 * "idle · 0 steps · 0 tokens" is furniture that has to be read to be ignored.
	 */

	const turn = $derived(session.turns[session.turns.length - 1]);
	const running = $derived(turn?.tools.find((t) => !t.done));
	const waiting = $derived(session.status === 'waiting');

	const phase = $derived(
		waiting
			? 'waiting on your approval'
			: running
				? `${running.name}…`
				: turn?.thinking
					? 'thinking…'
					: turn?.text
						? 'writing…'
						: 'starting…'
	);

	/* The legend, unchanged: amber is a decision waiting on you, ochre is
	   retrieval, the subagent colour is a whole second context window, teal is
	   the model itself. Same meanings as every chip and every event row. */
	const tone = $derived(
		waiting
			? '--co-approval'
			: running
				? running.subagent
					? '--co-subagent'
					: '--co-tool'
				: '--co-model'
	);

	const icon = $derived(
		waiting ? ICON.approval : running ? (running.subagent ? ICON.subagent : ICON.tool) : ICON.model
	);

	/**
	 * The clock.
	 *
	 * `session` does not publish the run's start — it holds it privately to
	 * timestamp events — so the strip takes its own reading when the run begins.
	 * That is exact enough: the effect fires on the same tick the status changes.
	 *
	 * Both variables are written here and never read here, which is what keeps
	 * this out of `effect_update_depth_exceeded`. `session.busy` is the only
	 * reactive value the effect reads, and nothing below writes it.
	 *
	 * The interval lives and dies with the run, so an idle app keeps no timers.
	 * Note that `busy` covers *waiting* as well as *running*, so the clock does
	 * not stop while an approval sits on screen — the time you spent deciding is
	 * still time the run took.
	 */
	let startedAt = $state(0);
	let now = $state(0);

	$effect(() => {
		if (!session.busy) return;

		const from = performance.now();
		startedAt = from;
		now = from;

		const id = setInterval(() => (now = performance.now()), 100);
		return () => clearInterval(id);
	});

	const elapsed = $derived(Math.max(0, now - startedAt));

	const clock = $derived.by(() => {
		const seconds = elapsed / 1000;
		if (seconds < 60) return `${seconds.toFixed(1)}s`;
		return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
	});

	/**
	 * Steps in *this* turn.
	 *
	 * `session.events` spans the whole conversation, so it is filtered by turn
	 * index rather than counted whole — a strip that said "step 41" on the second
	 * question of a session would be reporting the conversation, not the run.
	 */
	const index = $derived(session.turns.length - 1);
	const steps = $derived(
		session.events.reduce((n, e) => n + (e.turn === index && e.event.k === 'step' ? 1 : 0), 0)
	);

	const tokens = $derived(turn?.usage?.total ?? 0);
</script>

{#if session.busy}
	<div class="strip" style:--tone="var({tone})" transition:slide={{ duration: 150 }}>
		<div class="column">
			<span class="mark"><HugeiconsIcon {icon} size={12} /></span>
			<span class="phase">{phase}</span>

			<span class="spacer"></span>

			<span class="co-num read clock">{clock}</span>
			{#if steps > 0}<span class="co-num read">step {steps}</span>{/if}
			{#if tokens > 0}<span class="co-num read">{tokens.toLocaleString()} tok</span>{/if}
		</div>
	</div>
{/if}

<style>
	.strip {
		flex: none;
	}

	/* Same measure and the same scrollbar-gutter payback as the composer below
	   it, so the two read as one instrument rather than two stacked bars. */
	.column {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		max-width: 46rem;
		margin: 0 auto;
		padding: 0.3rem 1.5rem 0 calc(1.5rem + var(--co-gutter));
	}

	.mark {
		display: flex;
		color: var(--tone);
		/* The only motion in the strip, and it is the thing the strip is for:
		   proof that something is still moving. */
		animation: breathe 1.5s ease-in-out infinite;
	}
	@keyframes breathe {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	.phase {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--tone);
	}

	.spacer {
		flex: 1;
	}

	.read {
		flex: none;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}

	/* The number most likely to be watched, so it is the one that stays legible
	   at a glance. Fixed width to stop the row twitching as digits change. */
	.clock {
		min-width: 3rem;
		text-align: right;
		color: var(--muted-foreground);
	}
</style>
