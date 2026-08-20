<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { fade, fly } from 'svelte/transition';
	import { ICON } from '$lib/icons';
	import { list, remove, touch, type ThreadEntry } from '$lib/threads';

	/**
	 * The way back to a conversation.
	 *
	 * Until this existed the app had a "new thread" button and no door in the
	 * other direction: starting a thread ended the previous one, permanently, as
	 * far as anyone using the app could tell. That is the same trap the header
	 * comment warns about — a mode you can enter and not get out of — and it was
	 * costing real work rather than merely being awkward.
	 *
	 * A sheet rather than a permanent rail, because history is something you go
	 * looking for perhaps twice a day, and a column of old titles standing beside
	 * the conversation all the time is a column of noise. Three ways out — the
	 * scrim, Escape, the close button — so the sheet is never itself a trap.
	 */

	let {
		open = $bindable(false),
		current,
		onopen
	}: {
		open?: boolean;
		/** The thread on screen now, marked in the list so you know where you are. */
		current: string;
		onopen: (id: string) => void;
	} = $props();

	let rows = $state<ThreadEntry[]>([]);
	let panel = $state<HTMLElement>();

	/**
	 * The clock, read once per opening.
	 *
	 * "3h ago" is computed against this rather than against a live now, so the
	 * relative times in an open sheet stay put instead of quietly ticking over
	 * while someone reads down the list.
	 */
	let now = $state(0);

	/**
	 * A plain `let`, not `$state` — this is edge detection, and reading a
	 * reactive flag inside the effect that also sets it is precisely the
	 * `effect_update_depth_exceeded` loop this codebase has shipped twice.
	 */
	let wasOpen = false;

	$effect(() => {
		// Reads `open`, writes `rows`/`now`, reads neither of them back.
		if (open && !wasOpen) {
			rows = list();
			now = Date.now();
		}
		wasOpen = open;
	});

	$effect(() => {
		// Move focus into the sheet so Escape and Tab land somewhere sensible
		// rather than in the conversation the sheet is covering.
		panel?.focus();
	});

	function close() {
		open = false;
	}

	function pick(id: string) {
		// Opening counts as activity, so a thread you return to floats back to the
		// top next time — which is where you will look for it.
		touch(id);
		onopen(id);
		close();
	}

	/**
	 * Deleting the current thread is allowed.
	 *
	 * It removes the row, not the conversation: what is on screen stays on
	 * screen, it has simply stopped being listed. Hiding the delete on one row
	 * would be its own small mystery, and refusing it outright means the only way
	 * to forget the thing you are looking at is to start another thread first.
	 */
	function drop(id: string) {
		remove(id);
		rows = rows.filter((r) => r.id !== id);
	}

	const DAY = 86_400_000;

	function since(at: number): string {
		const seconds = Math.max(0, (now - at) / 1000);
		if (seconds < 60) return 'just now';

		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;

		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;

		const days = Math.floor(hours / 24);
		if (days === 1) return 'yesterday';
		if (days < 30) return `${days}d ago`;

		const then = new Date(at);
		// The year only when it is not this one — "Mar 4, 2026" beside "Mar 4"
		// tells you something; on every row it is furniture.
		const options: Intl.DateTimeFormatOptions =
			then.getFullYear() === new Date(now).getFullYear()
				? { month: 'short', day: 'numeric' }
				: { month: 'short', day: 'numeric', year: 'numeric' };

		return then.toLocaleDateString(undefined, options);
	}

	interface Band {
		label: string;
		rows: ThreadEntry[];
	}

	/**
	 * Today / this week / older.
	 *
	 * Bucketed against the start of the local day rather than against a rolling
	 * 24 hours, because "today" means the calendar day to a reader and something
	 * asked at nine this morning should not fall out of it at nine tomorrow
	 * morning while the heading still says today.
	 */
	const bands = $derived.by((): Band[] => {
		const midnight = new Date(now);
		midnight.setHours(0, 0, 0, 0);
		const today = midnight.getTime();
		const week = today - 6 * DAY;

		const out: Band[] = [
			{ label: 'today', rows: [] },
			{ label: 'this week', rows: [] },
			{ label: 'older', rows: [] }
		];

		for (const row of rows) {
			if (row.at >= today) out[0].rows.push(row);
			else if (row.at >= week) out[1].rows.push(row);
			else out[2].rows.push(row);
		}

		return out.filter((band) => band.rows.length > 0);
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && open) close();
	}}
