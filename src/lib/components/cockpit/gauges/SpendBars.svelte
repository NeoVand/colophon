<script lang="ts">
	import { session } from '$lib/agent/session.svelte';
	import { tokens } from '$lib/xray/format';
	import { costOf, usd } from '$lib/xray/usage';

	/**
	 * Token spend, one stacked bar per turn.
	 *
	 * `SpendBar` in the flank shows the run's totals, which is the right answer
	 * to "what did this conversation cost". It cannot answer the question a
	 * cockpit is for: *which turn* cost that, and why. Three cheap turns beside
	 * one enormous one is the single most common shape of an expensive session,
	 * and a single summed bar hides it perfectly.
	 *
	 * Bars are heighted by tokens and stacked by kind, so the two readings arrive
	 * together: how big the turn was, and what it was made of. A turn that is
	 * mostly cached input is cheap however tall it looks, and one that is mostly
	 * reasoning is expensive in a way no amount of shortening your question will
	 * fix.
	 *
	 * The segments come from the `--co-tok-*` quantitative ramp, never from the
	 * event legend. The legend is tuned so nine subsystem colours read calm at
	 * one lightness, which is exactly what makes neighbouring hues collapse into
	 * each other when they are stacked inside a bar eight pixels wide.
	 *
	 * ── The overlap that makes this arithmetic ──────────────────────────────
	 * `cached` is a part of `input` and `reasoning` is a part of `output` — that
	 * is how the provider reports them. Stacking all five as siblings
	 * double-counts two of them and produces a bar that is wrong in the direction
	 * nobody checks, so each is subtracted out below before it is drawn.
	 */

	interface Bar {
		key: string;
		total: number;
		/** Named `cost`, not `usd` — `usd` is the formatter imported above. */
		cost: number;
		segments: { key: string; n: number; tone: string }[];
	}

	const bars = $derived.by((): Bar[] => {
		const out: Bar[] = [];
		session.turns.forEach((turn, i) => {
			const u = turn.usage;
			if (!u) return;

			const cached = Math.min(u.cached, u.input);
			const segments = [
				{ key: 'cached', n: cached, tone: '--co-tok-cached' },
				{ key: 'input', n: Math.max(0, u.input - cached), tone: '--co-tok-new' },
				{ key: 'reasoning', n: u.reasoning, tone: '--co-tok-reason' },
				{ key: 'output', n: Math.max(0, u.output - u.reasoning), tone: '--co-tok-out' }
			].filter((s) => s.n > 0);

			const total = segments.reduce((n, s) => n + s.n, 0);
			if (!total) return;
			// Keyed by position in `session.turns`, which is append-only within a
			// thread — so the key is stable as the run grows and unique by
			// construction, which a token total would not be.
			out.push({ key: `t${i}`, total, cost: costOf(u), segments });
		});
		return out;
	});

	const peak = $derived(Math.max(1, ...bars.map((b) => b.total)));
	const sum = $derived(bars.reduce((n, b) => n + b.total, 0));
	const spent = $derived(bars.reduce((n, b) => n + b.cost, 0));

	/*
	 * The price assumes the default rates, and says so nowhere else — so it is
	 * said here. The browser is never told which model answered (the model is
	 * built server-side from a private env var), and `DEFAULT_RATES` is the
	 * app's sanctioned meaning for an unqualified price. If a second model is
	 * ever wired up, this figure needs `ratesFor` and a model on the wire.
	 */
</script>

<div class="spend">
	{#if !bars.length}
		<span class="idle">no tokens spent yet</span>
	{:else}
		<div class="plot" role="img" aria-label="{tokens(sum)} tokens across {bars.length} turns">
			{#each bars as b (b.key)}
				<!--
					The column is full height and the bar sits in it.

					Two reasons. A two-token turn is a one-pixel bar and effectively
					unhoverable, so the readout would be unreachable on exactly the turns
					you are checking *because* they are cheap; and the bar itself has to
					clip its own segments to stay rounded, so the hover target cannot
					live inside it. Height is a share of the tallest turn rather than of
					the box — normalising each bar to itself would draw every turn the
					same height, which is the one thing this instrument must not do.
				-->
				<div class="col" title="{tokens(b.total)} tokens · {usd(b.cost)}">
					<div class="bar" style:height="{(b.total / peak) * 100}%">
						{#each b.segments as s (s.key)}
							<span class="seg" style:--tone="var({s.tone})" style:flex-grow={s.n}></span>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<div class="foot">
			<span class="co-num total">{tokens(sum)}</span>
			<span class="co-num money">{usd(spent)}</span>
		</div>
	{/if}
</div>

<style>
	.spend {
		height: 100%;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 0.3rem;
		overflow: hidden;
	}

	.plot {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: flex-end;
		gap: 2px;
	}

	.col {
		flex: 1 1 0;
		/* Never disappears: a turn that cost something must leave a mark, however
		   many turns are sharing the width. */
		min-width: 1px;
		height: 100%;
		display: flex;
		align-items: flex-end;
	}

	.bar {
		width: 100%;
		/* Bottom-up, so the constant costs sit on the baseline and this turn's
		   own output is the part that grows off the top. */
		display: flex;
		flex-direction: column-reverse;
		border-radius: 1.5px;
		overflow: hidden;
		transition: height 400ms ease;
		opacity: 0.9;
	}
	.col:hover .bar {
		opacity: 1;
	}

	.seg {
		flex-basis: 0;
		min-height: 1px;
		background: var(--tone);
	}

	/*
		The readout is a native `title`, deliberately.

		A drawn tooltip would have to escape `.bar`'s `overflow: hidden` — which is
		what rounds the stack — and then escape the instrument's own box, and a
		popover that has to break out of two clipping contexts to be seen is more
		machinery than a two-number readout is worth. The browser's own tip has no
		such problem.
	*/

	.foot {
		flex: none;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.5rem;
		letter-spacing: 0.04em;
		color: var(--muted-foreground);
	}
	.money {
		margin-left: auto;
		color: color-mix(in oklab, var(--co-tok-out) 80%, var(--muted-foreground));
	}

	.idle {
		margin: auto 0 0;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--muted-foreground);
		opacity: 0.55;
	}
</style>
