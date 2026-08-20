<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import { session } from '$lib/agent/session.svelte';
	import Menu, { type MenuOption } from '$lib/components/ui/Menu.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';

	/**
	 * A line of text on the page, not a box. The border and the rounded
	 * rectangle are furniture around a thing that is focused nearly all the time
	 * anyway; what is left is the text, a hairline above it, a "+" for the
	 * actions worth having, and one button that sends or stops.
	 *
	 * Nothing here is decorative. A greyed item with a "coming soon" tooltip
	 * teaches the reader that this app's controls are suggestions; every entry
	 * in the menu moves real state, or it is not in the menu.
	 */
	type Mode = 'chat' | 'research';

	let {
		mode = $bindable('chat'),
		onmode
	}: {
		/** The composer owns the control; the caller decides what it means. */
		mode?: Mode;
		onmode?: (mode: Mode) => void;
	} = $props();

	let draft = $state('');
	let field = $state<HTMLTextAreaElement>();
	let attaching = $state(false);
	let rawId = $state('');
	let idField = $state<HTMLInputElement>();

	const waiting = $derived(session.status === 'waiting');
	const running = $derived(session.status === 'running');

	/* People paste the abs URL far more often than they type a bare id, so the
	   URL and the "arXiv:" prefix are stripped rather than rejected. */
	const paperId = $derived(
		rawId
			.trim()
			.replace(/^(?:(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\/|arxiv:)/i, '')
			.replace(/\.pdf$/i, '')
	);
	// Both id schemes: 2401.12345v2, and the pre-2007 hep-th/9901001.
	const idOk = $derived(
		/^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Za-z]{2})?\/\d{7}(?:v\d+)?)$/i.test(paperId)
	);

	// Four characters to a token is the rule of thumb for English prose. It is
	// labelled an estimate because it is one: the billed count arrives with the
	// turn, and rounding a guess into a fact is a small lie told every keystroke.
	const estimate = $derived(Math.max(1, Math.round(draft.length / 4)));

	function setMode(next: Mode) {
		mode = next;
		onmode?.(next);
	}

	/** Reset to `auto` first, or `scrollHeight` is measured against the height
	 * already set and the field can only grow, never shrink back. */
	function resize() {
		if (!field) return;
		field.style.height = 'auto';
		field.style.height = `${Math.min(field.scrollHeight, 320)}px`;
	}

	function openAttach() {
		rawId = '';
		attaching = true;
		// The menu hands focus back to its trigger as it closes, and that lands
		// after this tick — focusing straight away loses the race and the caret
		// ends up on the "+" rather than in the field that just appeared.
		setTimeout(() => idField?.focus(), 80);
	}

	/** Prepend the fetch instruction; the reader's own question follows it. */
	function attach() {
		if (!idOk) return;
		const line = `Fetch arXiv ${paperId} and read it in full before answering.`;
		draft = draft.trim() ? `${line}\n\n${draft.trim()}` : `${line}\n\n`;
		attaching = false;
		queueMicrotask(() => {
			resize();
			field?.focus();
			field?.setSelectionRange(draft.length, draft.length);
		});
	}

	const actions: MenuOption[] = $derived([
		{
			id: 'research',
			label: mode === 'research' ? 'Deep research — on' : 'Deep research',
			note: 'Plan first, read several papers, then answer.',
			icon: ICON.search,
			selected: mode === 'research',
			onselect: () => setMode(mode === 'research' ? 'chat' : 'research')
		},
		{
			id: 'arxiv',
			label: 'Attach a paper by arXiv id',
			note: 'Puts a fetch instruction in front of your question.',
			icon: ICON.paper,
			onselect: openAttach
		},
		// Live during an approval too, on purpose: a decision you cannot walk
		// away from is a trap, and this is the way out of one.
		{
			id: 'clear',
			label: 'Clear conversation',
			note: 'Starts a fresh thread. The old one stays in history.',
			icon: ICON.trash,
			onselect: () => session.newThread()
		}
	]);

	async function send() {
		const prompt = draft;
		if (!prompt.trim() || session.busy) return;
		draft = '';
		// Height is set imperatively, so clearing the value does not reset it.
		queueMicrotask(resize);
		await session.send(prompt);
	}

	function onKeydown(event: KeyboardEvent) {
		// Enter sends, Shift+Enter is a newline — not the place to be
		// interesting. `isComposing` guards an IME: mid-composition Enter commits
		// the candidate, and sending there fires off a half-typed sentence.
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			send();
		}
	}

	function onIdKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			attach();
		} else if (event.key === 'Escape') {
			attaching = false;
			field?.focus();
		}
	}
</script>

