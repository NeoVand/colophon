<script lang="ts">
	import { session } from '$lib/agent/session.svelte';

	/**
	 * A line of text on the page, not a box.
	 *
	 * The border, the rounded rectangle and the send button are all furniture
	 * around a thing that is focused nearly all the time anyway. What is left is
	 * the text, a hairline above it to separate it from the conversation, and a
	 * key hint that fades once you have obviously read it.
	 *
	 * It grows with what you type — a research prompt is often a paragraph, and
	 * a one-line field that scrolls internally hides the beginning of your own
	 * question while you finish it.
	 */
	let draft = $state('');
	let field = $state<HTMLTextAreaElement>();

	/**
	 * Height follows content.
	 *
	 * Reset to `auto` first: without that, `scrollHeight` is measured against the
	 * height already set and the field can only ever grow, never shrink back.
	 */
	function resize() {
		if (!field) return;
		field.style.height = 'auto';
		field.style.height = `${Math.min(field.scrollHeight, 320)}px`;
	}

	async function send() {
		const prompt = draft;
		if (!prompt.trim() || session.busy) return;
		draft = '';
		// Height is set imperatively, so clearing the value does not reset it.
		queueMicrotask(resize);
		await session.send(prompt);
	}

	function onKeydown(event: KeyboardEvent) {
		// Enter sends; Shift+Enter is a newline. Standard for a chat composer,
		// and worth keeping standard — this is not the place to be interesting.
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send();
		}
	}

	const waiting = $derived(session.status === 'waiting');
</script>

<div class="bar">
	<div class="column">
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

		<div class="controls">
			{#if session.status === 'running'}
				<button class="ghost" onclick={() => session.stop()}>stop</button>
			{:else if draft.trim()}
				<span class="co-eyebrow hint">return to send</span>
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
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		max-width: 46rem;
		margin: 0 auto;
		padding: 0.75rem 1.5rem 1rem calc(1.5rem + var(--co-gutter));
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
	.field::placeholder {
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
	.field:disabled {
		opacity: 0.5;
	}

	.controls {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-bottom: 0.1rem;
		min-height: 1.6rem;
	}

	.hint {
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	.ghost {
		padding: 0.15rem 0.5rem;
		border: 1px solid color-mix(in oklab, var(--border) 120%, transparent);
		border-radius: 3px;
		background: transparent;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		cursor: pointer;
	}
	.ghost:hover {
		color: var(--foreground);
	}
</style>
