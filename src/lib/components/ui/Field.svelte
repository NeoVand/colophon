<script lang="ts">
	/**
	 * A labelled input, in the app's own dress.
	 *
	 * The label is an eyebrow — the same micro-label that titles every panel —
	 * so a form reads as more instrument panel rather than as a form. The control
	 * carries `.co-field`, which is the codebase's opt-in for a focus ring: the
	 * global rule paints it in our ink and tints the border with it, instead of
	 * the browser's OS-blue halo or the forms plugin's Tailwind-blue box-shadow.
	 *
	 * The `<label>` wraps its control, so the two are associated without an id
	 * that both sides have to agree on.
	 *
	 * Text and multiline only. A dynamic `type` cannot be combined with
	 * `bind:value` in Svelte, and a numeric variant would make `value` sometimes
	 * a string and sometimes a number — `inputmode` gets the right keypad on a
	 * phone without either problem.
	 */
	let {
		label,
		value = $bindable(''),
		multiline = false,
		rows = 3,
		placeholder,
		note,
		name,
		required = false,
		disabled = false,
		inputmode,
		onkeydown
	}: {
		label: string;
		value?: string;
		multiline?: boolean;
		rows?: number;
		placeholder?: string;
		/** One line under the control. Say what the value does, not what it is. */
		note?: string;
		name?: string;
		required?: boolean;
		disabled?: boolean;
		inputmode?: 'text' | 'numeric' | 'decimal' | 'search' | 'email' | 'url';
		onkeydown?: (event: KeyboardEvent) => void;
	} = $props();
</script>

<label class="field" class:disabled>
	<span class="co-eyebrow">{label}</span>

	{#if multiline}
		<textarea
			class="co-field"
			bind:value
			{rows}
			{placeholder}
			{name}
			{required}
			{disabled}
			{inputmode}
			{onkeydown}></textarea>
	{:else}
		<input
			class="co-field"
			type="text"
			bind:value
			{placeholder}
			{name}
			{required}
			{disabled}
			{inputmode}
			{onkeydown}
		/>
	{/if}

	{#if note}<span class="note">{note}</span>{/if}
</label>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.28rem;
		min-width: 0;
	}
	.field.disabled {
		opacity: 0.55;
	}

	.co-field {
		width: 100%;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 3px;
		background: transparent;
		color: var(--foreground);
		font-family: var(--font-sans);
		font-size: 0.8125rem;
		line-height: 1.45;
	}
	.co-field::placeholder {
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	textarea.co-field {
		resize: vertical;
	}

	.note {
		font-size: 0.625rem;
		line-height: 1.4;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		text-wrap: pretty;
	}
</style>
