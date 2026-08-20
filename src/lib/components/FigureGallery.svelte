<script lang="ts" module>
	/** One row of `/api/figures`. Exported so a page route can type its load. */
	export interface Figure {
		key: string;
		/** Bytes on disk. Not the pixel dimensions — see the note in the route. */
		size: number;
		contentType: string;
		createdAt: string;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Dialog } from 'bits-ui';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import { session } from '$lib/agent/session.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	/**
	 * Everything Colophon has ever drawn.
	 *
	 * The figures existed long before this did. `generate_image` returned a path,
	 * `/figures/[...path]` served the bytes, and the only way to see one was to
	 * already know its name — which meant the most expensive artefact the agent
	 * makes was also the only one with no way back to it. This is the way back.
	 *
	 * ── Why the thumbnails are the full-size files ──────────────────────────────
	 * There is no thumbnail pipeline, and inventing one here would mean a second
	 * derived blob per figure in a store that is already capped. So a tile shows
	 * the real PNG scaled down, `loading="lazy"` so tiles below the fold cost
	 * nothing until they are scrolled to. The saving grace is the serving route's
	 * `immutable` cache header: by the time you click a tile the browser already
	 * holds those bytes, which is why the lightbox opens with no flash of empty
	 * frame. It is the right trade at forty figures and the wrong one at four
	 * thousand — when that day comes, the fix is a `?w=` variant beside the
	 * original, not a change here.
	 */

	let figures = $state<Figure[]>([]);
	let usedBytes = $state(0);
	let configured = $state(true);
	let error = $state('');
	let loaded = $state(false);

	/** Which figure the lightbox is showing. Only meaningful while `open`. */
	let index = $state(0);
	let open = $state(false);

	async function load() {
		try {
			const response = await fetch('/api/figures');
			const data = (await response.json()) as {
				configured: boolean;
				usedBytes: number;
				figures: Figure[];
				error?: string;
			};
			configured = data.configured;
			usedBytes = data.usedBytes ?? 0;
			figures = data.figures ?? [];
			error = data.error ?? '';
			// A refetch can return a shorter list than the one the lightbox is
			// pointing into. Left alone that is a modal showing a header and no
			// picture, which looks like a broken image rather than a stale index.
			if (index >= figures.length) index = 0;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loaded = true;
		}
	}

	// `onMount`, not `$effect`: this writes state it would otherwise depend on,
	// which is the shape that produced `effect_update_depth_exceeded` in this
	// codebase twice.
	onMount(load);

	/**
	 * Refetch on the falling edge of a run.
	 *
	 * A figure can only appear because a turn generated one, so the moment the
	 * gallery can be out of date is the moment the run goes idle. Polling would
	 * ask the database a question whose answer changes about once an hour.
	 */
	// Deliberately NOT `$state`. The effect reads `session.status` and writes
	// this; a reactive latch here would make the effect depend on a value it
	// assigns, and a plain closure variable creates no dependency at all — so
	// the only thing that can re-run this is the status actually changing.
	let wasBusy = false;
	$effect(() => {
		const busy = session.status !== 'idle';
		if (wasBusy && !busy) load();
		wasBusy = busy;
	});

	const current = $derived(figures[index]);

	const readout = $derived(
		figures.length
			? `${figures.length} ${figures.length === 1 ? 'figure' : 'figures'} · ${mb(usedBytes)} stored`
			: ''
	);

	/* ── formatting ─────────────────────────────────────────────────────────── */

	function mb(n: number): string {
		if (!Number.isFinite(n) || n <= 0) return '0 B';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
		return `${(n / 1024 / 1024).toFixed(1)} MB`;
	}

	/** ISO, not a friendly phrase. This is an archive; the exact day is the point. */
	function day(at: string): string {
		const date = new Date(at);
		return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
	}

	/**
	 * `figures/sae-composition.png` → `sae-composition.png`.
	 *
	 * Which is both the caption and the route parameter. The key's own prefix
	 * *is* the route: an image is stored under `figures/…` precisely so that the
	 * `![](/figures/x.png)` the agent writes into a document resolves without
	 * translation, so the remainder of the key is exactly `[...path]`.
	 *
	 * `resolve()` is written out at each href rather than wrapped in a helper —
	 * `svelte/no-navigation-without-resolve` matches the call at the attribute
	 * and cannot see through one, and an eslint-disable to hide a working link
	 * from the rule that guards base paths is a bad trade for four characters.
	 */
	function name(key: string): string {
		return key.replace(/^figures\//, '');
	}

	/* ── the lightbox ───────────────────────────────────────────────────────── */

	/**
	 * A plain click opens the lightbox; every other click belongs to the browser.
	 *
	 * The tile is an `<a>` pointing at the real PNG rather than a `<button>`, so
	 * cmd-click, middle-click and "open image in new tab" all do the obvious
	 * thing and land on the file itself. Intercepting only the unmodified
	 * left-click is what keeps both behaviours true at once.
	 */
	function pick(event: MouseEvent, at: number) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (event.button !== 0) return;
		event.preventDefault();
		index = at;
		open = true;
	}

	function step(by: number) {
		if (figures.length < 2) return;
		index = (index + by + figures.length) % figures.length;
	}

	/**
	 * Arrows on the window rather than on the dialog's own element.
	 *
	 * bits-ui puts its own handlers on the content node, and spreading its props
	 * and then adding `onkeydown` would shadow them — quietly taking away the
	 * focus management that is the entire reason for using it. The dialog is
	 * modal, so nothing else can be listening while it is open.
	 */
	function keys(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'ArrowRight') step(1);
		else if (event.key === 'ArrowLeft') step(-1);
	}
