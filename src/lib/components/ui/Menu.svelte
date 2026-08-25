<script lang="ts" module>
	import type { IconSvgElement } from '@hugeicons/svelte';

	export interface MenuOption {
		/** Must be unique across `items` — a duplicate key aborts the render. */
		id: string;
		label: string;
		/** One short sentence under the label, as in the theme picker. */
		note?: string;
		icon?: IconSvgElement;
		selected?: boolean;
		onselect: () => void;
	}
</script>

<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import type { Snippet } from 'svelte';

	/**
	 * The dropdown the theme picker in Header.svelte drew by hand.
	 *
	 * Same look, but the keyboard works: arrow keys move the highlight, typing
	 * jumps to a label, ESC closes and focus goes back to the trigger. The
	 * hand-rolled version needed a fixed scrim to catch the next click; bits-ui
	 * handles dismissal, so that trick is gone.
	 */
	let {
		items,
		trigger,
		align = 'end'
	}: {
		items: MenuOption[];
		/** Rendered inside our own button, so a caller supplies a label, not a control. */
		trigger: Snippet;
		align?: 'start' | 'center' | 'end';
	} = $props();

	let open = $state(false);

	/* Reserve the icon column only when something in the menu uses it, so a
	   menu of plain labels is not indented past an empty gutter. */
	const hasIcons = $derived(items.some((i) => i.icon));
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<button {...props} class="trigger" class:on={open}>{@render trigger()}</button>
		{/snippet}
	</DropdownMenu.Trigger>

	<DropdownMenu.Portal>
		<DropdownMenu.Content {align} sideOffset={6} collisionPadding={8}>
			{#snippet child({ props, wrapperProps })}
				<!-- The wrapper carries the floating position; the inner div is the menu. -->
				<div {...wrapperProps}>
					<div {...props} class="menu co-frost" class:icons={hasIcons}>
						{#each items as item (item.id)}
							<DropdownMenu.Item textValue={item.label} onSelect={() => item.onselect()}>
								{#snippet child({ props: itemProps })}
									<div {...itemProps} class="item" class:sel={item.selected}>
										{#if hasIcons}
											<span class="ico">
												{#if item.icon}<HugeiconsIcon icon={item.icon} size={13} />{/if}
											</span>
										{/if}
										<span class="label">{item.label}</span>
										<span class="tick">
											{#if item.selected}<HugeiconsIcon icon={ICON.check} size={12} />{/if}
										</span>
										{#if item.note}<span class="note">{item.note}</span>{/if}
									</div>
								{/snippet}
							</DropdownMenu.Item>
						{/each}
					</div>
				</div>
			{/snippet}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.25rem;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		cursor: pointer;
		transition: color 150ms ease;
	}
	.trigger:hover,
	.trigger.on {
		color: var(--foreground);
	}

	.menu {
		z-index: 50;
		min-width: 13rem;
		padding: 0.25rem;
		border: 1px solid color-mix(in oklab, var(--border) 90%, transparent);
		border-radius: var(--radius-sm);
		/* The one shadow in the app, and only because this floats over content:
		   without it the frosted panel dissolves into whatever is behind it. */
		box-shadow: 0 10px 30px -18px rgb(0 0 0 / 0.6);
	}

	.item {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		column-gap: 0.45rem;
		padding: 0.35rem 0.5rem;
		border-radius: 3px;
		color: var(--foreground);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		cursor: pointer;
		/* Suppressed on purpose: bits-ui moves DOM focus with the highlight, so a
		   keyboard user would otherwise get a focus ring *and* the highlight below
		   saying the same thing twice. */
		outline: none;
	}
	/* bits-ui sets data-highlighted for both pointer and keyboard, so the two
	   cannot drift apart the way :hover and a focus class do. */
	.item[data-highlighted] {
		background: var(--muted);
	}
	.item.sel {
		color: var(--co-accent);
	}

	.ico,
	.tick {
		display: inline-flex;
		width: 13px;
		justify-content: center;
		color: inherit;
	}

	.label {
		min-width: 0;
	}

	/* The note lines up under the label, which means starting a column later
	   when the menu has an icon gutter and not when it does not. */
	.note {
		grid-column: 1 / -1;
		font-size: 0.625rem;
		line-height: 1.35;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	.menu.icons .note {
		grid-column: 2 / -1;
	}
</style>