/>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" transition:fade={{ duration: 120 }} onclick={close}></div>

	<div
		bind:this={panel}
		class="sheet"
		transition:fly={{ x: -18, duration: 190 }}
		role="dialog"
		aria-modal="true"
		aria-label="Threads"
		tabindex="-1"
	>
		<header>
			<HugeiconsIcon icon={ICON.thread} size={13} />
			<span class="co-eyebrow">threads</span>
			<button class="x" onclick={close} aria-label="Close threads">
				<HugeiconsIcon icon={ICON.close} size={13} />
			</button>
		</header>

		<div class="scroll">
			{#if bands.length === 0}
				<p class="quiet">
					Nothing here yet. The first thing you ask starts a thread, and every thread you start is
					listed here afterwards.
				</p>
			{:else}
				{#each bands as band (band.label)}
					<section>
						<p class="co-eyebrow band">{band.label}</p>
						<ul>
							{#each band.rows as row (row.id)}
								<li class="row" class:here={row.id === current}>
									<button class="pick" onclick={() => pick(row.id)}>
										<span class="title">{row.title}</span>
										<span class="meta co-num">
											{since(row.at)} · {row.turns}
											{row.turns === 1 ? 'turn' : 'turns'}
										</span>
									</button>
									<button
										class="del"
										onclick={() => drop(row.id)}
										aria-label="Delete thread {row.title}"
										title="Delete this thread from the list"
									>
										<HugeiconsIcon icon={ICON.trash} size={12} />
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: color-mix(in oklab, var(--background) 55%, transparent);
	}

	.sheet {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: 70;
		display: flex;
		flex-direction: column;
		width: min(20rem, 86vw);
		background: var(--background);
		border-right: 1px solid color-mix(in oklab, var(--border) 90%, transparent);
		/* The one shadow in the app, and it earns it: this is a layer over the
		   conversation rather than a region of it, and nothing else says so. */
		box-shadow: 0 0 40px -20px rgb(0 0 0 / 0.65);
	}
	.sheet:focus {
		outline: none;
	}

	header {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		height: 2.6rem;
		padding: 0 0.6rem 0 0.9rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		color: var(--muted-foreground);
	}

	.x {
		margin-left: auto;
		display: flex;
		padding: 0.25rem;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		transition: color 150ms ease;
	}
	.x:hover {
		color: var(--foreground);
	}

	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.6rem 0.35rem 1.5rem 0.6rem;
	}

	.quiet {
		margin: 0.5rem 0.35rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		text-wrap: pretty;
	}

	section + section {
		margin-top: 1rem;
	}

	.band {
		margin: 0 0 0.25rem;
		padding-left: 0.35rem;
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: stretch;
		border-radius: var(--radius-sm);
		transition: background-color 150ms ease;
	}
	.row:hover {
		background: var(--muted);
	}

	.pick {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.4rem 0.35rem 0.45rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.title {
		font-size: 0.8125rem;
		line-height: 1.35;
		color: color-mix(in oklab, var(--foreground) 85%, transparent);
		/* One line, cut with an ellipsis: two-line titles turn a scannable
		   column into a wall, and the whole title is in the tooltip anyway. */
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}

	/* Where you are, marked by ink rather than by a box. */
	.row.here .title {
		color: var(--co-accent);
	}
	.row.here .meta {
		color: color-mix(in oklab, var(--co-accent) 55%, var(--muted-foreground));
	}

	.del {
		flex: none;
		display: flex;
		align-items: center;
		padding: 0 0.5rem;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		/* Hidden until wanted — a delete on every row, always visible, invites
		   exactly the accident it should be hard to have. It stays reachable by
		   keyboard: :focus-within brings it back. */
		opacity: 0;
		transition:
			opacity 150ms ease,
			color 150ms ease;
	}
	.row:hover .del,
	.row:focus-within .del {
		opacity: 1;
	}
	.del:hover {
		color: var(--co-error);
	}
</style>
