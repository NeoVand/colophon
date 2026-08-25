<script module lang="ts">
	/* In the module block so a parent can `import type { Outline }` from this
	   file — types exported from the instance script are not importable. */
	export interface OutlineSection {
		heading: string;
		covers: string;
	}
	export interface Outline {
		title: string;
		sections: OutlineSection[];
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';

	/**
	 * The run has stopped on a proposed outline — and unlike every other
	 * approval, this one is editable.
	 *
	 * `ApprovalCard` shows a brief verbatim and asks yes or no, because what is
	 * being approved is a prompt about to be spent on. An outline is different:
	 * it is a plan, the reader almost always wants a word changed, and a
	 * yes/no card turns "second section should be about the controls" into a
	 * decline, a sentence of explanation and a second proposal — three round
	 * trips to move six words. So the headings are fields, and the tool receives
	 * what the reader edited rather than what the model proposed.
	 *
	 * Inherited from ApprovalCard and deliberately unchanged: inline rather than
	 * a modal, and neither button styled as the default — nothing here should be
	 * approvable by a stray return key.
	 */
	let {
		title,
		sections,
		onapprove,
		ondecline
	}: {
		title: string;
		sections: OutlineSection[];
		/** Called with the edited outline, not the proposed one. */
		onapprove: (edited: Outline) => void;
		ondecline: () => void;
	} = $props();

	/**
	 * A copy, taken once.
	 *
	 * Editing the props directly would write through to the turn that owns the
	 * pending approval, so a half-typed heading would be what a reload or a
	 * re-render restores. Taking the copy at initialisation rather than in an
	 * `$effect` is also what keeps the reader's typing safe: an effect that
	 * re-seeded this from `sections` would erase the edit on the next render,
	 * and reading and writing the same `$state` from an effect is the update
	 * loop this codebase has shipped twice.
	 *
	 * `untrack` is what says that capturing the initial value is the intent
	 * rather than an oversight — without it the compiler warns, correctly, that
	 * a later change to the prop would not reach here. It should not.
	 *
	 * `id` exists only to key the list. Two sections may legitimately carry the
	 * same heading, and a duplicate key does not merely misdraw — it throws, and
	 * the throw aborts the render.
	 */
	let draftTitle = $state(untrack(() => title));
	let draft = $state(
		untrack(() => sections.map((s, i) => ({ id: i, heading: s.heading, covers: s.covers })))
	);

	/** Set on decision so a second click cannot resume the run twice. */
	let sent = $state(false);

	// Mirrors the tool's schema. Disabling is kinder than letting the run resume
	// and come back with a validation error the reader has to read.
	const ready = $derived(
		draftTitle.trim().length >= 4 &&
			draft.every((s) => s.heading.trim().length >= 2 && s.covers.trim().length >= 4)
	);

	function approve() {
		if (sent || !ready) return;
		sent = true;
		onapprove({
			title: draftTitle.trim(),
			// Snapshot to hand over plain objects rather than the live proxy.
			sections: $state.snapshot(draft).map((s) => ({
				heading: s.heading.trim(),
				covers: s.covers.trim()
			}))
		});
	}

	function decline() {
		if (sent) return;
		sent = true;
		ondecline();
	}
</script>

<div class="card">
	<p class="co-eyebrow head">
		<HugeiconsIcon icon={ICON.prose} size={11} />
		outline · approve
	</p>
	<p class="why">Edits are what gets approved.</p>

	<input class="title" bind:value={draftTitle} aria-label="Document title" disabled={sent} />

	<ol>
		{#each draft as section, i (section.id)}
			<li>
				<span class="co-num n">{i + 1}</span>
				<div class="fields">
					<input
						class="heading"
						bind:value={section.heading}
						aria-label="Section {i + 1} heading"
						disabled={sent}
					/>
					<textarea
						class="covers"
						bind:value={section.covers}
						rows="1"
						aria-label="Section {i + 1} coverage"
						disabled={sent}></textarea>
				</div>
			</li>
		{/each}
	</ol>

	<div class="row">
		<button onclick={approve} disabled={sent || !ready}>approve</button>
		<button onclick={decline} disabled={sent}>decline</button>
		{#if sent}<span class="co-eyebrow waiting">working…</span>{/if}
	</div>
</div>

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
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--co-approval);
	}

	.why {
		margin: 0.35rem 0 0;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}

	.title {
		width: 100%;
		margin-top: 0.55rem;
		padding: 0.1rem 0;
		border: 0;
		background: transparent;
		font-family: var(--font-serif);
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--foreground);
	}

	ol {
		margin: 0.45rem 0 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		gap: 0.55rem;
		padding: 0.4rem 0;
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}

	.n {
		padding-top: 0.15rem;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--co-approval) 70%, transparent);
	}

	.fields {
		flex: 1;
		min-width: 0;
	}

	.heading,
	.covers {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--foreground);
	}

	.heading {
		font-family: var(--font-sans);
		font-size: 0.8125rem;
		font-weight: 500;
	}

	/* Grows with its content. A covers line that clips is a line the reader
	   cannot check, and this card exists to be checked. */
	.covers {
		field-sizing: content;
		min-height: 1.4em;
		resize: none;
		font-family: var(--font-sans);
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--muted-foreground);
	}

	/* The only thing that says "these are editable" until you click. Louder
	   than that would make the card a form; this is still a readout. */
	.title:hover:not(:disabled),
	.heading:hover:not(:disabled),
	.covers:hover:not(:disabled) {
		background: color-mix(in oklab, var(--co-approval) 8%, transparent);
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
