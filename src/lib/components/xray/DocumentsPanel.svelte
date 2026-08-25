<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { session } from '$lib/agent/session.svelte';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { relative } from '$lib/xray/format';

	/**
	 * What has been written, as opposed to what has been read.
	 *
	 * Every other panel on this flank reports on a *run*: papers it met, tools it
	 * called, money it spent, all of it gone when the thread is. This one reports
	 * on the only thing that outlives every run — the documents. It is here so
	 * that "give it a task and write the paper" has somewhere to land in view,
	 * rather than producing a row in a table nobody can see.
	 *
	 * Ordered by `updatedAt`, which is the vault's own default: "what you were
	 * last working on" is the question a list of drafts is actually asked.
	 *
	 * ── Why this fetches rather than reading the session ────────────────────────
	 * `session` is the run. Documents are not in it and should not be: they are
	 * written by an editor in another tab as often as by the agent, and folding
	 * them into run state would mean the panel goes stale the moment someone
	 * writes a paragraph anywhere else. One GET, on mount and when a run ends.
	 */

	/** Hosted in another frame's tab group; that frame draws the header. */
	let { bare = false }: { bare?: boolean } = $props();

	interface Row {
		id: string;
		title: string;
		kind: string;
		updatedAt: string | Date;
		chars: number;
	}

	let docs = $state<Row[]>([]);
	let configured = $state(true);
	let error = $state('');
	let loading = $state(false);

	async function load() {
		loading = true;
		try {
			const response = await fetch('/api/documents');
			const data = (await response.json()) as { configured: boolean; documents?: Row[] };
			configured = data.configured;
			docs = data.documents ?? [];
			error = '';
		} catch (cause) {
			// A failed listing must not read as an empty vault: "nothing written"
			// and "could not ask" are very different claims about someone's work.
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}

	// `onMount`, not `$effect` — this writes state it would otherwise depend on,
	// which is the shape that produced `effect_update_depth_exceeded` here once.
	onMount(load);

	/*
	 * Refetch on the falling edge of a run.
	 *
	 * Deliberately NOT `$state`: the effect reads `session.status` and writes
	 * this, and a reactive flag would make the effect depend on a value it
	 * assigns — the same loop again. A plain closure variable creates no
	 * dependency, so only the status actually changing can re-run it.
	 */
	let wasBusy = false;
	$effect(() => {
		const busy = session.status !== 'idle';
		if (wasBusy && !busy) load();
		wasBusy = busy;
	});
</script>

{#snippet tools()}
	<a class="tool" href={resolve('/write')} title="Open the writing surface" aria-label="Write">
		<HugeiconsIcon icon={ICON.external} size={13} />
	</a>
	<button class="tool" onclick={load} disabled={loading} title="Refresh" aria-label="Refresh">
		<HugeiconsIcon icon={ICON.refresh} size={13} />
	</button>
{/snippet}

<PanelFrame
	{bare}
	label="documents"
	icon={ICON.prose}
	tone="library"
	readout={docs.length ? String(docs.length) : undefined}
	actions={tools}
>
	{#if error}
		<EmptyState icon={ICON.error} tone="error" title="Could not read the vault" note={error} />
	{:else if !configured}
		<EmptyState icon={ICON.prose} tone="library" title="No database configured" />
	{:else if !docs.length}
		<EmptyState icon={ICON.prose} tone="library" title="Nothing written yet" />
	{:else}
		<ul>
			{#each docs as doc (doc.id)}
				<li>
					<!--
						`resolve()` takes the query string too — it is typed
						`RouteIdWithSearchOrHash` — so the whole href is one call rather than
						a resolved path with a `?` glued on afterwards. That matters beyond
						tidiness: `svelte/no-navigation-without-resolve` matches the call at
						the attribute and cannot see through a concatenation, so the glued
						version is a lint error dressed as a working link.
					-->
					<a class="row" href={resolve(`/write?doc=${doc.id}`)}>
						<span class="title">{doc.title}</span>
						<span class="co-num meta">{doc.kind} · {relative(doc.updatedAt)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</PanelFrame>

<style>
	/* The scroller carries the indent, so rows and their hairlines start at the
	   header's left edge rather than at the frame's. */
	ul {
		margin: 0;
		padding: 0.35rem 0.7rem 0.6rem;
		list-style: none;
		overflow-y: auto;
		min-height: 0;
	}
	li {
		border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
	}
	li:last-child {
		border-bottom: 0;
	}

	.row {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.4rem 0;
		text-decoration: none;
		color: inherit;
	}

	.title {
		flex: 1;
		min-width: 0;
		font-size: 0.78rem;
		line-height: 1.35;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: color-mix(in oklab, var(--foreground) 80%, transparent);
	}
	.row:hover .title {
		color: var(--foreground);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.meta {
		flex: none;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	.tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.35rem;
		height: 1.35rem;
		border: 0;
		border-radius: 2px;
		background: transparent;
		padding: 0;
		cursor: pointer;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
		transition:
			color 150ms ease,
			background-color 150ms ease;
	}
	.tool:hover:not(:disabled) {
		color: var(--foreground);
		background: color-mix(in oklab, var(--muted) 60%, transparent);
	}
	.tool:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
