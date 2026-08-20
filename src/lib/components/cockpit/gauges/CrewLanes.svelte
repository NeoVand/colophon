<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import { ms } from '$lib/xray/format';

	/**
	 * Delegation, drawn as lanes on the run's own clock.
	 *
	 * A subagent shows up in the stream as a tool called `agent-<key>` and
	 * nothing else — there is no chunk kind for "a whole second agent just spent
	 * its own context window". Drawn as one more tool chip it looks like one more
	 * tool call, which is the opposite of what it costs and the opposite of what
	 * it is for: everything inside that lane was paid for once, in a window that
	 * was then discarded, and only the small reply came back.
	 *
	 * So each dispatch is a bar placed at the moment it started, its width the
	 * time it took, against the same axis for every lane. That is what makes the
	 * two readings arrive together — *when* the parent handed work off, and how
	 * long it then sat waiting — and neither is visible from the conversation.
	 *
	 * The indent is the claim. A lane offset from the rail on the left is saying
	 * "this ran inside the turn above it", which is the whole reason the cost is
	 * surprising.
	 *
	 * ── Only dispatched subagents get a lane ────────────────────────────────
	 * harnessXray can draw an empty track for a subagent that was never reached
	 * for, because it can inspect the agent's roster. Colophon's agent is built
	 * server-side and the browser is never handed its definition, so a lane here
	 * exists only once a delegation has actually happened. An empty instrument
	 * therefore means "nothing was delegated", not "there is nobody to delegate
	 * to" — which is why the idle line says what it says.
	 */

	/** Live width for a delegation still running. See the note in `ToolDial`. */
	let now = $state(0);

	// `onMount`, not `$effect`: an effect that reads the dispatches and writes the
	// clock is the `effect_update_depth_exceeded` trap `docs/UI.md` names.
	onMount(() => {
		now = performance.now();
		const id = setInterval(() => (now = performance.now()), 250);
		return () => clearInterval(id);
	});

	interface Dispatch {
		key: string;
		startedAt: number;
		dur: number;
		live: boolean;
		failed: boolean;
	}

	/**
	 * The axis, taken from every tool call in the run rather than only from the
	 * delegations.
	 *
	 * Scaling to the delegations alone would stretch a single subagent call to
	 * the full width and quietly claim it was the whole run. Against the parent's
	 * own working span, a 40-second read next to eight quick searches is drawn as
	 * what it is.
	 */
	const axis = $derived.by(() => {
		let from = Infinity;
		let to = -Infinity;
		for (const turn of session.turns) {
			for (const tool of turn.tools) {
				from = Math.min(from, tool.startedAt);
				to = Math.max(to, tool.endedAt ?? now);
			}
		}
		return Number.isFinite(from) ? { from, span: Math.max(1, to - from) } : undefined;
	});

	const lanes = $derived.by(() => {
		const order: string[] = [];
		const bag: Record<string, Dispatch[]> = {};

		session.turns.forEach((turn, ti) => {
			turn.tools.forEach((tool, ci) => {
				if (!tool.subagent) return;
				const end = tool.endedAt ?? now;
				const dispatch: Dispatch = {
					// Turn and position, not the tool-call id alone: a malformed stream
					// can hand us an empty id, and two identical keys in one `{#each}`
					// throw and abort the render rather than merely misdrawing.
					key: `${ti}.${ci}.${tool.id}`,
					startedAt: tool.startedAt,
					dur: Math.max(0, end - tool.startedAt),
					live: !tool.done,
					failed: Boolean(tool.failed)
				};
				if (!bag[tool.subagent]) {
					bag[tool.subagent] = [];
					order.push(tool.subagent);
				}
				bag[tool.subagent].push(dispatch);
			});
		});

		return order.map((name) => {
			const runs = bag[name];
			return {
				name,
				runs,
				spent: runs.reduce((n, r) => n + r.dur, 0),
				live: runs.some((r) => r.live)
			};
		});
	});
</script>

<div class="crew">
	{#if !lanes.length}
		<span class="idle">nothing delegated yet</span>
	{:else}
		<ul class="lanes">
			{#each lanes as lane (lane.name)}
				<li class:live={lane.live}>
					<span class="name">{lane.name}</span>
					<span class="track">
						{#each lane.runs as r (r.key)}
							<span
								class="run"
								class:live={r.live}
								class:failed={r.failed}
								style:left="{axis ? ((r.startedAt - axis.from) / axis.span) * 100 : 0}%"
								style:width="{axis ? (r.dur / axis.span) * 100 : 0}%"
								title="{lane.name} — {r.live ? 'running' : ms(r.dur)}"
							></span>
						{/each}
					</span>
					<span class="co-num spent">{ms(lane.spent)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.crew {
		height: 100%;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		overflow: hidden;
	}

	.lanes {
		margin: 0;
		padding: 0 0 0 0.55rem;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-height: 0;
		/*
			The rail, and the indent it justifies.

			A hairline on the left with everything offset from it is the same claim
			the event timeline makes by indenting a subagent's rows: this work
			happened *inside* the parent. It is one line rather than a box, per the
			house rule — the only line in the instrument, and it is doing an actual
			job.
		*/
		border-left: 1px solid color-mix(in oklab, var(--co-subagent) 30%, transparent);
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.name {
		flex: none;
		width: 9ch;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: color-mix(in oklab, var(--co-subagent) 70%, var(--muted-foreground));
		transition: color 240ms ease;
	}
	li.live .name {
		color: var(--co-subagent);
	}

	.track {
		position: relative;
		flex: 1;
		min-width: 0;
		height: 7px;
		border-radius: 2px;
		background: color-mix(in oklab, var(--foreground) 4%, transparent);
	}

	.run {
		position: absolute;
		top: 0;
		bottom: 0;
		/* A dispatch that took no measurable time is still a dispatch, and a
		   zero-width bar would erase it from a lane that exists because of it. */
		min-width: 3px;
		border-radius: 2px;
		background: var(--co-subagent);
		transition:
			left 300ms ease,
			width 300ms ease;
	}
	.run.failed {
		background: var(--co-error);
	}
	.run.live {
		animation: breathe 1.4s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			opacity: 0.45;
		}
	}

	.spent {
		flex: none;
		width: 4.5ch;
		text-align: right;
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}

	.idle {
		margin: auto;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--muted-foreground);
		opacity: 0.55;
	}
</style>
