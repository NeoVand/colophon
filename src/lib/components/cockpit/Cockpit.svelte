<script lang="ts">
	import { session } from '$lib/agent/session.svelte';
	import { tokens } from '$lib/xray/format';
	import Instrument from './Instrument.svelte';
	import ContextRing from './gauges/ContextRing.svelte';
	import ToolDial from './gauges/ToolDial.svelte';
	import EventRibbon from './gauges/EventRibbon.svelte';
	import LibraryField from './gauges/LibraryField.svelte';
	import SpendBars from './gauges/SpendBars.svelte';
	import CrewLanes from './gauges/CrewLanes.svelte';

	/**
	 * The same run, drawn instead of listed.
	 *
	 * ── What was wrong with the first arrangement ───────────────────────────
	 * It inherited harnessXray's composition whole, and harnessXray's cockpit is
	 * a full screen. Three of its rules do not survive the change of scale, and
	 * the version that kept them read as a broken page rather than as an
	 * alternative view:
	 *
	 * - **The horizon.** The event ribbon ran behind everything at 28% opacity.
	 *   In a 1600px room that is scenery; in a 400px flank it is a grey smear
	 *   lying across two live gauges, and on a fresh page — no events, no
	 *   ticks — it was *nothing at all*, which is what "I do not know what that
	 *   is" was pointing at. It is a labelled instrument now, at the top, in its
	 *   own band. It is still the widest thing here because a run is a line of
	 *   time; it is no longer underneath anything.
	 *
	 * - **Empty gauges.** Five of the six swapped their drawing for a caption —
	 *   `nothing sent yet`, `no events yet`, `nothing retrieved yet` — so the
	 *   first thing anyone saw was a sparse column of grey words in empty boxes.
	 *   Every gauge now draws its face at zero: a ring with no arcs is still a
	 *   ring, a ribbon with no events is a flat horizon, a bar chart with no bars
	 *   is an axis. Not one of the captions came back.
	 *
	 * - **The fixed stack.** One column of full-width bands wastes most of a
	 *   1200px flank on a 200px circle, and the round gauges wasted it worst. The
	 *   deck reflows on the flank's own measured width instead: the instruments
	 *   are the same six at every size, but how many share a row is not.
	 *
	 * ── What did survive ────────────────────────────────────────────────────
	 * 1. **Nothing scrolls.** Every instrument is drawn to fit whatever box it is
	 *    given, and the bands divide the height by flex weight rather than
	 *    claiming pixels, so the deck fits any height it is handed. `overflow:
	 *    hidden` at the root enforces it rather than assuming it.
	 * 2. **No borders.** A ring, a dial and a field of dots are already obviously
	 *    three different objects. The only line drawn anywhere in here is
	 *    `SpendBars`' axis, which is doing a job.
	 * 3. **One anchor.** The context ring is weighted half again as large as the
	 *    dial beside it, so the eye has somewhere to land first. That is what
	 *    harnessXray's overlap was buying; overlap itself needs room this layout
	 *    does not have, and a negative margin at flank width just clips a gauge.
	 *
	 * The no-grid rule is the one deliberately let go, and it is worth saying why
	 * rather than pretending. A grid reads as a table because of *alignment*, and
	 * that argument is about a full screen of eleven tiles. Six instruments of
	 * three different heights in a flank narrower than a phone in landscape have
	 * nowhere else to be, and the failure the rule guards against — reading as a
	 * form — is caused here by empty boxes and captions, both of which are gone.
	 * The bands are ragged by height and by count, never a fixed matrix.
	 */

	/**
	 * The flank's own width, which is the only breakpoint that matters.
	 *
	 * A media query would ask the *window*, and this component lives in a
	 * resizable pane: the window can be 1600px wide while this box is 380px. Bound
	 * from the element, never written from an `$effect` — that would be the
	 * `effect_update_depth_exceeded` trap `docs/UI.md` names, since the class it
	 * sets changes the layout it measures.
	 */
	let w = $state(0);

	/**
	 * How many instruments share the second band.
	 *
	 * Two thresholds rather than one because the round gauges and the wide ones
	 * fail differently. Under ~560px only the ring and the dial fit side by side
	 * at all. Over ~820px a third fits beside them, which is what stops a 1200px
	 * flank spending its whole top band on two circles.
	 */
	const across = $derived(w >= 820 ? 3 : w >= 560 ? 2 : 1);

	const busy = $derived(session.status !== 'idle');

	const calls = $derived(session.turns.reduce((n, t) => n + t.tools.length, 0));

	/**
	 * Distinct subagents actually dispatched.
	 *
	 * Counted here rather than read off `CrewLanes` because the deck has to know
	 * whether that instrument exists *before* it mounts it — see the note in the
	 * gauge about why it is the one with no honest empty state. Two lines of
	 * set-building, not a second copy of the lane layout.
	 */
	const crew = $derived.by(() => {
		// An array with a linear `includes` rather than a `Set`: the count is at
		// most a handful of names, and a bare `Set` inside a rune is the thing the
		// Svelte linter flags because it cannot tell a throwaway from state.
		const names: string[] = [];
		for (const turn of session.turns)
			for (const tool of turn.tools)
				if (tool.subagent && !names.includes(tool.subagent)) names.push(tool.subagent);
		return names.length;
	});

	const spent = $derived(session.usage.total);
