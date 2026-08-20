<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import type { Snippet } from 'svelte';

	/**
	 * A panel that slides in over the page.
	 *
	 * bits-ui supplies the parts that are hard and invisible when they work: the
	 * focus trap, ESC, restoring focus to whatever opened this, and marking the
	 * rest of the page inert. Everything you can see is ours, because a generated
	 * dialog arrives with a card, a shadow and a border, and this app has none.
	 *
	 * The panel scrolls as one column under a sticky frosted header, so content
	 * passes *under* the title — the same arrangement as the app header.
	 */
	let {
		open = $bindable(false),
		side = 'right',
		title,
		children
	}: {
		open?: boolean;
		side?: 'right' | 'left';
		title: string;
		children?: Snippet;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="scrim"></div>
			{/snippet}
		</Dialog.Overlay>

		<!--
			`child` rather than a `class` prop throughout: Svelte only stamps its
			scoping hash onto real elements, so a class handed to a component would
			match nothing in the <style> block below and be pruned as unused.
		-->
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class="sheet" class:left={side === 'left'}>
					<header class="co-frost">
						<Dialog.Title>
							{#snippet child({ props: titleProps })}
								<h2 {...titleProps} class="co-eyebrow">{title}</h2>
							{/snippet}
						</Dialog.Title>
						<Dialog.Close>
							{#snippet child({ props: closeProps })}
								<button {...closeProps} class="close" aria-label="Close {title}">
									<HugeiconsIcon icon={ICON.close} size={13} />
								</button>
							{/snippet}
						</Dialog.Close>
					</header>
					<div class="body">{@render children?.()}</div>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: color-mix(in oklab, var(--background) 55%, transparent);
		backdrop-filter: blur(3px) saturate(1.1);
		-webkit-backdrop-filter: blur(3px) saturate(1.1);
	}
	.scrim[data-state='open'] {
		animation: fade-in 180ms ease;
	}
	/* `reverse forwards`, not a second keyframe set: bits-ui keeps the node
	   mounted until the animation ends, and without `forwards` the element snaps
	   back to full opacity for the frame between the last keyframe and unmount. */
	.scrim[data-state='closed'] {
		animation: fade-in 150ms ease reverse forwards;
	}

	.sheet {
		position: fixed;
		top: 0;
		bottom: 0;
		right: 0;
		z-index: 61;
		width: min(27rem, 94vw);
		overflow-y: auto;
		background: var(--background);
		/* The only edge the panel has. It is over the page, so it needs one. */
		border-left: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		--from: 100%;
	}
	.sheet.left {
		right: auto;
		left: 0;
		border-left: 0;
		border-right: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		--from: -100%;
	}
	.sheet[data-state='open'] {
		animation: slide-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.sheet[data-state='closed'] {
		animation: slide-in 170ms ease reverse forwards;
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
	@keyframes slide-in {
		from {
			transform: translateX(var(--from));
		}
	}

	header {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	h2 {
		margin: 0;
		font-weight: 500;
	}

	.close {
		margin-left: auto;
		display: inline-flex;
		padding: 0.15rem;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		transition: color 150ms ease;
	}
	.close:hover {
		color: var(--foreground);
	}

	.body {
		padding: 0.9rem 1rem 1.5rem;
	}
</style>
