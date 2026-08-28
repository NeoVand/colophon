<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { session } from '$lib/agent/session.svelte';
	import { apportion, bands, groupOf, type Part, type PartGroup } from '$lib/agent/context';
	import { windowFor } from '$lib/xray/usage';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Toolbar from '$lib/components/ui/Toolbar.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';

	/**
	 * What is actually in the window.
	 *
	 * A token total tells you what a turn cost. This tells you *what you bought*
	 * — and the two most useful readings are both invisible from a chat window:
	 *
	 * **The fixed tax.** Tool schemas are re-sent on every call whether or not a
	 * tool is used. Twelve tools with rich descriptions is a constant charge on
	 * every step of a twelve-step research turn.
	 *
	 * **The growing history.** A paper excerpt pulled into the conversation is
	 * paid for again on every subsequent call.
	 *
	 * ── Three things this panel gained, and why ─────────────────────────────
	 * It used to be a flat list of labels and percentages for the latest call
	 * only, which is a summary of a summary. harnessXray's is the standard here
	 * and the gap was not decoration, it was three missing capabilities:
	 *
	 * 1. **You can open a row and read the piece.** Every label was a claim you
	 *    had to take on faith — "fetch_paper — result, 61%" with no way to see
	 *    what those bytes were. The text is fetched from `/api/context`, which
	 *    decomposes the same captured body again; see that route for why it is
	 *    not simply carried on the stream.
	 * 2. **You can see the request whole.** The pieces view is an interpretation,
	 *    a useful one, and you should always be able to fall back to the thing
	 *    itself and feel how long it has actually become.
	 * 3. **You can page across calls.** A context is not a thing, it is a thing
	 *    that grows. The strip of bars below the gauge is one bar per model call
	 *    in this turn, to scale — the whole lesson of the panel in one row, and
	 *    every bar is a measured number rather than a forecast.
	 */

	/** Which call is pinned. Undefined follows the run. */
	let pinned = $state<number | undefined>();

	const shots = $derived(session.contexts);
	const shot = $derived(
		pinned === undefined ? shots[shots.length - 1] : shots.find((s) => s.call === pinned)
	);

	/** Two readings of one call: cut into pieces, or the body whole. */
	let view = $state('pieces');

	const inputTokens = $derived(shot?.tokens ?? 0);

	const rows = $derived<Part[]>(shot ? apportion(shot.parts as Part[], inputTokens) : []);
	const merged = $derived(shot ? bands(shot.parts as Part[]) : []);

	const limit = $derived(windowFor(shot?.model));
	const used = $derived(limit && inputTokens ? Math.min(1, inputTokens / limit) : 0);
	const cachedShare = $derived(
		shot?.measured && shot.tokens ? Math.round((shot.cached / shot.tokens) * 100) : 0
	);

	const TONE: Record<string, string> = {
		system: '--co-memory',
		'tool-schema': '--co-tool',
		user: '--co-user',
		assistant: '--co-model',
		'tool-call': '--co-tool',
		'tool-result': '--co-library',
		'reasoning-ref': '--co-subagent',
		other: '--co-gate'
	};

	/**
	 * The three bands a reader asks about, in the order the request is built.
	 *
	 * Rows inside a group stay in **request order** rather than being sorted by
	 * size, which is a change from the old flat list. Sorting answered "what
	 * dominates" and destroyed the other reading: the messages group in order is
	 * the conversation, and watching a tool result land in the middle of it and
	 * then reappear on every later call is the single most expensive thing an
	 * agent does. The per-row bar answers "what dominates" without reordering
	 * anything.
	 */
	const GROUPS: { id: PartGroup; label: string; note: string }[] = [
		{ id: 'system', label: 'system', note: 'assembled from several' },
		{ id: 'tools', label: 'tool schemas', note: 'every schema, every call' },
		{ id: 'messages', label: 'messages', note: 'the conversation so far' }
	];

	const grouped = $derived(
		GROUPS.map((g) => {
			const items = rows.filter((r) => groupOf(r.kind) === g.id);
			return {
				...g,
				items,
				chars: items.reduce((n, r) => n + r.chars, 0),
				tokens: items.reduce((n, r) => n + (r.tokens ?? 0), 0)
			};
		}).filter((g) => g.items.length)
	);

	function kb(chars: number): string {
		return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars);
	}

	/**
	 * Percent or tokens, never both.
	 *
	 * They answer different questions and the panel is too narrow to ask both at
	 * once. A share says which row *dominates*. A token count is what you put in
	 * a message to someone: "the schemas are 4,100 tokens on every call" is an
	 * argument, "the schemas are 31%" is an observation.
	 */
	let unit = $state<'share' | 'tokens'>('share');

	/* ── the text behind a row ───────────────────────────────────────────────
	   Fetched once per call and cached by call number. The stream deliberately
	   carries no text — see `Part.text` — so this is where a row's contents come
	   from, and until it arrives a row that has been opened says so rather than
	   showing an empty box. */
	interface Fetched {
		parts?: Part[];
		raw?: string;
		clipped?: number;
		error?: string;
		loading: boolean;
	}
	// A SvelteMap would make mutation reactive; this is replaced wholesale per
	// call, so a plain object in `$state` is the smaller thing that works.
	let fetched = $state<Record<number, Fetched>>({});

	const open = new SvelteSet<string>();

	async function load(call: number, raw: boolean): Promise<void> {
		const key = raw ? -call : call;
		if (fetched[key]?.loading || fetched[key]?.parts || fetched[key]?.raw) return;
		fetched = { ...fetched, [key]: { loading: true } };
		try {
			const url = `/api/context?thread=${encodeURIComponent(session.thread)}&call=${call}${
				raw ? '&raw=1' : ''
			}`;
			const response = await fetch(url);
			const data = (await response.json()) as {
				message?: string;
				found?: boolean;
				parts?: Part[];
				raw?: string;
				clipped?: number;
			};
			if (!response.ok) throw new Error(data?.message ?? `HTTP ${response.status}`);
			if (!data.found) throw new Error('That call is no longer held on the server.');
			fetched = {
				...fetched,
				[key]: { loading: false, parts: data.parts, raw: data.raw, clipped: data.clipped }
			};
		} catch (cause) {
			fetched = {
				...fetched,
				[key]: { loading: false, error: cause instanceof Error ? cause.message : String(cause) }
			};
		}
	}

	function toggle(row: Part): void {
		if (!shot) return;
		const key = `${shot.call}:${row.id}`;
		if (!open.delete(key)) {
			open.add(key);
			load(shot.call, false);
		}
	}

	/** Piece text for the open call, matched by the id `decompose` assigns. */
	const textOf = $derived((row: Part) =>
		fetched[shot?.call ?? -1]?.parts?.find((p) => p.id === row.id)
	);

	const pieces = $derived(shot ? fetched[shot.call] : undefined);
	const rawDoc = $derived(shot ? fetched[-shot.call] : undefined);

	$effect(() => {
		if (view === 'raw' && shot) load(shot.call, true);
	});

	let copied = $state(false);
	let flash: ReturnType<typeof setTimeout> | undefined;

	/**
	 * The decomposition, as JSON.
	 *
	 * The whole point of this panel is that it reads the literal request off the
	 * provider's own fetch, and a number you cannot get out of the page is a
	 * number you cannot check. So this copies the rows as data — including the
	 * billed total the shares were apportioned from, without which the token
	 * columns cannot be reconstructed or argued with.
	 */
	async function copyJson(): Promise<void> {
		if (!shot) return;
		await navigator.clipboard.writeText(
			JSON.stringify(
				{
					call: shot.call,
					model: shot.model,
					bytes: shot.bytes,
					inputTokens,
					cached: shot.cached,
					measured: shot.measured,
					parts: rows.map((r) => ({
						kind: r.kind,
						label: r.label,
						chars: r.chars,
						share: r.share,
						tokens: r.tokens
					}))
				},
				null,
				2
			)
		);
		copied = true;
		clearTimeout(flash);
		flash = setTimeout(() => (copied = false), 1200);
	}

	/** The tallest call, so the strip of bars is to scale against the run. */
	const peak = $derived(Math.max(1, ...shots.map((s) => s.tokens || s.chars)));
