<script lang="ts">
	import { session } from '$lib/agent/session.svelte';
	import { bands, type Part, type PartKind } from '$lib/agent/context';
	import { tokens } from '$lib/xray/format';

	/**
	 * What the model is about to be sent, as a ring.
	 *
	 * `ContextPanel` is the better instrument for asking why a request costs what
	 * it does — it is a sorted ledger with a caveat at the bottom, and that is
	 * exactly right for auditing. It is the wrong shape for *watching*: it
	 * scrolls, and the question while a run is going is narrower and constant —
	 * what is filling the window right now.
	 *
	 * One arc per band, swept in payload order rather than sorted, so the ring is
	 * a picture of the actual request instead of a chart about it. The key beside
	 * it is sorted largest-first, because the useful reading there is which one
	 * or two bands dominate.
	 *
	 * ── Why there is no headroom arc ────────────────────────────────────────
	 * harnessXray's ring sweeps the model's input *limit*, so the unpainted part
	 * of the circle is the room left. Colophon cannot honestly draw that: the
	 * model is built server-side (`src/lib/server/model.ts` reads a private env
	 * var) and the browser is never told which one answered, let alone what its
	 * window is. A ring normalised against a guessed limit would put a fabricated
	 * number in the most prominent position on the instrument, which is the one
	 * failure this app exists to make visible. So the ring is the request, whole.
	 */

	/* The legend, as `ContextPanel` assigns it. Repeated rather than shared
	   because a gauge that imports a panel's private map is coupled to a panel. */
	const TONE: Record<string, string> = {
		system: '--co-memory',
		'tool-schema': '--co-tool',
		user: '--co-user',
		assistant: '--co-model',
		'tool-call': '--co-tool',
		'tool-result': '--co-library',
		'reasoning-ref': '--co-subagent',
		other: '--co-gate'
	};

	const ctx = $derived(session.context);

	/**
	 * Billed input tokens for *this* request, not for the turn.
	 *
	 * Zero between a context arriving and its step landing, and shown as an em
	 * dash rather than `0` — nothing has been billed for this call yet, and a
	 * zero there would read as a measurement.
	 */
	const billed = $derived(session.contextTokens);

	const merged = $derived(ctx ? bands(ctx.parts as Part[]) : []);

	const R = 38;
	const C = 2 * Math.PI * R;

	/** Each band with the point on the circle it starts at. Payload order. */
	const arcs = $derived.by(() => {
		let at = 0;
		return merged.map((b) => {
			const arc = { ...b, offset: at };
			at += b.share;
			return arc;
		});
	});

	/* Four rows at most. The key is a caption, not a table — the panel already
	   has the table, and a list long enough to need scrolling would break the one
	   rule the cockpit has. */
	const key = $derived([...merged].sort((a, b) => b.chars - a.chars).slice(0, 4));
	const rest = $derived(Math.max(0, merged.length - key.length));

	const toneOf = (kind: PartKind) => `var(${TONE[kind] ?? '--co-gate'})`;
</script>

<div class="ring">
	{#if !arcs.length}
		<span class="idle">nothing sent yet</span>
	{:else}
		<svg
			viewBox="-50 -50 100 100"
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label="The outgoing request, by band"
		>
			<!--
				Only the arcs rotate, not the whole SVG.

				Rotating the <svg> is the one-line way to start the sweep at twelve
				o'clock, and it takes the text with it — counter-rotating each label
				then fights `text-anchor` and lands the numbers off centre. A group of
				nothing but circles is rotationally symmetric, so rotating that is free
				and the text below stays in an untouched coordinate system.
			-->
			<g transform="rotate(-90)">
				<circle class="track" r={R} />
				{#each arcs as a (a.kind)}
					{#if a.share > 0}
						<circle
							class="arc"
							r={R}
							stroke={toneOf(a.kind)}
							stroke-dasharray="{a.share * C} {C}"
							stroke-dashoffset={-a.offset * C}
						>
							<title>{a.kind} — {Math.round(a.share * 100)}% of the request</title>
						</circle>
					{/if}
				{/each}
			</g>
			<text class="big" y="-1">{billed ? tokens(billed) : '—'}</text>
			<text class="sub" y="8">call {ctx?.call ?? 0}</text>
		</svg>

		<ul class="key">
			{#each key as b (b.kind)}
				<li>
					<i style:background={toneOf(b.kind)}></i>
					<span class="name">{b.kind}</span>
					<b class="co-num">{Math.round(b.share * 100)}%</b>
				</li>
			{/each}
			{#if rest}
				<li class="more">+{rest} more</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	.ring {
		height: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	svg {
		height: 100%;
		flex: 0 1 auto;
		min-width: 0;
	}

	text {
		text-anchor: middle;
		dominant-baseline: middle;
		font-family: var(--font-mono);
	}
	.big {
		font-size: 13px;
		font-weight: 600;
		fill: var(--foreground);
	}
	.sub {
		font-size: 5.5px;
		letter-spacing: 0.08em;
		fill: var(--muted-foreground);
	}

	.track {
		fill: none;
		stroke: color-mix(in oklab, var(--foreground) 7%, transparent);
		stroke-width: 9;
	}
	.arc {
		fill: none;
		stroke-width: 9;
		transition: stroke-dasharray 400ms ease;
	}

	.key {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
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
		gap: 0.3rem;
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
		font-weight: 500;
		color: color-mix(in oklab, var(--foreground) 75%, transparent);
	}
	.more {
		opacity: 0.6;
		padding-left: 8px;
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