<div class="bar">
	<div class="column">
		<div class="row">
			<Menu items={actions} align="start">
				{#snippet trigger()}<span class="plus">+</span>{/snippet}
			</Menu>

			<textarea
				bind:this={field}
				bind:value={draft}
				oninput={resize}
				onkeydown={onKeydown}
				rows="1"
				disabled={waiting}
				placeholder={waiting ? 'waiting on your approval above…' : 'Ask Colophon…'}
				class="co-bare field"
				aria-label="Ask Colophon"></textarea>

			<!-- One button, two jobs: while the run is streaming the only thing
			     worth pressing here is the one that stops it. -->
			<button
				class="act"
				style:--ink={running ? 'var(--muted-foreground)' : 'var(--co-user)'}
				onclick={() => (running ? session.stop() : send())}
				disabled={!running && (waiting || !draft.trim())}
				aria-label={running ? 'Stop the run' : 'Send'}
			>
				<HugeiconsIcon icon={running ? ICON.close : ICON.run} size={15} />
			</button>
		</div>

		{#if attaching}
			<div class="attach">
				<span class="co-eyebrow tag">arXiv</span>
				<input
					bind:this={idField}
					bind:value={rawId}
					onkeydown={onIdKeydown}
					class="co-bare id"
					placeholder="2401.12345, or paste the abs URL"
					aria-label="arXiv id"
					spellcheck="false"
				/>
				<button class="mini" onclick={attach} disabled={!idOk}>prefix</button>
				<button class="mini" onclick={() => (attaching = false)}>dismiss</button>
			</div>
		{/if}

		<div class="foot">
			{#if mode === 'research'}
				<button class="chip co-eyebrow" onclick={() => setMode('chat')} aria-label="Leave research">
					<HugeiconsIcon icon={ICON.search} size={10} /> deep research
					<HugeiconsIcon icon={ICON.close} size={9} />
				</button>
			{/if}

			<span class="co-eyebrow hint">
				{waiting ? 'decide above to continue' : 'return sends · shift return for a newline'}
			</span>

			{#if draft.length}
				<Tooltip text="Roughly four characters to a token. The billed count arrives with the turn.">
					<span class="co-num est">
						{draft.length.toLocaleString()} chars · ≈{estimate.toLocaleString()} tokens (estimate)
					</span>
				</Tooltip>
			{/if}
		</div>
	</div>
</div>

<style>
	.bar {
		flex: none;
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.column {
		max-width: 46rem;
		margin: 0 auto;
		padding: 0.6rem 1.5rem 0.7rem calc(1.5rem + var(--co-gutter));
	}
	.row,
	.attach,
	.foot {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.row {
		align-items: flex-end;
	}
	/* A typed glyph, not an icon: the registry has no plus, and "+" in the mono
	   face sits beside the readouts more honestly than a borrowed symbol. */
	.plus {
		font-family: var(--font-mono);
		font-size: 1rem;
		line-height: 1.4;
	}
	.field {
		flex: 1;
		min-height: 1.6rem;
		max-height: 20rem;
		resize: none;
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--foreground);
		font-family: var(--font-sans);
		font-size: 0.95rem;
		line-height: 1.6;
	}
	.act,
	.mini,
	.chip {
		border: 0;
		background: transparent;
		cursor: pointer;
		transition:
			color 150ms ease,
			opacity 150ms ease;
	}
	/* The ink follows the job — the colour the conversation already gives your
	   own turns while it sends, plain chrome while it stops. Set in the markup
	   where the state lives, so the two readings cannot fight over specificity. */
	.act {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		color: color-mix(in oklab, var(--ink) 80%, transparent);
	}
	.act:hover:not(:disabled) {
		color: var(--ink);
	}
	.attach {
		margin-top: 0.45rem;
	}
	.attach,
	.foot {
		padding-left: 1.7rem;
	}
	.foot {
		min-height: 1rem;
		margin-top: 0.3rem;
	}
	.tag {
		color: var(--co-library);
	}
	.id {
		flex: 1;
		min-width: 0;
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--foreground);
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}
	.mini {
		padding: 0.1rem 0.2rem;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.625rem;
	}
	/* The mode is a standing choice, so it stays visible with its own way out —
	   a flag you can only unset from inside a menu is a trap. */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0;
		color: var(--co-subagent);
	}
	.mini:hover:not(:disabled),
	.chip:hover {
		color: var(--foreground);
	}
	.field:disabled,
	.act:disabled,
	.mini:disabled {
		opacity: 0.35;
		cursor: default;
	}
	/* Pushed right on its own, so the foot needs no spacer element. */
	.hint {
		margin-left: auto;
	}
	.field::placeholder,
	.id::placeholder,
	.hint {
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}
	.est {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
</style>