</script>

<PanelFrame
	label="context"
	icon={ICON.context}
	tone="memory"
	tabs={[
		{ id: 'pieces', label: 'pieces' },
		{ id: 'raw', label: 'raw' }
	]}
	bind:active={view}
	readout={shot ? `call ${shot.call} of ${shots.length} · ${kb(shot.bytes)}B` : undefined}
>
	{#snippet actions()}
		<Toolbar>
			<IconButton
				icon={ICON.spend}
				label="absolute tokens"
				active={unit === 'tokens'}
				disabled={!inputTokens}
				onclick={() => (unit = unit === 'share' ? 'tokens' : 'share')}
			/>
			<IconButton
				icon={copied ? ICON.check : ICON.copy}
				label="copy as JSON"
				disabled={!shot}
				onclick={copyJson}
			/>
		</Toolbar>
	{/snippet}

	{#if !shot}
		<EmptyState
			icon={ICON.context}
			tone="memory"
			title="Nothing sent yet"
			note="Every model call is one assembled string plus a list of tool schemas."
		/>
	{:else}
		<div class="scroll">
			<!--
				The gauge. Two facts, not one: how much of the window is spent, and
				what it was spent on. The limit bar only appears for a model whose
				window we have written down — `windowFor` returns nothing otherwise,
				and a bar drawn against an invented number is worse than no bar.
			-->
			<div class="gauge">
				<div class="head">
					<span class="co-num total"
						>{inputTokens ? inputTokens.toLocaleString() : kb(shot.chars)}</span
					>
					<span class="co-eyebrow unit">
						{#if inputTokens}
							{limit ? `tokens of ${Math.round(limit / 1000)}k` : 'tokens'}
						{:else}
							characters — not billed yet
						{/if}
					</span>
					{#if limit && used}
						<span class="co-num pctOfLimit">{(used * 100).toFixed(used < 0.1 ? 1 : 0)}%</span>
					{/if}
				</div>

				{#if limit && used}
					<div class="limit" role="img" aria-label="Share of the model's input window">
						<span style:width="{used * 100}%"></span>
					</div>
				{/if}

				<div class="bar" role="img" aria-label="What the outgoing request is made of">
					{#each merged as b (b.kind)}
						<span
							class="seg"
							style:--tone="var({TONE[b.kind] ?? '--co-gate'})"
							style:flex-grow={b.chars}
							title="{b.kind}: {kb(b.chars)} chars, {Math.round(b.share * 100)}%"
						></span>
					{/each}
				</div>

				<p class="caveat">
					{#if shot.measured}
						billed{#if cachedShare}, {cachedShare}% of it a cache hit{/if} · rows below are apportioned
						by size
					{:else}
						the reply has not come back yet — no row claims a token count
					{/if}
				</p>
			</div>

			<!--
				One bar per model call in this turn, to scale. This is the pager and
				the lesson at once: a context is not a thing, it is a thing that
				grows, and no single snapshot shows that. Clicking pins a call;
				clicking the pinned one lets go and follows the run again.
			-->
			{#if shots.length > 1}
				<div class="calls" role="group" aria-label="Model calls this turn">
					{#each shots as s (s.call)}
						<button
							class="call"
							class:on={s.call === shot.call}
							type="button"
							title="call {s.call} · {s.tokens
								? `${s.tokens.toLocaleString()} tokens`
								: `${kb(s.chars)} chars`}"
							aria-label="Call {s.call}"
							aria-pressed={s.call === shot.call}
							onclick={() => (pinned = pinned === s.call ? undefined : s.call)}
						>
							<span style:height="{Math.max(8, ((s.tokens || s.chars) / peak) * 100)}%"></span>
						</button>
					{/each}
				</div>
			{/if}

			{#if view === 'raw'}
				{#if rawDoc?.loading}
					<p class="quiet">Reading the request back…</p>
				{:else if rawDoc?.error}
					<p class="quiet">{rawDoc.error}</p>
				{:else if rawDoc?.raw}
					<pre class="raw">{rawDoc.raw}</pre>
					<p class="quiet">
						{#if rawDoc.clipped}
							{rawDoc.clipped.toLocaleString()} more characters not shown ·
						{/if}
						The whole body of this call — system prompt, every tool schema, every message, one JSON object.
						The pieces view cuts exactly these bytes apart.
					</p>
				{/if}
			{:else}
				{#each grouped as g (g.id)}
					<div class="group co-frost">
						<span class="co-eyebrow gname">{g.label}</span>
						<span class="co-num gnum">
							{g.items.length} · {unit === 'tokens' && g.tokens
								? g.tokens.toLocaleString()
								: `${kb(g.chars)}`}
						</span>
						<span class="gnote">{g.note}</span>
					</div>

					{#each g.items as row (row.id)}
						{@const key = `${shot.call}:${row.id}`}
						{@const isOpen = open.has(key)}
						{@const piece = textOf(row)}
						<button
							class="row"
							class:on={isOpen}
							type="button"
							style:--tone="var({TONE[row.kind] ?? '--co-gate'})"
							aria-expanded={isOpen}
							onclick={() => toggle(row)}
						>
							<span class="swatch"></span>
							<span class="label">{row.label}</span>
							<!-- The share, as a bar. The point of the row: a tool result forty
							     times the system prompt should look forty times bigger. -->
							<span class="share" aria-hidden="true">
								<span style:width="{Math.max(2, row.share * 100)}%"></span>
							</span>
							{#if unit === 'tokens' && row.tokens}
								<span class="co-num tok">{row.tokens.toLocaleString()}</span>
							{:else}
								<span class="co-num pct">{Math.round(row.share * 100)}%</span>
							{/if}
						</button>

						{#if isOpen}
							<div class="piece">
								{#if pieces?.loading}
									<p class="quiet">Reading it back…</p>
								{:else if pieces?.error}
									<p class="quiet">{pieces.error}</p>
								{:else if piece?.text}
									<pre>{piece.text}</pre>
									{#if piece.clipped}
										<p class="quiet">
											{piece.clipped.toLocaleString()} more characters not shown — the row's size above
											counts all of them.
										</p>
									{/if}
								{:else}
									<p class="quiet">Nothing to show for this piece.</p>
								{/if}
							</div>
						{/if}
					{/each}
				{/each}

				<p class="quiet foot">
					Every row here is re-sent on the next call too. That is what makes a long conversation
					expensive.
				</p>
			{/if}
		</div>
	{/if}
</PanelFrame>

<style>
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		/* So the per-row share bar can be dropped on a narrow pane. A media query
		   would ask about the window, and this panel's width is set by a divider
		   the reader drags — the two are unrelated. */
		container-type: inline-size;
	}

	.gauge {
		padding: 0.5rem 0.7rem 0.4rem;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}
	.total {
		font-size: 0.8125rem;
	}
	.unit {
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}
	.pctOfLimit {
		margin-left: auto;
		font-size: 0.6875rem;
		color: var(--muted-foreground);
	}

	/* Share of the model's window. A separate, thinner bar from the composition
	   one below it, because they are measured against different totals — one
	   against the limit, one against this request. */
	.limit {
		margin-top: 0.35rem;
		height: 3px;
		border-radius: 2px;
		background: var(--muted);
		overflow: hidden;
	}
	.limit span {
		display: block;
		height: 100%;
		background: var(--co-model);
		transition: width 300ms ease;
	}

	.bar {
		display: flex;
		height: 6px;
		border-radius: 2px;
		overflow: hidden;
		background: var(--muted);
		margin-top: 0.4rem;
	}
	.seg {
		background: var(--tone);
		flex-basis: 0;
		transition: flex-grow 400ms ease;
	}

	.caveat {
		margin: 0.35rem 0 0;
		font-size: 0.625rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
		text-wrap: pretty;
	}

	/* The run's calls, to scale. Bars grow from the baseline so the row reads as
	   a chart rather than as a set of buttons that happen to differ in height. */
	.calls {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 22px;
		padding: 0 0.7rem 0.5rem;
	}
	.call {
		display: flex;
		align-items: flex-end;
		flex: 1;
		min-width: 3px;
		max-width: 1.4rem;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	.call span {
		width: 100%;
		border-radius: 1px;
		background: color-mix(in oklab, var(--co-memory) 30%, transparent);
		transition:
			height 300ms ease,
			background-color 150ms ease;
	}
	.call:hover span {
		background: color-mix(in oklab, var(--co-memory) 55%, transparent);
	}
	.call.on span {
		background: var(--co-memory);
	}

	/* A group heading, frosted so rows pass under it rather than stopping short. */
	.group {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.25rem 0.7rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
	}
	.gname {
		color: color-mix(in oklab, var(--co-memory) 80%, var(--muted-foreground));
	}
	.gnum {
		font-size: 0.625rem;
		color: var(--muted-foreground);
	}
	.gnote {
		margin-left: auto;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.1rem 0.7rem;
		border: 0;
		background: transparent;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		line-height: 1.75;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.row:hover {
		background: color-mix(in oklab, var(--tone) 10%, transparent);
	}
	.row.on {
		background: color-mix(in oklab, var(--tone) 14%, transparent);
	}

	.swatch {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 1px;
		background: var(--tone);
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted-foreground);
	}
	.row.on .label {
		color: var(--foreground);
	}

	/* Hidden on a narrow pane: the number to its right carries the same fact, and
	   a two-pixel bar is decoration rather than a reading. */
	.share {
		flex: none;
		display: none;
		width: 3rem;
		height: 3px;
		background: var(--muted);
	}
	.share span {
		display: block;
		height: 100%;
		background: var(--tone);
	}
	@container (min-width: 22rem) {
		.share {
			display: block;
		}
	}

	/* One column, either way — the two readings swap in place, so switching
	   between them does not shift every label sideways. */
	.tok,
	.pct {
		flex: none;
		width: 3.4rem;
		text-align: right;
	}
	.tok {
		color: color-mix(in oklab, var(--foreground) 80%, transparent);
	}
	.pct {
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
	}

	/* The piece itself. Bounded and scrolling inside itself so opening a
	   two-hundred-kilobyte tool result does not push every later row off the
	   panel — the same rule the event detail keeps. */
	.piece {
		max-height: 16rem;
		overflow: auto;
		margin: 0 0.7rem 0.3rem;
		padding: 0.35rem 0.5rem;
		border-left: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
		background: color-mix(in oklab, var(--muted) 40%, transparent);
	}
	.piece pre,
	.raw {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: color-mix(in oklab, var(--foreground) 82%, transparent);
	}
	.raw {
		padding: 0.4rem 0.7rem;
	}

	.quiet {
		margin: 0.2rem 0 0;
		padding: 0;
		font-size: 0.625rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
		text-wrap: pretty;
	}
	.piece .quiet,
	.raw + .quiet {
		padding: 0 0.7rem;
	}
	.foot {
		padding: 0.4rem 0.7rem 0.7rem;
	}
</style>
