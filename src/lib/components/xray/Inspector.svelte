<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import type { LoggedEvent } from '$lib/agent/session.svelte';
	import type { ColophonEvent } from '$lib/agent/events';
	import JsonView from './JsonView.svelte';
	import RawView from './RawView.svelte';

	/**
	 * One event, all the way down.
	 *
	 * The timeline is a list of claims — `search`, `3.4s`, `12 results`. Every
	 * one of them is a summary somebody wrote, and a summary is exactly the
	 * thing an X-ray is supposed to let you go behind. This is where the claim
	 * becomes checkable: the arguments the model actually wrote, the whole
	 * result object it got back, the request decomposition as it was assembled.
	 *
	 * Two readings of one frame, deliberately. **Decomposed** is the tree — the
	 * shape, folded to what fits, with the long strings held back. **Raw** is
	 * the same object printed whole, copyable. The tree is where you understand
	 * it; the raw pane is how you verify the tree was telling the truth, and how
	 * anything found here leaves the browser intact.
	 *
	 * The eyebrow carries the event's legend colour rather than a neutral one.
	 * The colour is the app's grammar — ochre is retrieval in the timeline, in
	 * the chip and here — so a reader who clicked an ochre row is met by an
	 * ochre header and never has to check they opened the right thing.
	 */

	interface Props {
		event: LoggedEvent | undefined;
		onclose: () => void;
	}

	let { event, onclose }: Props = $props();

	let tab = $state<'decomposed' | 'raw'>('decomposed');

	/** Matches the timeline's tones exactly; a row and its detail must agree. */
	function toneOf(e: ColophonEvent): string {
		switch (e.k) {
			case 'tool-call':
				return e.subagent ? '--co-subagent' : '--co-tool';
			case 'tool-result':
				return e.failed ? '--co-error' : e.subagent ? '--co-subagent' : '--co-library';
			case 'step':
			case 'context':
				return '--co-memory';
			case 'approval':
				return '--co-approval';
			case 'tripwire':
				return '--co-gate';
			case 'error':
				return '--co-error';
			default:
				return '--co-model';
		}
	}

	/** The one line that says what this frame was, before the payload does. */
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
			case 'tripwire':
				return e.reason;
			case 'done':
				return `${e.usage.total.toLocaleString()} tokens, run total`;
			case 'error':
				return e.message;
		}
	}

	const frame = $derived(event?.event);
	const tone = $derived(frame ? toneOf(frame) : '--co-model');
	const headline = $derived(frame ? headlineOf(frame) : '');
	const elapsed = $derived(event ? `${(event.at / 1000).toFixed(2)}s` : '');

	const TABS = ['decomposed', 'raw'] as const;

	/**
	 * Left/right along the tabs.
	 *
	 * Bound to the buttons rather than to the tablist: the tablist itself never
	 * takes focus — the roving `tabindex` below puts it on the selected tab — so
	 * a handler up there would only ever fire by bubbling anyway.
	 *
	 * Focus has to be moved by hand. Changing `tab` flips which button holds
	 * `tabindex="0"`, but the browser leaves focus on the button you pressed, so
	 * the next arrow key would arrive at a tab that is no longer selected.
	 */
	function onTabKey(press: KeyboardEvent) {
		const step = press.key === 'ArrowRight' ? 1 : press.key === 'ArrowLeft' ? -1 : 0;
		if (!step) return;
		press.preventDefault();
		const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
		tab = next;
		document.getElementById(`insp-tab-${next}`)?.focus();
	}
</script>

<!--
	Escape closes, and only while something is open — otherwise this component
	would be quietly eating the key for the rest of the page.
-->
<svelte:window
	onkeydown={(press) => {
		if (event && press.key === 'Escape') onclose();
	}}
/>

<aside class="inspector" style:--tone="var({tone})" aria-label="Event inspector">
	<header>
		{#if event}
			<span class="tick" aria-hidden="true"></span>
			<span class="co-eyebrow kind">{event.event.k}</span>
			<span class="co-num at">{elapsed}</span>
		{:else}
			<span class="co-eyebrow quiet-kind">inspector</span>
		{/if}
		<button class="close" type="button" onclick={onclose} aria-label="Close the inspector">
			<HugeiconsIcon icon={ICON.close} size={12} />
		</button>
	</header>

	{#if !event}
		<div class="empty">
			<HugeiconsIcon icon={ICON.inspect} size={18} />
			<p>
				Pick an event to see what it carried — the arguments as written, the result as returned.
			</p>
		</div>
	{:else}
		<p class="headline">{headline}</p>
		<p class="co-num meta">seq {event.seq} · turn {event.turn + 1}</p>

		<!--
			`aria-controls` only on the selected tab: the other panel is not
			rendered, and a reference to an id that is not in the document is a
			broken pointer rather than a promise about what would appear.
		-->
		<div class="tabs" role="tablist" aria-label="How to read this frame">
			{#each TABS as name (name)}
				<button
					class="co-eyebrow tab"
					class:on={tab === name}
					type="button"
					role="tab"
					id="insp-tab-{name}"
					aria-selected={tab === name}
					aria-controls={tab === name ? `insp-panel-${name}` : undefined}
					tabindex={tab === name ? 0 : -1}
					onclick={() => (tab = name)}
					onkeydown={onTabKey}
				>
					{name}
				</button>
			{/each}
		</div>

		<div
			class="body"
			role="tabpanel"
			id="insp-panel-{tab}"
			aria-labelledby="insp-tab-{tab}"
			tabindex="-1"
		>
			<!--
				Keyed on the sequence number so selecting another event gives a fresh
				tree. Without it the new payload inherits the last one's open rows,
				which reads as the inspector having opened fields you never touched.
			-->
			{#key event.seq}
				{#if tab === 'decomposed'}
					<JsonView value={event.event} openTo={2} />
				{:else}
					<RawView value={event.event} label={event.event.k} />
				{/if}
			{/key}
		</div>
	{/if}
</aside>

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		gap: 0.35rem;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		flex: none;
	}

	/* The same 4px mark the timeline row carries, in the same colour — the two
	   are one object seen twice, and should look it. */
	.tick {
		flex: none;
		width: 4px;
		height: 4px;
		border-radius: 1px;
		background: var(--tone);
		transform: translateY(-1px);
	}

	.kind {
		color: var(--tone);
	}
	.quiet-kind {
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	.at {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	.close {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		border: 0;
		background: transparent;
		padding: 0.1rem;
		cursor: pointer;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		transition: color 180ms ease;
	}
	.close:hover {
		color: var(--foreground);
	}

	.headline {
		margin: 0;
		flex: none;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.4;
		color: color-mix(in oklab, var(--foreground) 88%, transparent);
		overflow-wrap: anywhere;
		text-wrap: pretty;
	}

	.meta {
		margin: 0;
		flex: none;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}

	.tabs {
		display: flex;
		gap: 0.15rem;
		flex: none;
		padding-top: 0.15rem;
	}
	.tab {
		border: 0;
		background: transparent;
		padding: 0 0.25rem;
		cursor: pointer;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		transition: color 180ms ease;
	}
	.tab:hover {
		color: var(--muted-foreground);
	}
	.tab.on {
		color: var(--co-accent);
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-top: 0.15rem;
		/* Paid back on the right so the content is inset evenly once the
		   scrollbar has taken its gutter. */
		padding-right: 0.15rem;
	}
	.body:focus-visible {
		outline: none;
	}

	.empty {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.6rem;
		color: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
	}
	.empty p {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		text-wrap: pretty;
	}
</style>
