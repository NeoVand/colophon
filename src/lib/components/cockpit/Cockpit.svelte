<script lang="ts">
	import type { Snippet } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import { tokens } from '$lib/xray/format';
	import Instrument from './Instrument.svelte';
	import ContextRing from './gauges/ContextRing.svelte';
	import ToolDial from './gauges/ToolDial.svelte';
	import EventRibbon from './gauges/EventRibbon.svelte';
	import LibraryField from './gauges/LibraryField.svelte';
	import SpendBars from './gauges/SpendBars.svelte';
	import CrewLanes from './gauges/CrewLanes.svelte';
	import GraphPanel from '$lib/components/xray/GraphPanel.svelte';

	/**
	 * The same run, drawn instead of listed — and drawn across the whole room.
	 *
	 * ── The mistake this version fixes ──────────────────────────────────────
	 * Every earlier cockpit here was a *flank* mode: the chat kept its third of
	 * the screen and the instruments were rearranged inside the other two. That
	 * is why it read as "this really weird thing" rather than as a cockpit. A
	 * flank is a place for panels; putting drawings there just makes a third
	 * rendering of the same column, and since it also removed the panels it read
	 * as the X-ray having been taken away and something stranger left behind.
	 *
	 * harnessXray's cockpit was never that. It is the whole screen, with the
	 * conversation floating in the middle of it and no container around anything.
	 * The mode is not "the flank, drawn"; it is "the run, from above". That is the
	 * only arrangement in which a ring 300px across and a horizon 1300px wide are
	 * both the right size, and the only one where taking the panels away is a
	 * trade rather than a loss.
	 *
	 * So the deck now owns `main` and the chat lives inside it. The app header
	 * stays put above — a mode you can enter and not get back out of is a trap
	 * however good it looks, which is a lesson harnessXray learned by shipping one.
	 *
	 * ── The rules that carried over ─────────────────────────────────────────
	 * 1. **Nothing scrolls but the transcript.** Every instrument draws to fit
	 *    the box it is handed; bands take a share of the height rather than
	 *    claiming pixels. `overflow: hidden` at the root enforces it.
	 * 2. **No borders.** A ring, a horizon and a field of dots are already three
	 *    obviously different objects. The only lines drawn in here are
	 *    `SpendBars`' axis and the graph's connectors, both doing a job.
	 * 3. **Every gauge draws its face at zero.** A ring with no arcs is a ring; a
	 *    chart with no bars is an axis. Not one of them swaps its drawing for a
	 *    caption, because a blank box and a broken box look identical — which was
	 *    most of why the first version could not be recognised at rest.
	 * 4. **One anchor.** The context ring is weighted half again as large as
	 *    anything beside it, so the eye lands somewhere first.
	 */

	let { chat }: { chat: Snippet } = $props();

	/**
	 * The deck's own width, not the window's.
	 *
	 * Bound from the element rather than written from an `$effect`: the class it
	 * would set changes the layout it measures, which is the
	 * `effect_update_depth_exceeded` trap `docs/UI.md` names.
	 */
	let w = $state(0);

	/**
	 * Whether the instruments get both flanks or only one.
	 *
	 * Below this the centre column is squeezed to about forty characters by two
	 * gutters, and a transcript that narrow is worse than an instrument moved. So
	 * the left column folds into the right rather than the chat shrinking.
	 *
	 * One instrument does not survive the fold, and it is worth saying which and
	 * why. Six gauges in a single rack leave the pipeline about 130px, and it
	 * needs roughly 200 to draw seven stages at a readable size — under that it
	 * scales to its floor and *still* clips, which is the one thing a drawing of
	 * "what will execute" must never do. It is also the only instrument here that
	 * is not about this run: the topology is the code's shape, fixed at deploy,
	 * and during an ordinary conversation nothing in it lights up at all. So when
	 * something has to go, it is the one whose reading does not change.
	 * `GraphPanel` still carries it in the panel layout, in a pane you can drag.
	 */
	const wide = $derived(w >= 1180);

	const busy = $derived(session.status !== 'idle');
	const calls = $derived(session.turns.reduce((n, t) => n + t.tools.length, 0));
	const spent = $derived(session.usage.total);

	/**
	 * Distinct subagents actually dispatched.
	 *
	 * Counted here because the deck has to know whether that instrument exists
	 * before it mounts it. An array with a linear `includes` rather than a `Set`:
	 * the count is at most a handful of names, and a bare `Set` inside a rune is
	 * what the Svelte linter flags because it cannot tell a throwaway from state.
	 */
	const crew = $derived.by(() => {
		const names: string[] = [];
		for (const turn of session.turns)
			for (const tool of turn.tools)
				if (tool.subagent && !names.includes(tool.subagent)) names.push(tool.subagent);
		return names.length;
	});
