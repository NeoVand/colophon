<script lang="ts">
	import { session } from '$lib/agent/session.svelte';
	import { apportion, bands, type Part } from '$lib/agent/context';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Toolbar from '$lib/components/ui/Toolbar.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';

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

	/**
	 * Percent or tokens, never both.
	 *
	 * They answer different questions and the panel is too narrow to ask both at
	 * once. A share says which row *dominates* — the reading that matters while a
	 * turn is running and the numbers are moving. A token count is what you put in
	 * a message to someone: "the schemas are 4,100 tokens on every call" is an
	 * argument, "the schemas are 31%" is an observation.
	 */
	let unit = $state<'share' | 'tokens'>('share');

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
		if (!ctx) return;
		const payload = {
			call: ctx.call,
			bytes: ctx.bytes,
			inputTokens,
			parts: rows.map((r) => ({
				kind: r.kind,
				label: r.label,
				chars: r.chars,
				share: r.share,
				tokens: r.tokens
			}))
		};
		await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
		copied = true;
		clearTimeout(flash);
		flash = setTimeout(() => (copied = false), 1200);
	}
</script>

<PanelFrame
	label="context"
	icon={ICON.context}
	tone="memory"
	readout={ctx ? `call ${ctx.call} · ${kb(ctx.bytes)}B` : undefined}
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
				disabled={!ctx}
				onclick={copyJson}
			/>
		</Toolbar>
	{/snippet}

	{#if !ctx}
		<EmptyState icon={ICON.context} tone="memory" title="Nothing sent yet" />
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
					{#if unit === 'tokens' && row.tokens}
						<span class="co-num tok">{row.tokens.toLocaleString()}</span>
					{:else}
						<span class="co-num pct">{Math.round(row.share * 100)}%</span>
					{/if}
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
				{inputTokens.toLocaleString()} billed input tokens, split by size — attributed, not measured.
			</p>
		{/if}
	{/if}
</PanelFrame>

<style>
	/* The frame draws the header; each block below indents itself to the same
	   left edge as the label above it. */
	.bar {
		display: flex;
		height: 6px;
		border-radius: 2px;
		overflow: hidden;
		background: var(--muted);
		flex: none;
		margin: 0.6rem 0.7rem 0.5rem;
	}
	.seg {
		background: var(--tone);
		flex-basis: 0;
		transition: flex-grow 400ms ease;
	}

	.rows {
		margin: 0;
		padding: 0 0.7rem;
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

	.caveat {
		flex: none;
		margin: 0.25rem 0 0;
		padding: 0 0.7rem 0.7rem;
		font-size: 0.625rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
		text-wrap: pretty;
	}
</style>
