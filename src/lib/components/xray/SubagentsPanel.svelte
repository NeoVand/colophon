<script lang="ts">
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { ICON } from '$lib/icons';
	import { session } from '$lib/agent/session.svelte';
	import { readUsage, type Usage } from '$lib/agent/events';
	import { ms, truncate } from '$lib/xray/format';

	/**
	 * Every delegation, and the asymmetry that makes delegation worth doing.
	 *
	 * A subagent arrives in the stream as a tool call named `agent-<key>` and
	 * nothing else. Drawn as one more chip it reads as one more tool, which is
	 * the opposite of what it is: a second agent ran its own loop in its own
	 * context window, read whatever it needed at full length, and then that
	 * window was **thrown away**. Only the reply came back.
	 *
	 * That asymmetry is the entire argument for the pattern and it is a number,
	 * not a metaphor. The delegation's result carries the subagent's own usage,
	 * so this panel can put the two halves side by side: what it read, billed
	 * once to a window that no longer exists, against what it returned, which
	 * joins this conversation and is re-sent on every turn that follows. A paper
	 * reader that reads forty thousand tokens and returns eight hundred has
	 * bought the parent a fifty-fold saving on every later call.
	 *
	 * Chronological rather than grouped by subagent: what a delegation was
	 * *asked* is most of what makes it worth reading, and it differs per
	 * dispatch. The cockpit's crew lanes are the grouped reading.
	 *
	 * Nothing is passed in to make this work — it is folded out of the tool
	 * records the run already publishes.
	 */

	interface Delegation {
		key: string;
		name: string;
		brief: string;
		dur: number;
		live: boolean;
		failed: boolean;
		/** The subagent's own spend, when its result carried usage. */
		usage?: Usage;
		/** Characters of reply text — what actually entered the parent's window. */
		reply: number;
		/** Tool calls the subagent made inside its own loop, when reported. */
		inner: number;
	}

	/** Mastra's agent-as-tool takes `{ prompt, instructions?, maxSteps? }`. */
	const BRIEF_KEYS = ['prompt', 'message', 'task', 'input', 'query'];

	function briefOf(args: unknown): string {
		if (typeof args === 'string') return args.trim();
		if (!args || typeof args !== 'object') return '';
		const a = args as Record<string, unknown>;
		for (const key of BRIEF_KEYS) {
			const v = a[key];
			if (typeof v === 'string' && v.trim()) return v.trim();
		}
		// Better a raw payload than a blank line: the brief is the one part of a
		// delegation a reader can judge, and a shape we did not anticipate is
		// still readable.
		try {
			return JSON.stringify(args) ?? '';
		} catch {
			return '';
		}
	}

	function replyOf(result: unknown): string {
		if (typeof result === 'string') return result;
		if (result && typeof result === 'object') {
			const text = (result as Record<string, unknown>).text;
			if (typeof text === 'string') return text;
			try {
				return JSON.stringify(result) ?? '';
			} catch {
				return '';
			}
		}
		return '';
	}

	/**
	 * The subagent's usage, or nothing.
	 *
	 * `readUsage` turns a missing object into five zeros, which on screen is
	 * indistinguishable from a subagent that read nothing — a false claim about
	 * the very thing this panel exists to report. So absence is checked before
	 * the numbers are trusted, and a row with no usage says so with an em dash.
	 */
	function usageOf(result: unknown): Usage | undefined {
		if (!result || typeof result !== 'object') return undefined;
		const raw = (result as Record<string, unknown>).usage;
		if (!raw || typeof raw !== 'object') return undefined;
		const usage = readUsage(raw);
		return usage.input || usage.output || usage.total ? usage : undefined;
	}

	function innerOf(result: unknown): number {
		if (!result || typeof result !== 'object') return 0;
		const inner = (result as Record<string, unknown>).subAgentToolResults;
		return Array.isArray(inner) ? inner.length : 0;
	}

	const delegations = $derived.by(() => {
		const out: Delegation[] = [];

		session.turns.forEach((turn, ti) => {
			turn.tools.forEach((tool, ci) => {
				if (!tool.subagent) return;
				const reply = replyOf(tool.result);

				out.push({
					// Turn and position, not the tool-call id alone: a malformed stream
					// can hand us an empty id, and two identical keys in one `{#each}`
					// throw and abort the render rather than merely misdrawing.
					key: `${ti}.${ci}.${tool.id}`,
					name: tool.subagent,
					brief: briefOf(tool.args),
					// A call still in flight has no duration; showing its elapsed time
					// would need a ticking clock, and this panel is read after the fact.
					dur: tool.endedAt === undefined ? 0 : Math.max(0, tool.endedAt - tool.startedAt),
					live: !tool.done,
					failed: Boolean(tool.failed),
					usage: usageOf(tool.result),
					reply: reply.length,
					inner: innerOf(tool.result)
				});
			});
		});

		return out;
	});

	const totals = $derived(
		delegations.reduce(
			(sum, d) => ({
				read: sum.read + (d.usage?.input ?? 0),
				back: sum.back + (d.usage?.output ?? 0)
			}),
			{ read: 0, back: 0 }
		)
	);

	/** A count, at the precision a dense column can use — `847`, `1.2k`, `48k`. */
	function n(value: number): string {
		if (value < 1000) return String(Math.round(value));
		const k = value / 1000;
		return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
	}

	const readout = $derived(totals.read ? `${n(totals.read)} read → ${n(totals.back)} back` : '');

	/** Hosted in another frame's tab group; that frame draws the header. */
	let { bare = false }: { bare?: boolean } = $props();
