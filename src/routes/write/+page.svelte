<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { theme } from '$lib/theme.svelte';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import DocumentViewer, { type DocumentKind } from '$lib/components/DocumentViewer.svelte';
	import { relative } from '$lib/xray/format';
	import type { PageData } from './$types';

	/**
	 * Where the paper gets written.
	 *
	 * Three columns, and they are three different questions: what is in the
	 * vault, what this document says, and what it will look like. None of them
	 * hides behind a tab, because the whole reason to write Typst in a browser
	 * rather than a text editor is watching the rendering keep up.
	 *
	 * ── The middle column is a textarea. On purpose. ────────────────────────────
	 * Not CodeMirror, not a rich-text editor, not a WYSIWYG. The documents here
	 * are markdown and Typst *source*, and the right-hand column is already the
	 * rendering of that source. A WYSIWYG in the middle would be a third
	 * representation of the same document — one the writer edits, one the
	 * renderer produces, and one the database holds — and the two that are not
	 * the database would have to be kept in sync with it forever, at the cost of
	 * every feature after this one. A textarea *is* the source. What you type is
	 * the bytes that get stored, character for character, and the preview is the
	 * only interpretation on screen.
	 *
	 * The same argument rules out CodeMirror, less obviously. It would give
	 * syntax colour and nothing else that matters here, in exchange for an
	 * editing model that owns the DOM, its own undo stack, its own selection API
	 * and its own idea of what a line is — which is a great deal of surface for
	 * a document whose highlighted reading is already visible one column to the
	 * right. If Colophon ever needs multi-cursor or a live Typst compiler, that
	 * is the day this decision gets revisited; it is not this day.
	 *
	 * ── Saving ──────────────────────────────────────────────────────────────────
	 * On a debounce, and the header says when it last landed. Never on a form
	 * action: an action re-runs `load` and re-renders the page, which fights the
	 * caret at one keystroke a second.
	 */

	let { data }: { data: PageData } = $props();

	/** What the rail needs of a document, and nothing else. */
	interface Row {
		id: string;
		title: string;
		kind: DocumentKind;
		updatedAt: Date | string;
	}

	/**
	 * Restated rather than imported from the schema.
	 *
	 * The union lives in `$lib/server/db/documents.schema.ts`, and importing it
	 * puts a `$lib/server` module in the client's import graph — which SvelteKit
	 * refuses, because one careless edit turns a type import into a value import
	 * and ships the database credentials to the browser. `DocumentViewer` makes
	 * the same trade for the same reason.
	 */
	const KINDS: readonly DocumentKind[] = ['markdown', 'typst', 'latex', 'html'];

	const DEBOUNCE_MS = 900;

	/* ── the buffer ─────────────────────────────────────────────────────────── */

	/**
	 * The load data, read once and then let go of.
	 *
	 * `untrack` rather than a bare `data.open`, and not to silence a warning:
	 * the warning is right that this captures only the initial value, and that
	 * is exactly the contract. After first paint the buffer below is the truth
	 * about what is being written — it is ahead of the server between debounces
	 * — so a later reactive read of `data` would be the server quietly
	 * overwriting unsaved keystrokes. Every subsequent document comes through
	 * `fetchInto`, which is a request the page asked for.
	 */
	const seed = untrack(() => data.open);

	let docs = $state<Row[]>(untrack(() => data.documents));
	let id = $state<string | null>(seed?.id ?? null);
	let title = $state(seed?.title ?? '');
	let kind = $state<DocumentKind>(seed?.kind ?? 'markdown');
	let body = $state(seed?.body ?? '');

	let dirty = $state(false);
	let saving = $state(false);
	let failure = $state('');
	let savedAt = $state<Date | null>(seed ? new Date(seed.updatedAt) : null);
	let armed = $state(false);

	/**
	 * The clock behind "saved four minutes ago".
	 *
	 * `relative()` is pure, so a timestamp alone never re-renders — the label
	 * would say "just now" until the next keystroke happened to invalidate it.
	 * Ticking a value the label reads is what makes it age.
	 */
	let now = $state(Date.now());

	/*
	 * Deliberately NOT `$state`.
	 *
	 * These coordinate saves and are read only inside `save()`. Making them
	 * reactive would put them in the dependency graph of nothing, at the cost of
	 * inviting exactly the effect-writes-what-it-reads shape this codebase has
	 * shipped `effect_update_depth_exceeded` from twice.
	 */
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** The save in the air, so a caller can wait for the buffer to be on disk. */
	let inFlight: Promise<void> | null = null;
	let queued = false;

	/**
	 * The title box, held so `create()` can put the caret in it.
	 *
	 * `bind:this` rather than an attachment: the thing that focuses it is an
	 * event handler somewhere else entirely, so an attachment would hand the node
	 * to a callback whose only job is to park it in exactly this variable.
	 */
	let titleField = $state<HTMLInputElement | null>(null);

	onMount(() => {
		theme.start();
		const tick = setInterval(() => (now = Date.now()), 20_000);
		return () => clearInterval(tick);
	});

	// A pending debounce on a page that is going away would fire into a dead
	// component; the last save is forced by the switch or the unload, not by this.
	onDestroy(() => clearTimeout(timer));

	/* ── the live document ──────────────────────────────────────────────────── */

	/**
	 * What the preview renders: the buffer, not the saved row.
	 *
	 * Reading the server's copy would make the preview lag the save debounce by
	 * a second, which turns the one thing this layout exists for — type, see it
	 * set — into a delay the writer learns to distrust.
	 */
	const live = $derived(
		id ? { id, title: title || 'Untitled', kind, body, updatedAt: savedAt } : null
	);

	const words = $derived(body.trim() ? body.trim().split(/\s+/).length : 0);

	const status = $derived(
		!id
			? ''
			: failure
				? 'save failed'
				: saving
					? 'saving'
					: dirty
						? 'unsaved'
						: savedAt
							? `saved ${relative(savedAt, now)}`
							: ''
	);

	/* ── saving ─────────────────────────────────────────────────────────────── */

	/** A SvelteKit `error()` body is JSON; a proxy's is not. Read both. */
	async function reasonFrom(response: Response): Promise<string> {
		const text = await response.text().catch(() => '');
		try {
			return (JSON.parse(text) as { message?: string }).message || response.statusText;
		} catch {
			return text || response.statusText;
		}
	}

	function touch() {
		dirty = true;
		failure = '';
		clearTimeout(timer);
		timer = setTimeout(() => void save(), DEBOUNCE_MS);
	}

	/**
	 * Write the buffer back, at most one request at a time.
	 *
	 * `await save()` means "everything typed up to this call is on the server",
	 * and every caller that is about to abandon the buffer — a switch, a new
	 * document, a delete — depends on that being literally true.
	 *
	 * ── Why `dirty` is cleared before the request, not after ────────────────────
	 * The body is read into `patch` and the flag drops in the same tick. Clearing
	 * it after instead means a character typed while the PUT is in flight sets
	 * `dirty`, and then the completion clears it — so that keystroke is marked
	 * saved without ever having been sent, and stays that way until something
	 * else happens to trigger a save. Clearing first makes the worst case a
	 * redundant save rather than a lost one.
	 *
	 * ── Why the writer loops instead of racing ──────────────────────────────────
	 * Two PUTs to the same row can arrive out of order, and the loser of that
	 * race is the newer text. So a save requested mid-flight sets `queued` and
	 * waits, and the run already in progress does the extra round itself. The
	 * loop is what makes the guarantee above hold: a keystroke landing between
	 * the read and the response is picked up by the next iteration rather than
	 * left for a debounce that a navigation may cancel.
	 *
	 * It stops on failure. Looping while `dirty` is true would turn a server
	 * that is refusing writes into an unbounded retry, and the header already
	 * says the save failed.
	 */
	async function save(force = false): Promise<void> {
		clearTimeout(timer);
		if (!id) return;

		if (inFlight) {
			queued = true;
			await inFlight;
			return;
		}
		if (!dirty && !force) return;

		// Captured once: nothing can change `id` until this resolves, because
		// every caller that changes it awaits this function first.
		const target = id;

		const run = (async () => {
			let another = true;
			while (another) {
				const patch = { title, kind, body };
				dirty = false;
				saving = true;

				try {
					const response = await fetch(`/api/documents/${target}`, {
						method: 'PUT',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(patch)
					});
					if (!response.ok) throw new Error(await reasonFrom(response));

					const { document } = (await response.json()) as { document: Row & { body: string } };

					// Only the timestamp is adopted. Adopting the *text* would overwrite
					// whatever was typed during the round trip with the version sent.
					savedAt = new Date(document.updatedAt);
					now = Date.now();
					docs = docs.map((row) =>
						row.id === target
							? {
									...row,
									title: document.title,
									kind: document.kind,
									updatedAt: document.updatedAt
								}
							: row
					);
					another = queued && dirty;
				} catch (cause) {
					failure = cause instanceof Error ? cause.message : String(cause);
					// It did not land, so the buffer is still ahead of the server.
					// Saying "saved" here is the one lie an editor must never tell.
					dirty = true;
					another = false;
				} finally {
					saving = false;
					queued = false;
				}
			}
		})();

		inFlight = run;
		try {
			await run;
		} finally {
			inFlight = null;
		}
	}

	/* ── moving between documents ───────────────────────────────────────────── */

	interface Opened {
		id: string;
		title: string;
		kind: DocumentKind;
		body: string;
		updatedAt: Date | string;
	}

	function adopt(document: Opened) {
		id = document.id;
		title = document.title;
		kind = document.kind;
		body = document.body;
		savedAt = new Date(document.updatedAt);
		dirty = false;
		failure = '';
		armed = false;
	}

	function clear() {
		id = null;
		title = '';
		body = '';
		savedAt = null;
		dirty = false;
		armed = false;
	}

	async function fetchInto(target: string): Promise<void> {
		try {
			const response = await fetch(`/api/documents/${target}`);
			if (!response.ok) throw new Error(await reasonFrom(response));
			const { document } = (await response.json()) as { document: Opened };
			adopt(document);
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : String(cause);
		}
	}

	/** Switching flushes first: an unsaved buffer must not be lost to a click. */
	async function switchTo(target: string): Promise<void> {
		if (target === id) return;
		await save();
		await fetchInto(target);
	}

	async function create(): Promise<void> {
		await save();
		try {
			const response = await fetch('/api/documents', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				// The new document inherits the format being written in, which is
				// almost always the one wanted next, and is one click to change.
				body: JSON.stringify({ kind })
			});
			if (!response.ok) throw new Error(await reasonFrom(response));
			const { document } = (await response.json()) as { document: Opened };
			docs = [document, ...docs];
			adopt(document);
			// The title is the only field a blank document needs, so it gets the caret.
			titleField?.focus();
			titleField?.select();
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : String(cause);
		}
	}

	/**
	 * Delete, armed by the first click and fired by the second.
	 *
	 * The vault has no soft delete — see `removeDocument` — so this is the last
	 * moment the document exists. A `confirm()` dialog would do, but it steals
	 * focus and reads as a browser error; a button that visibly changes into a
	 * live trigger says the same thing in the place you are already looking.
	 */
	async function destroy(): Promise<void> {
		if (!id) return;
		if (!armed) {
			armed = true;
			// Disarms itself, so a stray click cannot leave a live delete sitting
			// under the cursor for the rest of the session.
			setTimeout(() => (armed = false), 3000);
			return;
		}

		const gone = id;
		// Cleared first: `save()` must not fire at a row that is being deleted.
		clear();
		clearTimeout(timer);

		try {
			const response = await fetch(`/api/documents/${gone}`, { method: 'DELETE' });
			if (!response.ok) throw new Error(await reasonFrom(response));
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : String(cause);
			return;
		}

		docs = docs.filter((row) => row.id !== gone);
		if (docs.length) await fetchInto(docs[0].id);
	}

	/** ⌘S / Ctrl-S forces a write even when nothing changed. It is muscle memory. */
	function onKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			void save(true);
		}
	}