</script>

{#snippet ribbon()}
	<Instrument label="events" tone="--co-model" readout={String(session.events.length)} live={busy}>
		<EventRibbon />
	</Instrument>
{/snippet}

{#snippet context()}
	<Instrument
		label="context"
		tone="--co-tok-new"
		readout={session.context ? `call ${session.context.call}` : '—'}
		live={busy}
		grow={1.5}
	>
		<ContextRing />
	</Instrument>
{/snippet}

{#snippet tools()}
	<Instrument label="tools" tone="--co-tool" readout={calls ? `${calls} calls` : '—'} live={busy}>
		<ToolDial />
	</Instrument>
{/snippet}

{#snippet library()}
	<Instrument
		label="library"
		tone="--co-library"
		readout={session.papers.length ? `${session.papers.length} papers` : '—'}
	>
		<LibraryField />
	</Instrument>
{/snippet}

{#snippet spend()}
	<Instrument label="spend" tone="--co-tok-out" readout={spent ? tokens(spent) : '—'}>
		<SpendBars />
	</Instrument>
{/snippet}

{#snippet crewLanes()}
	<Instrument label="crew" tone="--co-subagent" readout="{crew} lanes" live={busy}>
		<CrewLanes />
	</Instrument>
{/snippet}

<!--
	Each instrument is written once as a snippet and placed by the deck below.

	The alternative was the same `<Instrument>` block spelled out in two or three
	branches, which is how a readout drifts out of sync with its twin the first
	time one of them is edited.
-->
<div class="cockpit" bind:clientWidth={w}>
	<div class="band horizon">{@render ribbon()}</div>

	<div class="band assembly">
		{@render context()}
		{@render tools()}
		{#if across === 3}{@render library()}{/if}
	</div>

	{#if across === 3}
		<div class="band">{@render spend()}</div>
	{:else if across === 2}
		<div class="band">{@render library()}{@render spend()}</div>
	{:else}
		<div class="band">{@render library()}</div>
		<div class="band">{@render spend()}</div>
	{/if}

	{#if crew}
		<div class="band short">{@render crewLanes()}</div>
	{/if}
</div>

<style>
	.cockpit {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		height: 100%;
		min-height: 0;
		/* The one place the no-scroll rule is enforced rather than assumed. */
		overflow: hidden;
	}

	.band {
		display: flex;
		gap: 1.4rem;
		min-width: 0;
		min-height: 0;
		/* Weights, not pixels: the deck divides whatever height it is handed, so a
		   short window compresses the bands instead of pushing one off the bottom.
		   Each `Instrument` carries its own `flex` for the horizontal share. */
		flex: 1 1 0;
	}

	/*
		The ribbon's band is the one measured in pixels, because a horizon has a
		natural thickness and a proportional one either vanishes in a short window
		or becomes a wall in a tall one. `clamp` keeps it a line at both ends.
	*/
	.band.horizon {
		flex: 0 0 clamp(44px, 9%, 64px);
	}

	/* The top band earns extra height: the two round gauges read by area, and
	   the anchor is only an anchor if it is visibly the biggest thing here. */
	.band.assembly {
		flex: 1.55 1 0;
	}

	/* Lanes are rows of text; they do not get better with more room. */
	.band.short {
		flex: 0.7 1 0;
	}
</style>