</script>

<PanelFrame {bare} label="crew" icon={ICON.subagent} tone="subagent" {readout}>
	{#if !delegations.length}
		<EmptyState icon={ICON.subagent} tone="subagent" title="Nothing delegated yet" />
	{:else}
		<div class="scroll">
			<ul class="rows">
				{#each delegations as d (d.key)}
					<li class="job" class:live={d.live} class:failed={d.failed}>
						<p class="head">
							<span class="who">{d.name}</span>
							{#if d.inner}
								<span class="co-num inner" title="Tool calls it made inside its own loop">
									{d.inner} call{d.inner === 1 ? '' : 's'} inside
								</span>
							{/if}
							<span class="co-num when">
								{d.live ? 'running' : d.failed ? 'failed' : ms(d.dur)}
							</span>
						</p>

						{#if d.brief}
							<p class="brief" title={d.brief}>{truncate(d.brief, 180)}</p>
						{/if}

						{#if d.usage}
							<!--
								One track, two readings. The whole width is what the subagent
								read; the solid part at its left is what came back. The sliver
								is not a drawing problem — it is the measurement, and the
								reason the pattern pays.
							-->
							<div class="ledger">
								<span class="co-num read">{n(d.usage.input)} read</span>
								<span
									class="track"
									role="img"
									aria-label="{n(d.usage.input)} tokens read, {n(d.usage.output)} returned"
									title="{d.usage.input.toLocaleString()} in, {d.usage.output.toLocaleString()} out — the input was billed to a window that no longer exists"
								>
									<span
										class="back"
										style:width="{d.usage.input ? (d.usage.output / d.usage.input) * 100 : 100}%"
									></span>
								</span>
								<span class="co-num out">{n(d.usage.output)} back</span>
							</div>
						{:else if d.reply}
							<p class="co-num nousage" title="The delegation result carried no usage">
								— read · {d.reply.toLocaleString()} chars came back
							</p>
						{/if}
					</li>
				{/each}
			</ul>

			<!-- The trade used to be spelled out here in four lines. It is already
			     drawn: the track's width is what was read, the ink is what came
			     back, and the tooltip on each track names both. -->
		</div>
	{/if}
</PanelFrame>

<style>
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.45rem 0.7rem 0.7rem;
	}

	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/*
		The indent is the claim, borrowed from the event timeline: a rule offset
		on the left says "this ran inside the turn above it", which is exactly why
		its cost is surprising.
	*/
	.job {
		padding: 0.45rem 0 0.45rem 0.5rem;
		border-left: 1px solid color-mix(in oklab, var(--co-subagent) 30%, transparent);
		border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
	}
	.job:last-child {
		border-bottom: 0;
	}
	.job.failed {
		border-left-color: color-mix(in oklab, var(--co-error) 45%, transparent);
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin: 0;
	}

	.who {
		font-size: 0.75rem;
		color: var(--co-subagent);
	}
	.job.failed .who {
		color: var(--co-error);
	}

	.inner {
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	.when {
		margin-left: auto;
		flex: none;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
	}
	.job.live .when {
		color: var(--co-subagent);
	}

	.brief {
		margin: 0.2rem 0 0;
		font-size: 0.6875rem;
		line-height: 1.45;
		color: color-mix(in oklab, var(--muted-foreground) 88%, transparent);
		text-wrap: pretty;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.ledger {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.35rem;
	}

	.read,
	.out {
		flex: none;
		font-size: 0.5625rem;
	}
	/* What was read is dim: it is gone. What came back is lit: it is still here,
	   and it is what every later call pays for. */
	.read {
		color: color-mix(in oklab, var(--co-subagent) 55%, transparent);
	}
	.out {
		color: var(--co-subagent);
	}

	.track {
		flex: 1;
		min-width: 0;
		height: 4px;
		border-radius: 2px;
		background: color-mix(in oklab, var(--co-subagent) 16%, transparent);
		overflow: hidden;
	}
	.back {
		display: block;
		height: 100%;
		/* Never invisible: a 1% share is the strongest thing this panel has to
		   say, and a zero-width bar says nothing at all. */
		min-width: 2px;
		background: var(--co-subagent);
	}

	.nousage {
		margin: 0.3rem 0 0;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}
</style>
