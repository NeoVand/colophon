<script lang="ts">
	import type { Turn } from '$lib/agent/session.svelte';

	/**
	 * The run has stopped and is waiting on you.
	 *
	 * Three decisions worth naming:
	 *
	 * 1. **Inline, not a modal.** The decision belongs beside the work that
	 *    prompted it. A dialog covering the conversation makes it harder to judge
	 *    whether the brief is right, which is the only thing being asked.
	 *
	 * 2. **The literal brief.** What is shown is the argument the model wrote,
	 *    verbatim, not a summary of it. Paraphrasing what someone is approving
	 *    defeats the point of asking them.
	 *
	 * 3. **Neither button is the default.** No autofocus, no primary styling on
	 *    approve. This spends real money; a return key that lands on "yes"
	 *    because the card appeared under the cursor is a bug with a bill.
	 */
	let { turn, ondecide }: { turn: Turn; ondecide: (approve: boolean) => void } = $props();

	const approval = $derived(turn.approval);

	/** The brief, as a readable string — what is actually being approved. */
	const brief = $derived.by(() => {
		const args = approval?.args;
		if (args && typeof args === 'object' && 'prompt' in args) {
			return String((args as { prompt: unknown }).prompt);
		}
		return JSON.stringify(args, null, 2);
	});
</script>

{#if approval}
	<div class="card">
		<p class="co-eyebrow head">approve · {approval.name}</p>
		<p class="why">This spends money. You are approving the brief below, exactly as written.</p>
		<pre class="brief">{brief}</pre>
		<div class="row">
			<button onclick={() => ondecide(true)} disabled={approval.deciding}>approve</button>
			<button onclick={() => ondecide(false)} disabled={approval.deciding}>decline</button>
			{#if approval.deciding}<span class="co-eyebrow waiting">working…</span>{/if}
		</div>
	</div>
{/if}

<style>
	.card {
		margin-top: 0.6rem;
		padding: 0.7rem 0.85rem;
		border: 1px solid color-mix(in oklab, var(--co-approval) 40%, transparent);
		border-left-width: 2px;
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--co-approval) 7%, var(--background));
	}

	.head {
		color: var(--co-approval);
	}

	.why {
		margin: 0.35rem 0 0;
		font-size: 0.8125rem;
		color: var(--muted-foreground);
	}

	.brief {
		margin: 0.5rem 0 0;
		max-height: 14rem;
		overflow: auto;
		padding: 0.5rem 0.6rem;
		border: 1px solid color-mix(in oklab, var(--border) 80%, transparent);
		border-radius: 3px;
		background: var(--background);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}

	button {
		padding: 0.3rem 0.75rem;
		border: 1px solid color-mix(in oklab, var(--co-approval) 45%, transparent);
		border-radius: 3px;
		background: transparent;
		color: var(--co-approval);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		cursor: pointer;
		transition: background-color 150ms ease;
	}
	button:hover:not(:disabled) {
		background: color-mix(in oklab, var(--co-approval) 14%, transparent);
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.waiting {
		color: var(--co-approval);
	}
</style>
