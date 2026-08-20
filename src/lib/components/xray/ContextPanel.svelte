<script lang="ts">
	import { session } from '$lib/agent/session.svelte';
	import { apportion, bands, type Part } from '$lib/agent/context';

	/**
	 * What is actually in the window.
	 *
	 * The panel harnessXray is known for, rebuilt on what Mastra and the AI SDK
	 * make available. A token total tells you what a turn cost; this tells you
	 * what you bought — and the two most useful readings are both invisible from
	 * a chat window:
	 *
	 * **The fixed tax.** Tool schemas are re-sent on every call whether or not a
	 * tool is used. Eight tools with rich descriptions is a constant charge on
	 * every step of a twelve-step research turn.
	 *
	 * **The growing history.** A paper excerpt pulled into the conversation is
	 * paid for again on every subsequent call. Watching the tool-result band
	 * grow across calls is watching that happen.
	 *
	 * Rows are shown largest first, because the useful question is always which
	 * one or two things dominate — not what order they went on the wire in.
	 */

	const ctx = $derived(session.context);

	/**
	 * Billed input tokens for *this* request, not for the turn.
	 *
	 * The session pairs them: a context event is followed by its own call's
	 * step-finish. Using the turn's running total instead would apportion the
	 * sum of every call across the bands of one, which inflates every row and
	 * looks entirely plausible while doing it.
	 *
	 * Zero between a context arriving and its step landing, which is correct —
	 * nothing has been billed for this call yet, so no row claims a number.
	 */
	const inputTokens = $derived(session.contextTokens);

	const rows = $derived<Part[]>(
		ctx ? apportion(ctx.parts as Part[], inputTokens).sort((a, b) => b.chars - a.chars) : []
	);

	const merged = $derived(ctx ? bands(ctx.parts as Part[]) : []);

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

	function kb(chars: number): string {
		return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars);
	}
</script>

<section class="panel">
	<header>
		<span class="co-eyebrow">context</span>
		{#if ctx}
			<span class="co-num meta">call {ctx.call} · {kb(ctx.bytes)}B</span>
		{/if}
	</header>

	{#if !ctx}
		<p class="quiet">
			Nothing sent yet. This is the literal request — read off the provider fetch, not from anything
			the agent was asked to report.
		</p>
	{:else}
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

		<ul class="rows">
			{#each rows as row (row.id)}
				<li style:--tone="var({TONE[row.kind] ?? '--co-gate'})">
					<span class="swatch"></span>
					<span class="label">{row.label}</span>
					{#if row.tokens}<span class="co-num tok">{row.tokens.toLocaleString()}</span>{/if}
					<span class="co-num pct">{Math.round(row.share * 100)}%</span>
				</li>
			{/each}
		</ul>

		{#if inputTokens}
			<!--
				Said plainly rather than left to be assumed.

				The provider bills one number for the whole request; there is no
				per-row breakdown to be had. Every figure above is that number split
				by size, so a JSON-schema row is somewhat overstated against a prose
				row. A panel that showed these as measured would be lying about the
				one thing it exists to be trusted on.
			-->
			<p class="caveat">
				{inputTokens.toLocaleString()} billed input tokens, split by size — the provider bills the request
				whole, so these are attributed rather than measured.
			</p>
		{/if}
	{/if}
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		flex: none;
	}
	header .co-eyebrow {
		color: color-mix(in oklab, var(--co-memory) 70%, var(--muted-foreground));
	}
	.meta {
		margin-left: auto;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}

	.quiet {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
		text-wrap: pretty;
	}

	.bar {
		display: flex;
		height: 6px;
		border-radius: 2px;
		overflow: hidden;
		background: var(--muted);
		flex: none;
	}
	.seg {
		background: var(--tone);
		flex-basis: 0;
		transition: flex-grow 400ms ease;
	}

	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		min-height: 0;
	}
	.rows li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		line-height: 1.75;
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
	.tok {
		color: color-mix(in oklab, var(--foreground) 80%, transparent);
	}
	.pct {
		width: 2.4rem;
		text-align: right;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
	}

	.caveat {
		flex: none;
		margin: 0.15rem 0 0;
		font-size: 0.625rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
		text-wrap: pretty;
	}
</style>
