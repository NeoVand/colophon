<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { slide } from 'svelte/transition';
	import { ICON } from '$lib/icons';
	import ToolChip from './ToolChip.svelte';
	import type { ToolRun } from '$lib/agent/session.svelte';

	/**
	 * A tool call you can open.
	 *
	 * The chip is the right default: a run makes a dozen calls and a dozen
	 * expanded payloads is a wall of JSON where a conversation used to be. But
	 * the chip is also the point at which Colophon stops being inspectable —
	 * "search_papers" tells you a search happened, not what was searched for, and
	 * the difference between a good answer and a lucky one is usually in the
	 * query. So the chip stays exactly as it was, and clicking it unfolds the
	 * arguments the model actually wrote and what came back.
	 *
	 * `ToolChip` is used rather than reimplemented, so the tone legend, the
	 * delegation edge and the live clock cannot drift between the two surfaces.
	 * Only the tone is restated here, for the fold's own left edge.
	 */
	let { tool }: { tool: ToolRun } = $props();

	let open = $state(false);

	/* Mirrors ToolChip's legend exactly. Delegation keeps its colour even when
	   finished; a failure is red; a finished call recedes to the library sage. */
	const tone = $derived(
		tool.subagent
			? '--co-subagent'
			: tool.failed
				? '--co-error'
				: tool.done
					? '--co-library'
					: '--co-tool'
	);

	/**
	 * How much of a payload is shown before it is cut.
	 *
	 * Not a tidiness rule. `fetch_paper` returns the full text of a paper —
	 * measured at 40k–200k characters — and pasting that into the conversation
	 * as one `<pre>` costs a layout pass on every stream chunk that follows. The
	 * remainder is counted rather than silently dropped, because "what came back
	 * was enormous" is itself the interesting fact about a paper fetch.
	 */
	const CLIP = 4000;

	interface Shown {
		text: string;
		clipped: number;
	}

	function show(value: unknown): Shown {
		if (value === undefined) return { text: '', clipped: 0 };

		let text: string;
		if (typeof value === 'string') {
			text = value;
		} else {
			try {
				// `stringify` returns undefined for a bare function or symbol, which
				// would render the word "undefined" as if it were the payload.
				text = JSON.stringify(value, null, 2) ?? String(value);
			} catch {
				text = String(value);
			}
		}

		return text.length > CLIP
			? { text: text.slice(0, CLIP), clipped: text.length - CLIP }
			: { text, clipped: 0 };
	}

	const args = $derived(show(tool.args));
	const result = $derived(show(tool.result));
</script>

<div class="call" style:--tone="var({tone})">
	<button
		class="head co-bare"
		onclick={() => (open = !open)}
		aria-expanded={open}
		title={open ? 'Hide the call' : 'Show what was sent and what came back'}
	>
		<ToolChip {tool} />
		<span class="caret" class:down={open} aria-hidden="true">
			<HugeiconsIcon icon={ICON.collapse} size={11} />
		</span>
	</button>

	{#if open}
		<div class="fold" transition:slide={{ duration: 160 }}>
			<p class="co-eyebrow band">arguments</p>
			<pre>{args.text || '—'}</pre>
			{#if args.clipped > 0}
				<p class="co-num clipped">+{args.clipped.toLocaleString()} more characters</p>
			{/if}

			{#if tool.done}
				<p class="co-eyebrow band" class:bad={tool.failed}>{tool.failed ? 'error' : 'result'}</p>
				<pre class:bad={tool.failed}>{result.text || '—'}</pre>
				{#if result.clipped > 0}
					<p class="co-num clipped">+{result.clipped.toLocaleString()} more characters</p>
				{/if}
			{:else}
				<p class="co-eyebrow band pending">still running</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.call {
		display: inline-block;
		max-width: 100%;
	}

	.head {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		text-align: left;
	}

	.caret {
		display: flex;
		opacity: 0.45;
		transition:
			transform 180ms ease,
			opacity 180ms ease;
	}
	.head:hover .caret {
		opacity: 1;
	}
	/* One glyph for both states rather than two icons that have to be kept in
	   agreement — the arrow points where opening will take you. */
	.caret.down {
		transform: rotate(90deg);
		opacity: 1;
	}

	/* The fold hangs off the chip on the tone's own edge, so an opened
	   delegation still reads as a delegation at a glance down the turn. */
	.fold {
		margin: 0.35rem 0 0.15rem;
		padding-left: 0.6rem;
		border-left: 1px solid color-mix(in oklab, var(--tone) 35%, transparent);
	}

	.band {
		margin: 0.45rem 0 0.2rem;
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
	.band:first-child {
		margin-top: 0;
	}
	.band.bad {
		color: var(--co-error);
	}
	.band.pending {
		color: var(--co-tool);
	}

	pre {
		margin: 0;
		max-height: 18rem;
		overflow: auto;
		overscroll-behavior: contain;
		padding: 0.45rem 0.55rem;
		border-radius: 3px;
		background: var(--muted);
		color: color-mix(in oklab, var(--foreground) 82%, transparent);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		line-height: 1.55;
		white-space: pre-wrap;
		/* Tool payloads carry URLs and base64; without this one of them sets the
		   width of the whole conversation column. */
		overflow-wrap: anywhere;
	}
	pre.bad {
		color: var(--co-error);
		background: color-mix(in oklab, var(--co-error) 7%, var(--muted));
	}

	.clipped {
		margin: 0.2rem 0 0;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
</style>
