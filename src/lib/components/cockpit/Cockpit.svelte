<script lang="ts">
	import { session } from '$lib/agent/session.svelte';
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
	 * harnessXray reached this arrangement on its third attempt, and its notes
	 * are worth inheriting whole because each rule was learned by shipping the
	 * opposite:
	 *
	 * 1. **Nothing scrolls.** Every instrument is drawn to fit whatever box it
	 *    is given. A panel that scrolls inside a cockpit is a panel that did not
	 *    fit, and the mode exists precisely to stop hiding things behind
	 *    scrollbars.
	 * 2. **No borders.** A ring, a dial and a ribbon are already obviously three
	 *    different objects. Drawing a line around each adds six lines to a
	 *    surface trying to look like an instrument panel rather than a form.
	 * 3. **No grid.** This is the rule that is easiest to break by accident: a
	 *    grid is legible from *alignment*, so tiling six things on a shared
	 *    baseline reads as a table however little chrome sits on them.
	 *
	 * So the ribbon runs edge to edge behind everything as a horizon — a run is
	 * a line of time, and that is its natural shape — with the ring as the
	 * composition's anchor and the dial crowding its shoulder, so the two read
	 * as one assembly rather than two cells.
	 *
	 * Colophon's flank is narrower than harnessXray's full-screen cockpit, so
	 * this stacks rather than sprawls. The rules survive the change of scale;
	 * the sprawl would not.
	 */
	const busy = $derived(session.status !== 'idle');
</script>

<div class="cockpit">
	<div class="horizon" aria-hidden="true"><EventRibbon /></div>

	<div class="assembly">
		<div class="anchor">
			<Instrument label="context" tone="--co-tok-new" live={busy}>
				<ContextRing />
			</Instrument>
		</div>
		<div class="shoulder">
			<Instrument label="tools" tone="--co-tool" live={busy}>
				<ToolDial />
			</Instrument>
		</div>
	</div>

	<div class="row">
		<Instrument label="library" tone="--co-library">
			<LibraryField />
		</Instrument>
	</div>

	<div class="row">
		<Instrument label="crew" tone="--co-subagent">
			<CrewLanes />
		</Instrument>
	</div>

	<div class="row spend">
		<Instrument
			label="spend"
			tone="--co-tok-out"
			readout={session.usage.total ? session.usage.total.toLocaleString() : ''}
		>
			<SpendBars />
		</Instrument>
	</div>
</div>

<style>
	.cockpit {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		height: 100%;
		min-height: 0;
		/* The one place the no-scroll rule is enforced rather than assumed. */
		overflow: hidden;
	}

	/*
		Scenery, not an instrument.

		Behind everything and dimmed, so the shape of the run stays in peripheral
		vision without competing. It is the only element here whose natural shape
		is the full width, which is exactly why boxing it into a row was what made
		the first version read as cells.
	*/
	.horizon {
		position: absolute;
		inset: 0 0 auto 0;
		height: 40%;
		opacity: 0.28;
		pointer-events: none;
		z-index: 0;
	}

	.assembly {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-start;
		gap: 0;
		flex: 1.6;
		min-height: 0;
	}

	/* Twice the size of anything else, and the thing the eye lands on first. */
	.anchor {
		flex: 1.7;
		min-width: 0;
		min-height: 0;
		display: flex;
	}

	/* Overlapped on purpose: two round things sharing an edge read as one
	   assembly, which is most of what stops this looking like a form. */
	.shoulder {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		margin-left: -0.6rem;
		padding-top: 0.9rem;
	}

	.row {
		position: relative;
		z-index: 1;
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.row.spend {
		flex: 0.7;
	}

	.assembly :global(> * > *),
	.row :global(> *) {
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
</style>