</script>

<svelte:head><title>Write · Colophon</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

{#snippet railTools()}
	<button class="tool" onclick={create} title="New document" aria-label="New document">
		<HugeiconsIcon icon={ICON.add} size={13} />
	</button>
{/snippet}

{#snippet editorTools()}
	<select
		class="kind co-bare"
		bind:value={kind}
		onchange={touch}
		disabled={!id}
		aria-label="Format"
	>
		{#each KINDS as k (k)}<option value={k}>{k}</option>{/each}
	</select>
	<button
		class="tool"
		onclick={() => save(true)}
		disabled={!id}
		title="Save — ⌘S"
		aria-label="Save"
	>
		<HugeiconsIcon icon={ICON.check} size={13} />
	</button>
	<button
		class="tool danger"
		class:armed
		onclick={destroy}
		disabled={!id}
		title={armed ? 'Click again to delete for good' : 'Delete'}
		aria-label={armed ? 'Confirm delete' : 'Delete'}
	>
		<HugeiconsIcon icon={ICON.trash} size={13} />
	</button>
{/snippet}

<div class="page">
	<header class="bar co-frost">
		<a class="co-wordmark mark" href={resolve('/')}>colo<em>phon</em></a>
		<span class="co-eyebrow crumb">write</span>
		<div class="spacer"></div>
		{#if status}
			<span
				class="co-num state"
				class:warn={dirty && !failure}
				class:bad={!!failure}
				title={failure}>{status}</span
			>
		{/if}
		<a class="link" href={resolve('/vault')}>vault</a>
		<a class="link" href={resolve('/')}>back</a>
	</header>

	{#if !data.configured}
		<p class="empty">No database configured, so there is nowhere to write.</p>
	{:else}
		<main>
			<!-- ── the vault ───────────────────────────────────────────────── -->
			<section class="col rail">
				<PanelFrame
					label="documents"
					icon={ICON.prose}
					tone="library"
					readout={docs.length ? String(docs.length) : undefined}
					actions={railTools}
				>
					{#if !docs.length}
						<EmptyState icon={ICON.prose} tone="library" title="Nothing written yet" />
					{:else}
						<ul class="list">
							{#each docs as row (row.id)}
								<li>
									<button class="row" class:on={row.id === id} onclick={() => switchTo(row.id)}>
										<span class="name">{row.title}</span>
										<span class="co-num meta">{row.kind} · {relative(row.updatedAt, now)}</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</PanelFrame>
			</section>

			<!-- ── the source ──────────────────────────────────────────────── -->
			<section class="col editor">
				<PanelFrame
					label="source"
					icon={ICON.raw}
					tone="library"
					readout={id ? `${words.toLocaleString()} words` : undefined}
					actions={editorTools}
				>
					{#if !id}
						<EmptyState icon={ICON.raw} tone="library" title="Nothing open" />
					{:else}
						<div class="sheet">
							<input
								class="title co-bare"
								bind:this={titleField}
								bind:value={title}
								oninput={touch}
								placeholder="Untitled"
								aria-label="Title"
							/>
							<!--
								Spellcheck off. Every second line of a Typst source is markup, so
								the red underlines land almost entirely on syntax — which trains
								the writer to ignore them by the time one lands on a real word.
							-->
							<textarea
								class="source co-bare"
								bind:value={body}
								oninput={touch}
								spellcheck="false"
								autocapitalize="off"
								autocomplete="off"
								placeholder={kind === 'typst' ? '= Introduction' : '# Introduction'}
								aria-label="Source"></textarea>
						</div>
					{/if}
				</PanelFrame>
			</section>

			<!-- ── the rendering ───────────────────────────────────────────── -->
			<section class="col preview">
				<DocumentViewer doc={live} tone="library" />
			</section>
		</main>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background: var(--background);
		color: var(--foreground);
	}

	/* Lifted from the vault verbatim. Two pages of the same application that
	   draw their own header bars are two applications. */
	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		height: 2.6rem;
		padding: 0 1rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.mark {
		font-size: 0.875rem;
		text-decoration: none;
		color: inherit;
	}
	.crumb {
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}
	.spacer {
		flex: 1;
	}

	.state {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
		transition: color 200ms ease;
	}
	.state.warn {
		color: var(--co-approval);
	}
	.state.bad {
		color: var(--co-error);
	}

	.link {
		border: 0;
		background: transparent;
		padding: 0;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		text-decoration: none;
		cursor: pointer;
	}
	.link:hover {
		color: var(--foreground);
	}

	.empty {
		margin: 0;
		padding: 3rem 1.5rem;
		font-size: 0.8125rem;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
	}

	/* Three columns separated by hairlines and nothing else — no cards, no gaps
	   with a background showing through. The rail is fixed because a list of
	   titles does not get better with more room; the two that hold the document
	   split what is left evenly. */
	main {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr) minmax(0, 1fr);
	}
	.col {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.rail,
	.editor {
		border-right: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}

	/*
		The preview is the first thing to go.

		Below this width the two source columns are each about thirty characters
		wide, at which point neither is usable and the rendering is the one you
		can reconstruct in your head. The rail goes next, because it is
		navigation and the header still leads back to the vault.
	*/
	@media (max-width: 1080px) {
		main {
			grid-template-columns: 15rem minmax(0, 1fr);
		}
		.preview {
			display: none;
		}
	}
	@media (max-width: 720px) {
		main {
			grid-template-columns: minmax(0, 1fr);
		}
		.rail {
			display: none;
		}
	}

	/* ── the rail ─────────────────────────────────────────────────────── */
	.list {
		margin: 0;
		padding: 0.25rem 0 0.5rem;
		list-style: none;
		overflow-y: auto;
		min-height: 0;
	}

	.row {
		display: block;
		width: 100%;
		border: 0;
		border-left: 2px solid transparent;
		background: transparent;
		padding: 0.35rem 0.7rem;
		text-align: left;
		cursor: pointer;
		color: inherit;
		transition:
			background-color 150ms ease,
			border-color 150ms ease;
	}
	.row:hover {
		background: color-mix(in oklab, var(--muted) 55%, transparent);
	}
	/* The open document is marked by the same left rule the vault uses for a
	   live subscription, rather than by a filled block. */
	.row.on {
		border-left-color: var(--co-library);
		background: color-mix(in oklab, var(--co-library) 8%, transparent);
	}

	.name {
		display: block;
		font-size: 0.78rem;
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: color-mix(in oklab, var(--foreground) 80%, transparent);
	}
	.row.on .name {
		color: var(--foreground);
	}
	.meta {
		display: block;
		margin-top: 0.1rem;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	/* ── the toolbar ──────────────────────────────────────────────────── */
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
	.tool.danger:hover:not(:disabled) {
		color: var(--co-error);
	}
	/* Armed is a state, so it looks like one without moving or resizing. */
	.tool.danger.armed {
		color: var(--co-error);
		background: color-mix(in oklab, var(--co-error) 15%, transparent);
	}

	.kind {
		border: 0;
		background: transparent;
		padding: 0 0.15rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
		font-family: var(--font-mono);
		font-size: 0.5625rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.kind:hover:not(:disabled) {
		color: var(--foreground);
	}
	.kind:disabled {
		opacity: 0.35;
		cursor: default;
	}

	/* ── the sheet ────────────────────────────────────────────────────── */
	.sheet {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* The title is set in the reading face because it is the one line of this
	   column that is prose rather than source. */
	.title {
		flex: none;
		border: 0;
		background: transparent;
		padding: 0.75rem 1rem 0.35rem;
		color: var(--foreground);
		font-family: var(--font-serif);
		font-size: 1.05rem;
		line-height: 1.3;
	}
	.title::placeholder {
		color: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
	}

	/*
		Monospace and a wide leading, because this is source being read as much as
		typed. `resize: none` because the pane already fills its column and a drag
		handle in the corner would only let you make it wrong.
	*/
	.source {
		flex: 1;
		min-height: 0;
		width: 100%;
		border: 0;
		background: transparent;
		padding: 0.35rem 1rem 1.5rem;
		resize: none;
		color: var(--foreground);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.85;
		tab-size: 2;
	}
	.source::placeholder {
		color: color-mix(in oklab, var(--muted-foreground) 40%, transparent);
	}
</style>