</script>

<svelte:window onkeydown={keys} />

<section class="gallery">
	{#if readout}
		<p class="co-num readout">{readout}</p>
	{/if}

	{#if !loaded}
		<p class="quiet">…</p>
	{:else if !configured}
		<p class="quiet">
			No database, so there is nowhere for a figure to live. Set <code class="co-num"
				>DATABASE_URL</code
			> and generated images will land here.
		</p>
	{:else if error}
		<p class="err co-num">{error}</p>
	{:else if !figures.length}
		<EmptyState icon={ICON.figure} tone="user" title="No figures yet" />
	{:else}
		<ul class="tiles">
			{#each figures as figure, i (figure.key)}
				<li>
					<a
						class="tile"
						href={resolve('/figures/[...path]', { path: name(figure.key) })}
						onclick={(event) => pick(event, i)}
					>
						<span class="frame">
							<img
								src={resolve('/figures/[...path]', { path: name(figure.key) })}
								alt={name(figure.key)}
								loading="lazy"
								decoding="async"
							/>
						</span>
						<span class="name co-num">{name(figure.key)}</span>
						<span class="meta co-num">{mb(figure.size)} · {day(figure.createdAt)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="scrim"></div>
			{/snippet}
		</Dialog.Overlay>

		<!--
			`child` rather than a `class` prop throughout: Svelte only stamps its
			scoping hash onto real elements, so a class handed to a component would
			match nothing in the <style> block below and be pruned as unused.
		-->
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class="lightbox">
					<header>
						<Dialog.Title>
							{#snippet child({ props: titleProps })}
								<h2 {...titleProps} class="co-num title">{name(current?.key ?? '')}</h2>
							{/snippet}
						</Dialog.Title>

						{#if current}
							<span class="co-num stamp">{mb(current.size)} · {day(current.createdAt)}</span>
						{/if}

						<span class="spacer"></span>

						{#if figures.length > 1}
							<span class="co-num count">{index + 1}/{figures.length}</span>
							<!-- One glyph, mirrored. The registry has no left arrow and
							     icons.ts is not this component's to extend. -->
							<button class="act flip" onclick={() => step(-1)} aria-label="Previous figure">
								<HugeiconsIcon icon={ICON.collapse} size={14} />
							</button>
							<button class="act" onclick={() => step(1)} aria-label="Next figure">
								<HugeiconsIcon icon={ICON.collapse} size={14} />
							</button>
						{/if}

						{#if current}
							<a
								class="act"
								href={resolve('/figures/[...path]', { path: name(current.key) })}
								target="_blank"
								rel="noreferrer noopener"
								aria-label="Open the original file"
							>
								<HugeiconsIcon icon={ICON.external} size={14} />
							</a>
						{/if}

						<Dialog.Close>
							{#snippet child({ props: closeProps })}
								<button {...closeProps} class="act" aria-label="Close">
									<HugeiconsIcon icon={ICON.close} size={14} />
								</button>
							{/snippet}
						</Dialog.Close>
					</header>

					{#if current}
						<!-- Keyed on the figure so a step swaps the element rather than
						     mutating `src` in place, which leaves the previous picture on
						     screen until the next one has finished decoding. -->
						{#key current.key}
							<img
								class="full"
								src={resolve('/figures/[...path]', { path: name(current.key) })}
								alt={name(current.key)}
							/>
						{/key}
					{/if}
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.gallery {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
	}

	.readout {
		margin: 0;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}

	.quiet {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		text-wrap: pretty;
	}
	.quiet code {
		font-size: 0.6875rem;
	}

	.err {
		margin: 0;
		font-size: 0.6875rem;
		color: var(--co-error);
	}

	.tiles {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		gap: 1.1rem 1rem;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		text-decoration: none;
		color: inherit;
	}

	/* The picture is its own edge — a border here would be a box around something
	   already obviously separate. The wash is only what sits behind a figure
	   while it decodes, so a tile has presence before it has an image. */
	.frame {
		display: block;
		aspect-ratio: 3 / 2;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--muted) 55%, transparent);
	}
	.frame img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition:
			opacity 200ms ease,
			transform 250ms ease;
	}
	.tile:hover .frame img {
		opacity: 0.88;
		transform: scale(1.015);
	}

	.name {
		font-size: 0.6875rem;
		color: color-mix(in oklab, var(--foreground) 80%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color 150ms ease;
	}
	.tile:hover .name {
		color: var(--co-accent);
	}

	.meta {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	/* ── lightbox ─────────────────────────────────────────────────────────── */

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: color-mix(in oklab, var(--background) 78%, transparent);
		backdrop-filter: blur(4px) saturate(1.1);
		-webkit-backdrop-filter: blur(4px) saturate(1.1);
	}
	.scrim[data-state='open'] {
		animation: fade 180ms ease;
	}
	/* `reverse forwards`, not a second keyframe set: bits-ui keeps the node
	   mounted until the animation ends, and without `forwards` the element snaps
	   back to full opacity for the frame between the last keyframe and unmount. */
	.scrim[data-state='closed'] {
		animation: fade 150ms ease reverse forwards;
	}

	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 61;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 1.25rem;
		/* No panel, no card. The figure is the content and the scrim is the
		   separation; a framed sheet around a picture is furniture in front of the
		   one thing anybody opened this to look at. */
		background: transparent;
	}
	.lightbox[data-state='open'] {
		animation: rise 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.lightbox[data-state='closed'] {
		animation: fade 140ms ease reverse forwards;
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: min(100%, 76rem);
		padding-bottom: 0.4rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
	}

	.title {
		margin: 0;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--foreground);
	}

	.stamp,
	.count {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}

	.spacer {
		flex: 1;
	}

	.act {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem;
		border: 0;
		border-radius: 2px;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		transition: color 150ms ease;
	}
	.act:hover {
		color: var(--foreground);
	}
	.flip {
		transform: rotate(180deg);
	}

	.full {
		max-width: min(100%, 76rem);
		/* Bounded by the viewport, not by the file: a 1536×1024 render is larger
		   than most windows, and an image that overflows a modal has no scrollbar
		   to get it back. */
		max-height: calc(100vh - 6rem);
		object-fit: contain;
		border-radius: var(--radius-sm);
	}
</style>
