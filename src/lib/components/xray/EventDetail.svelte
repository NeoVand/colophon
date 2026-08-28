<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import type { ColophonEvent } from '$lib/agent/events';
	import JsonView from './JsonView.svelte';
	import RawView from './RawView.svelte';

	/**
	 * One event's payload, opened where it was clicked.
	 *
	 * ── Why this is not a sheet any more ────────────────────────────────────
	 * It used to be. Clicking a row opened a right-hand panel over the app with
	 * a blurred scrim behind it, and that arrangement was wrong in a way worth
	 * naming, because it is a tempting default: **it took the run off screen to
	 * show you a piece of the run.** The one question you have while reading a
	 * payload is what came before and after it, and a modal answers it by
	 * hiding the answer. Worse, a scrim says "finish here, then go back", which
	 * is exactly the wrong shape for scanning a hundred events.
	 *
	 * harnessXray gets this right and did from early on: the detail lives under
	 * the row that names it, the timeline keeps scrolling, and two events can be
	 * compared by opening both. This is that arrangement, ported.
	 *
	 * ── Two readings, same as everywhere ────────────────────────────────────
	 * `decomposed` is a *reading* of the payload — it folds, it clamps, it
	 * collapses a Map into rows. `raw` is the literal frame. Both exist because
	 * an X-ray that only ever shows its own interpretation is asking to be
	 * trusted, and showing the source beside it is how it earns that.
	 */

	let {
		event,
		/** The row's colour, so the block reads as part of the row above it. */
		tone = '--co-model'
	}: {
		event: ColophonEvent;
		tone?: string;
	} = $props();

	/** Reset per event: opening a new row should not inherit the last one's tab. */
	let view = $state<'decomposed' | 'raw'>('decomposed');

	/**
	 * The one line that says what this frame was, before the payload does.
	 *
	 * Exhaustive over the union on purpose — that exhaustiveness is what made
	 * the compiler point here the last time the event vocabulary grew, instead
	 * of a new kind quietly rendering as a blank heading.
	 */
	function headlineOf(e: ColophonEvent): string {
		switch (e.k) {
			case 'start':
				return e.runId || 'run started';
			case 'text':
				return `${e.text.length.toLocaleString()} chars of answer`;
			case 'reasoning':
				return e.state === 'start' ? 'reasoning began' : 'reasoning ended';
			case 'tool-call':
				return e.subagent ? `${e.subagent} · delegated` : e.name;
			case 'tool-result':
				return e.failed
					? `${e.name ?? 'tool'} failed`
					: (e.subagent ?? e.name ?? 'returned to the model');
			case 'step':
				return `${e.usage.total.toLocaleString()} tokens this step`;
			case 'approval':
				return `${e.name} · waiting on you`;
			case 'context':
				return `call ${e.call}${e.model ? ` · ${e.model}` : ''}`;
			case 'stage':
				return e.state === 'start'
					? `${e.step} · started`
					: `${e.step} · ${e.state}${e.ms ? ` in ${(e.ms / 1000).toFixed(1)}s` : ''}`;
			case 'span':
				return `${e.span.kind} · ${e.span.name}`;
			case 'trace':
				return e.configured ? 'tracing on' : (e.reason ?? 'tracing off');
			case 'tripwire':
				return e.reason;
			case 'done':
				return `${e.usage.total.toLocaleString()} tokens, run total`;
			case 'error':
				return e.message;
		}
	}

	const headline = $derived(headlineOf(event));
</script>

<div class="detail" style:--tone="var({tone})">
	<div class="bar">
		<button
			class="mode"
			class:on={view === 'decomposed'}
			type="button"
			onclick={() => (view = 'decomposed')}
			aria-pressed={view === 'decomposed'}
			aria-label="Decomposed"
			title="Decomposed — the payload as a tree"
		>
			<HugeiconsIcon icon={ICON.inspect} size={11} />
		</button>
		<button
			class="mode"
			class:on={view === 'raw'}
			type="button"
			onclick={() => (view = 'raw')}
			aria-pressed={view === 'raw'}
			aria-label="Raw"
			title="Raw — the literal frame"
		>
			<HugeiconsIcon icon={ICON.raw} size={11} />
		</button>
		<span class="headline">{headline}</span>
	</div>

	<!--
		Keyed on the view rather than left to swap in place: `JsonView` holds each
		node's open state, and a tree re-rendered under a different reading would
		otherwise come back with rows opened that nobody touched.
	-->
	<div class="body">
		{#if view === 'decomposed'}
			<JsonView value={event} openTo={2} />
		{:else}
			<RawView value={event} label={event.k} />
		{/if}
	</div>
</div>

<style>
	/*
		A left rule in the row's own colour, so the block reads as belonging to
		the row above rather than as a sibling of it. The same device the subagent
		lane uses one level up, which is the point: nesting means the same thing
		wherever it appears in this panel.
	*/
	.detail {
		margin: 0.15rem 0 0.35rem 0.35rem;
		padding-left: 0.55rem;
		border-left: 1px solid color-mix(in oklab, var(--tone) 35%, transparent);
		white-space: normal;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.1rem 0 0.25rem;
	}

	.mode {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 1.1rem;
		height: 1.1rem;
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
		cursor: pointer;
		transition:
			color 140ms ease,
			background-color 140ms ease;
	}
	.mode:hover {
		color: var(--foreground);
		background: color-mix(in oklab, var(--muted) 70%, transparent);
	}
	.mode.on {
		color: var(--tone);
	}

	/* The sentence the row had no room for. Truncates rather than wrapping: this
	   bar is furniture, and furniture that changes height as you click along a
	   list makes the list jump under the cursor. */
	.headline {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}

	/*
		Bounded, and scrolls inside itself.

		A fetched paper's tool result is two hundred kilobytes; expanded inline
		with no cap it would push every later row a screen and a half down and
		make the timeline unusable as a timeline. Capping it keeps the row you
		opened, the rows around it, and the payload all on screen at once — which
		is the entire reason this is not a sheet.
	*/
	.body {
		max-height: 22rem;
		overflow: auto;
		padding-bottom: 0.2rem;
	}
</style>
