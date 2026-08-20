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
	 *
	 * ── The face is drawn before there is anything to draw on it ────────────
	 * The empty dial used to be a small hub circle and the word `idle`, which on
	 * a fresh page is a 28px ring in a 200px box — an instrument that looks
	 * half-rendered rather than at rest. A real dial has a face whether or not a
	 * needle is on it, so the rim and its twelve ticks are drawn unconditionally
	 * and the spokes land inside them. That also fixes the scale: the rim marks
	 * where the longest call in the run will reach, so a single short spoke reads
	 * as short instead of as the whole gauge.
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
	const rung = (gi: number) =>
		`color-mix(in oklab, var(--co-tool) ${LADDER[gi % LADDER.length]}%, var(--muted-foreground))`;

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

	/** The face: twelve marks at the rim, where the longest call reaches. */
	const TICKS = Array.from({ length: 12 }, (_, i) => {
		const a = (i / 12) * Math.PI * 2;
		return {
			x1: Math.cos(a) * (R1 - 3.5),
			y1: Math.sin(a) * (R1 - 3.5),
			x2: Math.cos(a) * R1,
			y2: Math.sin(a) * R1
		};
	});

	const spokes = $derived.by(() => {
		const n = Math.max(1, calls.length);
		let i = 0;
		return groups.flatMap((group, gi) =>
			group.calls.map((call) => {
				// Half a step in, so the first spoke does not sit exactly on twelve
				// o'clock where it reads as a tick mark rather than a reading.
				const a = ((i++ + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
				const len = call.live ? R0 + 5 : R0 + (R1 - R0) * Math.sqrt(call.dur / peak);
				const hue = call.failed
					? 'var(--co-error)'
					: call.subagent
						? 'var(--co-subagent)'
						: rung(gi);
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

	const total = $derived(calls.reduce((n, c) => n + c.dur, 0));

	/**
	 * How big the hub reading can be without leaving the hole it sits in.
	 *
	 * The inner clearance is about 44 viewBox units across. A mono digit is
	 * roughly 0.6em, so `chars * 0.6 * size <= 44` — solved for size and clamped
	 * so a two-character reading does not balloon and a seven-character one still
	 * has a floor it stays legible at.
	 */
	const hubSize = $derived.by(() => {
		const text = total ? ms(total) : '—';
		return Math.max(6.5, Math.min(11, 44 / (text.length * 0.6)));
	});

	/** Four tools at most beside the dial; the rest are a count. */
	const named = $derived(groups.slice(0, 4));
	const rest = $derived(Math.max(0, groups.length - named.length));

	/**
	 * Same measured breakpoint as `ContextRing`, for the same reason: this gauge
	 * shares a row, so its box is a fraction of a flank that runs 400px to
	 * 1200px. Under 190px the names are clipped mono noise; over it they are what
	 * keeps a wide cell from being a circle with a dead margin — and they are the
	 * only place the dial says *which* tools those spokes are.
	 */
	let boxW = $state(0);
	const showKey = $derived(boxW >= 190 && groups.length > 0);
</script>

<div class="dial" class:solo={!showKey} bind:clientWidth={boxW}>
	<svg
		viewBox="-52 -52 104 104"
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="{calls.length} tool calls across {groups.length} tools"
	>
		<g class="face">
			<circle class="rim" r={R1} />
			<circle class="hub" r={R0} />
			{#each TICKS as t, i (i)}
				<line class="tick" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
			{/each}
		</g>
		{#each spokes as s (s.key)}
			<g class="spoke" class:live={s.live} style:--c={s.c}>
				<title>{s.name} — {s.live ? 'running' : ms(s.dur)}</title>
				<line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
				<circle cx={s.x2} cy={s.y2} r={s.live ? 2.4 : 1.6} />
			</g>
		{/each}
		<!-- Time in the hub, tool count beneath it. The call count is the
		     instrument's header readout and is deliberately not repeated here:
		     three numbers on one gauge is a panel, and one of them said the same
		     thing twice. -->
		<!--
			The hub reading shrinks with its own length.

			`ms()` is `12ms` on the first call and `38m 29s` once seven readers have
			been running for five minutes, and the second is three times as wide as
			the first. At a fixed 11px the long form ran out under the spokes and
			collided with the `tools` line below it — a gauge that becomes unreadable
			exactly when the run is at its most interesting. `textLength` was the
			other option and it distorts the glyphs; picking a size keeps the mono
			face honest.
		-->
		<text class="big" y="-1" style:font-size="{hubSize}px">{total ? ms(total) : '—'}</text>
		<text class="sub" y="8">{groups.length ? `${groups.length} tools` : 'idle'}</text>
	</svg>

	{#if showKey}
		<ul class="key">
			{#each named as g, gi (g.name)}
				<li>
					<i style:background={rung(gi)}></i>
					<span class="name">{g.name}</span>
					<b class="co-num">{g.calls.length}</b>
				</li>
			{/each}
			{#if rest}
				<li class="more">+{rest}</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	.dial {
		height: 100%;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		overflow: hidden;
	}
	.dial.solo {
		justify-content: center;
	}

	svg {
		height: 100%;
		/* Square viewBox in a box narrower than it is tall would overflow at a
		   fixed width; `meet` plus this shrinks it to fit instead of clipping. */
		max-width: 100%;
		flex: 0 1 auto;
		min-width: 0;
	}

	.rim {
		fill: none;
		stroke: color-mix(in oklab, var(--foreground) 6%, transparent);
		stroke-width: 0.6;
	}
	.hub {
		fill: none;
		stroke: color-mix(in oklab, var(--foreground) 10%, transparent);
		stroke-width: 0.6;
	}
	.tick {
		stroke: color-mix(in oklab, var(--foreground) 12%, transparent);
		stroke-width: 0.8;
		stroke-linecap: round;
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
		font-weight: 600;
	}
	.sub {
		font-size: 5px;
		letter-spacing: 0.08em;
		fill: var(--muted-foreground);
	}

	.key {
		flex: 1 1 0;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.22rem;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted-foreground);
		overflow: hidden;
	}
	.key li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}
	.key i {
		flex: none;
		width: 5px;
		height: 5px;
		border-radius: 1px;
	}
	.key .name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.key b {
		margin-left: auto;
		flex: none;
		font-weight: 500;
		color: color-mix(in oklab, var(--foreground) 75%, transparent);
	}
	.more {
		opacity: 0.6;
		padding-left: 8px;
	}
</style>
