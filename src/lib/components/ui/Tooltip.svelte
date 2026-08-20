<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';

	/**
	 * A short mono label that appears beside a readout.
	 *
	 * For the sentence a dense number cannot say — what "cached" counts, what a
	 * depth means. Keep it to a phrase: anything longer is documentation, and
	 * documentation belongs on the page rather than under the pointer.
	 *
	 * Each instance carries its own `Provider` because bits-ui requires one and a
	 * primitive that works wherever it is dropped beats one the layout has to
	 * remember to wrap. The cost is small and worth naming: moving between two
	 * adjacent tips waits out the delay again instead of opening instantly.
	 *
	 * The trigger is a `<span>`, not the button bits-ui renders by default,
	 * because most things worth explaining here are readouts — and a caller who
	 * wraps their own button would otherwise nest a button inside a button.
	 * bits-ui still gives the span `tabindex="0"`, so the tip is reachable from
	 * the keyboard either way.
	 */
	let {
		text,
		side = 'top',
		delay = 320,
		children
	}: {
		text: string;
		side?: 'top' | 'bottom' | 'left' | 'right';
		/** Milliseconds of hover before it appears. */
		delay?: number;
		children?: Snippet;
	} = $props();
</script>

<Tooltip.Provider delayDuration={delay} disableHoverableContent>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<span {...props} class="anchor">{@render children?.()}</span>
			{/snippet}
		</Tooltip.Trigger>

		<Tooltip.Portal>
			<Tooltip.Content {side} sideOffset={6} collisionPadding={8}>
				{#snippet child({ props, wrapperProps })}
					<div {...wrapperProps}>
						<div {...props} class="bubble co-frost">{text}</div>
					</div>
				{/snippet}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>

<style>
	.anchor {
		display: inline-flex;
		align-items: center;
	}

	.bubble {
		z-index: 50;
		max-width: 20rem;
		padding: 0.28rem 0.45rem;
		border: 1px solid color-mix(in oklab, var(--border) 90%, transparent);
		border-radius: 3px;
		color: var(--foreground);
		font-family: var(--font-mono);
		font-size: 0.625rem;
		line-height: 1.4;
		text-wrap: pretty;
	}
	.bubble[data-state='delayed-open'],
	.bubble[data-state='instant-open'] {
		animation: rise 140ms ease;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
	}
</style>
