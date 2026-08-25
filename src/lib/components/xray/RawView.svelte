<script lang="ts">
	import { onDestroy } from 'svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';

	/**
	 * The frame, untouched.
	 *
	 * The tree beside this one is a *reading* of the payload — it folds, it
	 * clamps, it collapses a Map into rows. Useful, and one step away from the
	 * thing itself. This tab is the escape hatch: the literal bytes, in the
	 * order they arrived, selectable and copyable, so a reader who suspects the
	 * viewer of lying can check, and so anything found here can be pasted into a
	 * bug report without being retyped.
	 *
	 * That is the whole reason both tabs exist. An X-ray that only ever shows
	 * its own interpretation is asking to be trusted; showing the source
	 * alongside is how it earns it.
	 */

	interface Props {
		value: unknown;
		/** Shown on the copy confirmation, so a reader knows what landed. */
		label?: string;
	}

	let { value, label = 'payload' }: Props = $props();

	/** Beyond this the view truncates. Copy still takes the whole thing. */
	const VIEW_LIMIT = 120_000;

	/**
	 * Pretty-print anything, including what JSON cannot hold.
	 *
	 * The cycle guard tracks *ancestors*, not every object seen. The usual
	 * one-line `WeakSet` version is wrong in a way that looks right: it flags the
	 * second appearance of a shared object as circular, so a result holding the
	 * same paper twice — which is a completely ordinary shape — renders as
	 * `[circular]` and the reader concludes the payload is broken.
	 */
	function pretty(v: unknown): string {
		if (v === undefined) return 'undefined';
		const ancestors: unknown[] = [];
		try {
			const out = JSON.stringify(
				v,
				function (this: unknown, _key: string, val: unknown) {
					if (typeof val === 'bigint') return `${val}n`;
					if (typeof val === 'function') return `ƒ ${val.name || 'anonymous'}()`;
					if (typeof val === 'symbol') return val.toString();
					if (typeof val !== 'object' || val === null) return val;
					// `this` is the object holding `val`, so unwinding to it leaves the
					// stack holding exactly this value's ancestors.
					while (ancestors.length && ancestors[ancestors.length - 1] !== this) ancestors.pop();
					if (ancestors.includes(val)) return '[circular]';
					ancestors.push(val);
					return val;
				},
				2
			);
			// `stringify` answers `undefined` for a bare function or symbol.
			return out ?? String(v);
		} catch (cause) {
			const why = cause instanceof Error ? cause.message : String(cause);
			return `/* not serialisable: ${why} */`;
		}
	}

	const text = $derived(pretty(value));
	const clipped = $derived(text.length > VIEW_LIMIT);

	/**
	 * The note is composed here rather than in the markup.
	 *
	 * Prettier reflows the inside of an interpolated `<pre>` — it does not know
	 * the whitespace is content — so a `{#if}` written in the template came back
	 * from the formatter with tabs baked into the rendered output. Building the
	 * string in the script leaves nothing there for a formatter to indent.
	 */
	const body = $derived(
		clipped
			? `${text.slice(0, VIEW_LIMIT)}\n\n/* ${(text.length - VIEW_LIMIT).toLocaleString()} more characters — the copy button takes all of them */`
			: text
	);

	let copied = $state<'idle' | 'done' | 'failed'>('idle');
	let revert: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		clearTimeout(revert);
		try {
			// Absent rather than merely failing on an insecure origin, so the
			// optional call is load-bearing.
			await navigator.clipboard?.writeText(text);
			copied = navigator.clipboard ? 'done' : 'failed';
		} catch {
			copied = 'failed';
		}
		revert = setTimeout(() => (copied = 'idle'), 1600);
	}

	onDestroy(() => clearTimeout(revert));
</script>

<div class="raw">
	<div class="bar">
		<span class="co-num size">
			{text.length.toLocaleString()} chars{#if clipped}
				· {VIEW_LIMIT.toLocaleString()} shown{/if}
		</span>
		<button
			class="copy"
			class:done={copied === 'done'}
			class:failed={copied === 'failed'}
			type="button"
			onclick={copy}
		>
			<HugeiconsIcon icon={copied === 'done' ? ICON.check : ICON.copy} size={12} />
			<span class="co-eyebrow"
				>{copied === 'done' ? 'copied' : copied === 'failed' ? 'blocked' : 'copy'}</span
			>
		</button>
	</div>

	<pre class="frame">{body}</pre>

	<span class="sr" role="status" aria-live="polite">
		{copied === 'done' ? `${label} copied` : copied === 'failed' ? 'copying was blocked' : ''}
	</span>
</div>

<style>
	.raw {
		display: flex;
		flex-direction: column;
		min-height: 0;
		gap: 0.35rem;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex: none;
	}

	.size {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	.copy {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 0;
		background: transparent;
		padding: 0.1rem 0.2rem;
		cursor: pointer;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
		transition: color 180ms ease;
	}
	.copy:hover {
		color: var(--co-accent);
	}
	.copy .co-eyebrow {
		font-size: 0.5rem;
		color: inherit;
	}
	.copy.done {
		color: var(--co-accent);
	}
	.copy.failed {
		color: var(--co-error);
	}

	.frame {
		margin: 0;
		min-height: 0;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		line-height: 1.55;
		/* Wrapped rather than scrolled sideways: a 4kb argument string on one
		   endless line is technically the raw frame and practically unreadable. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: color-mix(in oklab, var(--foreground) 82%, transparent);
		-webkit-user-select: text;
		user-select: text;
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
