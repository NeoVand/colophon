<script lang="ts">
	import { session } from '$lib/agent/session.svelte';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	/**
	 * Where the tokens went.
	 *
	 * A single total tells you nothing you can act on. The split does: a
	 * conversation that is 90% *cached* input is cheap however large the number
	 * looks, and one that is 60% reasoning is expensive in a way no amount of
	 * shortening your question will fix.
	 *
	 * The bar is stacked and proportional, and the segments are drawn from the
	 * quantitative ramp rather than from the event legend — see the note in
	 * `layout.css`. The legend is tuned so nine kinds read calm at one lightness,
	 * which is exactly what makes neighbouring hues collapse when they are laid
	 * side by side in a single bar.
	 */

	const u = $derived(session.usage);

	const segments = $derived(
		[
			{
				key: 'cached',
				n: u.cached,
				tone: '--co-tok-cached',
				note: 'input the provider had already seen'
			},
			{
				key: 'input',
				n: Math.max(0, u.input - u.cached),
				tone: '--co-tok-new',
				note: 'fresh input'
			},
			{
				key: 'reasoning',
				n: u.reasoning,
				tone: '--co-tok-reason',
				note: 'thinking, billed as output'
			},
			{
				key: 'output',
				n: Math.max(0, u.output - u.reasoning),
				tone: '--co-tok-out',
				note: 'text you can read'
			}
		].filter((s) => s.n > 0)
	);

	const sum = $derived(segments.reduce((t, s) => t + s.n, 0));
</script>

<PanelFrame
	label="spend"
	icon={ICON.spend}
	tone="tok-new"
	readout={u.total ? u.total.toLocaleString() : undefined}
>
	{#if !sum}
		<EmptyState
			icon={ICON.spend}
			tone="tok-new"
			title="Nothing spent yet"
			note="A conversation that is mostly cached input is cheap however large it looks."
		/>
	{:else}
		<div class="content">
			<div class="bar" role="img" aria-label="Token breakdown">
				{#each segments as s (s.key)}
					<span
						class="seg"
						style:--tone="var({s.tone})"
						style:flex-grow={s.n}
						title="{s.key}: {s.n.toLocaleString()} — {s.note}"
					></span>
				{/each}
			</div>
			<ul class="legend">
				{#each segments as s (s.key)}
					<li>
						<span class="swatch" style:--tone="var({s.tone})"></span>
						<span class="name">{s.key}</span>
						<span class="co-num n">{s.n.toLocaleString()}</span>
						<span class="co-num pct">{Math.round((s.n / sum) * 100)}%</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</PanelFrame>

<style>
	/* The frame draws the header and its hairline; this is only what sits under
	   it, indented to the same left edge as the label above. */
	.content {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem 0.7rem 0.75rem;
	}

	.bar {
		display: flex;
		height: 6px;
		border-radius: 2px;
		overflow: hidden;
		background: var(--muted);
	}
	.seg {
		background: var(--tone);
		flex-basis: 0;
		transition: flex-grow 400ms ease;
	}

	.legend {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-mono);
		font-size: 0.625rem;
	}
	.swatch {
		width: 6px;
		height: 6px;
		border-radius: 1px;
		background: var(--tone);
		flex: none;
	}
	.name {
		color: var(--muted-foreground);
	}
	.n {
		margin-left: auto;
		color: color-mix(in oklab, var(--foreground) 80%, transparent);
	}
	.pct {
		width: 2.4rem;
		text-align: right;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
</style>
