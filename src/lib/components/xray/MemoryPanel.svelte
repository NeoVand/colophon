<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import Prose from '$lib/components/Prose.svelte';

	/**
	 * The part that survives the conversation.
	 *
	 * Colophon's working memory is **resource-scoped**, not thread-scoped: a new
	 * conversation still knows who it is writing for. That is the difference
	 * between a chat that forgets you every morning and a companion that gets
	 * better at its job the longer you use it, and it is the single feature this
	 * project is built around.
	 *
	 * Showing it is not decoration. An agent that quietly accumulates a profile
	 * of someone and never shows it to them is doing something different from an
	 * agent that remembers — the difference is entirely in whether you can look.
	 * So it is on screen, in full, in the reader's own language, and the model
	 * wrote every word of it.
	 *
	 * Refetched when a turn ends rather than polled: `updateWorkingMemory` is a
	 * tool the model calls mid-run, so the moment it can have changed is the
	 * moment the run goes idle.
	 */

	let text = $state<string | null>(null);
	let error = $state('');
	let configured = $state(true);
	let loaded = $state(false);
	let open = $state(false);

	async function load() {
		try {
			const response = await fetch('/api/memory');
			const data = (await response.json()) as {
				configured: boolean;
				text: string | null;
				error?: string;
			};
			configured = data.configured;
			text = data.text;
			error = data.error ?? '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loaded = true;
		}
	}

	// `onMount`, not `$effect` — this writes state it would otherwise depend on,
	// which is the shape that produced `effect_update_depth_exceeded` here once.
	onMount(load);

	/**
	 * Refetch on the falling edge of a run.
	 *
	 * Tracks `status` and acts only on the transition to idle. Reloading on every
	 * status change would fire mid-run for nothing; polling would ask a database
	 * a question whose answer only changes when a specific tool runs.
	 */
	// Deliberately NOT `$state`. The effect reads `session.status` and writes
	// this; if it were reactive the effect would depend on a value it assigns,
	// which is the shape that produced `effect_update_depth_exceeded` in this
	// codebase once already. A plain closure variable creates no dependency, so
	// the only thing that can re-run this effect is the status actually changing
	// — which is the only thing that should.
	let wasBusy = false;
	$effect(() => {
		const busy = session.status !== 'idle';
		if (wasBusy && !busy) load();
		wasBusy = busy;
	});

	/** Headings with nothing under them — what it has not learned yet. */
	const empty = $derived.by(() => {
		if (!text) return [];
		const sections = text.split(/^##\s+/m).slice(1);
		return sections
			.filter((s) => {
				const body = s.split('\n').slice(1).join('\n');
				// A template heading whose only content is its own HTML comment
				// prompt counts as unfilled.
				return !body.replace(/<!--[\s\S]*?-->/g, '').trim();
			})
			.map((s) => s.split('\n')[0].trim());
	});

	const filled = $derived(
		Boolean(
			text
				?.replace(/<!--[\s\S]*?-->/g, '')
				.replace(/^#.*$/gm, '')
				.trim()
		)
	);
</script>

<section class="panel">
	<header>
		<span class="co-eyebrow">memory</span>
		<span class="co-eyebrow scope">resource</span>
		{#if filled}
			<button class="co-eyebrow toggle" onclick={() => (open = !open)}
				>{open ? 'hide' : 'read'}</button
			>
		{/if}
	</header>

	{#if !loaded}
		<p class="quiet">…</p>
	{:else if !configured}
		<p class="quiet">No database, so nothing survives a reload.</p>
	{:else if error}
		<p class="err">{error}</p>
	{:else if !filled}
		<p class="quiet">
			Nothing learned yet. Colophon writes this itself as it works out what you care about — and it
			outlives this conversation, so a new thread will still know.
		</p>
	{:else if open}
		<div class="body"><Prose text={text ?? ''} /></div>
	{:else}
		<p class="quiet">
			A profile it wrote itself, carried into every new conversation.
			{#if empty.length}
				Still blank: {empty.join(', ').toLowerCase()}.
			{/if}
		</p>
	{/if}
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-height: 0;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex: none;
	}
	header > .co-eyebrow:first-child {
		color: color-mix(in oklab, var(--co-memory) 75%, var(--muted-foreground));
	}

	/* Not a decoration: `resource` is the whole claim — this is not scoped to
	   the thread, which is why it is still here tomorrow. */
	.scope {
		font-size: 0.5rem;
		padding: 0 0.25rem;
		border: 1px solid color-mix(in oklab, var(--co-memory) 30%, transparent);
		border-radius: 2px;
		color: color-mix(in oklab, var(--co-memory) 65%, var(--muted-foreground));
	}

	.toggle {
		margin-left: auto;
		border: 0;
		background: transparent;
		padding: 0;
		cursor: pointer;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
	.toggle:hover {
		color: var(--co-accent);
	}

	.quiet {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		text-wrap: pretty;
	}

	.err {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--co-error);
	}

	.body {
		overflow-y: auto;
		min-height: 0;
		/*
			Capped, because this panel sits above three others in a fixed column.
			Uncapped it grew to the height of the whole profile and pushed the
			context, library and event panels off the bottom — they were still
			laid out, so their text simply overlapped whatever was beneath it.
			A profile is allowed to be long; the column is not.
		*/
		max-height: 15rem;
		/* The profile is prose, but it is a readout — set smaller than a digest
		   so it reads as an instrument rather than as something to sit down with. */
		font-size: 0.8125rem;
	}
	.body :global(.co-prose) {
		font-size: 0.8125rem;
		max-width: none;
	}
	.body :global(.co-prose h1),
	.body :global(.co-prose h2) {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: color-mix(in oklab, var(--co-memory) 70%, var(--muted-foreground));
		margin: 0.8rem 0 0.25rem;
	}
	.body :global(.co-prose h1:first-child),
	.body :global(.co-prose h2:first-child) {
		margin-top: 0;
	}
	.body :global(.co-prose p),
	.body :global(.co-prose ul) {
		margin-bottom: 0.5rem;
	}
</style>
