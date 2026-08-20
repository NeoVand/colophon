<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import { ms } from '$lib/xray/format';

	/**
	 * Every tool call in the run, as one burst.
	 *
	 * A list of tool calls answers "what happened third". The question a cockpit
	 * is asked is different and constant: what is this agent reaching for, and
	 * where is the time going. One spoke per call, arranged around a circle,
	 * length carrying duration — so a run that spent ninety seconds inside one
	 * `fetch_paper` looks nothing like one that made thirty quick searches, from
	 * across a room.
	 *
	 * Spokes are grouped by tool, in first-seen order, so each tool owns a sector
	 * and the dial does not reshuffle as calls arrive. A gauge whose needles swap
	 * places is not a gauge.
	 *
	 * Length is `sqrt(duration)`. One 90-second fetch beside twelve 400ms
	 * searches is a realistic run, and linear scaling turns that into a single
	 * spike and a flat circle; the square root keeps the short calls legible
	 * without lying about which is longest.
	 */

	/**
	 * Colour says which subsystem, not which tool.
	 *
	 * "Colour by tool" is the obvious reading and it would break the one rule the
	 * palette has: `--co-*` is a legend, and minting a hue per tool name would
	 * put colours on screen that mean nothing anywhere else in the app. So hue is
	 * the legend — ochre for retrieval, the subagent blue for a delegation, red
	 * for a failure — and tools *within* a hue are separated by a ladder of
	 * strengths instead. Mixed toward `--muted-foreground` rather than toward
	 * transparent, so the faintest step is still a mark on the page rather than a
	 * ghost of the background.
	 */
	const LADDER = [100, 76, 56, 40];

	/** Live duration for a call still running. See the ticker below. */
	let now = $state(0);

	/*
	 * A ticker, not an effect.
	 *
	 * The spokes need a clock to grow against while a tool is still running, and
	 * the obvious `$effect` that reads the calls and writes the clock is the
	 * `effect_update_depth_exceeded` trap `docs/UI.md` names. `onMount` has no
	 * dependencies to re-trigger on, so it cannot loop.
	 *
	 * 250ms because the spoke moves by less than a pixel in that time at any
	 * plausible duration, and a faster interval buys nothing anyone can see.
	 */
	onMount(() => {
		now = performance.now();
		const id = setInterval(() => (now = performance.now()), 250);
		return () => clearInterval(id);
	});

	interface Call {
		key: string;
		name: string;
		dur: number;
		live: boolean;
		failed: boolean;
		subagent: boolean;
	}

	const calls = $derived.by((): Call[] => {
		const out: Call[] = [];
		session.turns.forEach((turn, ti) => {
			turn.tools.forEach((tool, ci) => {
				const end = tool.endedAt ?? now;
				out.push({
					// Turn and position, not the tool-call id alone: a malformed
					// stream can hand us an empty id, and two empty keys in one
					// `{#each}` throws and aborts the render.
					key: `${ti}.${ci}.${tool.id}`,
					name: tool.name,
					dur: Math.max(0, end - tool.startedAt),
					live: !tool.done,
					failed: Boolean(tool.failed),
					subagent: Boolean(tool.subagent)
				});
			});
		});
		return out;
	});

	/** Calls grouped by tool, in the order each tool was first reached for. */
	const groups = $derived.by(() => {
		const order: string[] = [];
		const bag: Record<string, Call[]> = {};
		for (const call of calls) {
			if (!bag[call.name]) {
				bag[call.name] = [];
				order.push(call.name);
			}
			bag[call.name].push(call);
		}
		return order.map((name) => ({ name, calls: bag[name] }));
	});

	const R0 = 14;
	const R1 = 46;
	const peak = $derived(Math.max(1, ...calls.map((c) => c.dur)));

	const spokes = $derived.by(() => {
		const n = Math.max(1, calls.length);
		let i = 0;
		return groups.flatMap((group, gi) =>
			group.calls.map((call) => {
				// Half a step in, so the first spoke does not sit exactly on twelve
				// o'clock where it reads as a tick mark rather than a reading.
				const a = ((i++ + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
				const len = call.live ? R0 + 5 : R0 + (R1 - R0) * Math.sqrt(call.dur / peak);
				const step = LADDER[gi % LADDER.length];
				const hue = call.failed
					? 'var(--co-error)'
					: call.subagent
						? 'var(--co-subagent)'
						: `color-mix(in oklab, var(--co-tool) ${step}%, var(--muted-foreground))`;
				return {
					...call,
					c: hue,
					x1: Math.cos(a) * R0,
					y1: Math.sin(a) * R0,
					x2: Math.cos(a) * len,
					y2: Math.sin(a) * len
				};
			})
		);
	});

	const busy = $derived(calls.some((c) => c.live));
	const total = $derived(calls.reduce((n, c) => n + c.dur, 0));
</script>

<div class="dial">
	<svg
		viewBox="-52 -52 104 104"
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="{calls.length} tool calls across {groups.length} tools"
	>
		<circle class="hub" r={R0} />
		{#each spokes as s (s.key)}
			<g class="spoke" class:live={s.live} style:--c={s.c}>
				<title>{s.name} — {s.live ? 'running' : ms(s.dur)}</title>
				<line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
				<circle cx={s.x2} cy={s.y2} r={s.live ? 2.4 : 1.6} />
			</g>
		{/each}
		{#if calls.length}
			<text class="big" y="0">{calls.length}</text>
			<text class="sub" y="8">{groups.length} tools</text>
		{:else}
			<text class="sub" y="1">idle</text>
		{/if}
	</svg>
	{#if total}
		<span class="co-num total" class:busy>{ms(total)}</span>
	{/if}
</div>

<style>
	.dial {
		position: relative;
		height: 100%;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: grid;
		place-items: center;
		overflow: hidden;
	}
	svg {
		height: 100%;
		width: 100%;
	}

	.hub {
		fill: none;
		stroke: color-mix(in oklab, var(--foreground) 10%, transparent);
		stroke-width: 0.6;
	}

	.spoke line {
		stroke: var(--c);
		stroke-width: 1.7;
		stroke-linecap: round;
	}
	.spoke circle {
		fill: var(--c);
	}

	/* The one thing on the dial allowed to move: a call still on the wire. */
	.spoke.live circle {
		animation: pulse 1.1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}

	text {
		text-anchor: middle;
		dominant-baseline: middle;
		font-family: var(--font-mono);
		fill: var(--foreground);
	}
	.big {
		font-size: 11px;
		font-weight: 600;
	}
	.sub {
		font-size: 5px;
		letter-spacing: 0.08em;
		fill: var(--muted-foreground);
	}

	/* Wall-clock spent inside tools, in the corner rather than in the hub: the
	   hub answers "how many", and two numbers stacked there compete. */
	.total {
		position: absolute;
		right: 0;
		bottom: 0;
		font-size: 0.5rem;
		letter-spacing: 0.04em;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		transition: color 240ms ease;
	}
	.total.busy {
		color: var(--co-tool);
	}
</style>