</script>

<!--
	Each instrument is written once and placed by the deck below, rather than
	spelled out in each of the two arrangements. That is how a readout drifts out
	of sync with its twin the first time one of them is edited.
-->
{#snippet context()}
	<Instrument
		label="context"
		tone="--co-tok-new"
		readout={session.context ? `call ${session.context.call}` : '—'}
		live={busy}
		grow={1.6}
	>
		<ContextRing />
	</Instrument>
{/snippet}

{#snippet tools()}
	<Instrument label="tools" tone="--co-tool" readout={calls ? `${calls} calls` : '—'} live={busy}>
		<ToolDial />
	</Instrument>
{/snippet}

{#snippet graph()}
	<Instrument label="pipeline" tone="--co-subagent" grow={1.4}>
		<GraphPanel bare />
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
	<Instrument label="spend" tone="--co-tok-out" readout={spent ? tokens(spent) : '—'} grow={0.9}>
		<SpendBars />
	</Instrument>
{/snippet}

{#snippet crewLanes()}
	<Instrument label="crew" tone="--co-subagent" readout="{crew} lanes" live={busy} grow={0.7}>
		<CrewLanes />
	</Instrument>
{/snippet}

<div class="deck" class:wide bind:clientWidth={w}>
	<!--
		The horizon. Full width, at the top, labelled.

		A run is a line of time, so this is the one instrument whose natural shape
		is the width of the screen. harnessXray runs it *behind* everything at low
		opacity as scenery; that needs a screen with room to spare above and below
		the chat, and here it left a grey smear lying across two live gauges. It is
		an instrument in its own band instead — still the widest thing on the deck,
		no longer underneath anything.
	-->
	<div class="horizon">
		<Instrument
			label="events"
			tone="--co-model"
			readout={String(session.events.length)}
			live={busy}
		>
			<EventRibbon />
		</Instrument>
	</div>

	<div class="floor">
		{#if wide}
			<aside class="rack left">
				{@render context()}
				{@render tools()}
				{#if crew}{@render crewLanes()}{/if}
			</aside>
		{/if}

		<!--
			The conversation, floating: no panel, no border, no header. `max-width`
			rather than a share of the row, so the measure stays readable on a very
			wide screen instead of the line length growing with the monitor.
		-->
		<section class="stage">{@render chat()}</section>

		<aside class="rack right">
			{#if wide}
				{@render graph()}
			{:else}
				<div class="row">
					{@render context()}
					{@render tools()}
				</div>
			{/if}
			{@render library()}
			{@render spend()}
			{#if crew && !wide}{@render crewLanes()}{/if}
		</aside>
	</div>
</div>

<style>
	.deck {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		height: 100%;
		min-height: 0;
		/* Bottom padding is not symmetry — the last instrument in each rack is a
		   readout on its own baseline (`SpendBars`' price, `LibraryField`'s key) and
		   without it those sit on the window edge and get clipped by a pixel or two,
		   which reads as a rendering fault rather than as a tight margin. */
		padding: 0.85rem 1rem 0.7rem;
		/* The one place the no-scroll rule is enforced rather than assumed. */
		overflow: hidden;
	}

	/*
		Measured in pixels, because a horizon has a natural thickness: a
		proportional one vanishes in a short window and becomes a wall in a tall
		one. `clamp` keeps it a line at both ends.
	*/
	.horizon {
		flex: 0 0 clamp(46px, 8%, 70px);
		display: flex;
		min-height: 0;
	}

	.floor {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 1.6rem;
	}

	/*
		The instrument columns.

		Percentages rather than pixels: at 1400px each rack is ~350px, which is
		what the round gauges need to be read by area, and at 2000px they grow with
		the screen instead of stranding the chat in the middle of a field.
	*/
	.rack {
		flex: 0 0 25%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
	}
	/* Only one rack, so it may have more of the room to divide. */
	.deck:not(.wide) .rack.right {
		flex: 0 0 34%;
	}

	/* Two round gauges side by side when they are sharing a single column. */
	.row {
		display: flex;
		gap: 1.2rem;
		min-width: 0;
		min-height: 0;
		flex: 1.5 1 0;
	}

	.stage {
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		/* A transcript is prose. Past about this measure it stops being read and
		   starts being scanned, however much monitor there is. */
		max-width: 46rem;
		margin: 0 auto;
		width: 100%;
	}
</style>
