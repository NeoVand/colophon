<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/agent/session.svelte';
	import { theme, THEMES } from '$lib/theme.svelte';

	/**
	 * The bar that never goes away.
	 *
	 * Whatever mode the app is in, the way out is here — the theme, the lab, a
	 * new thread. A mode you can enter and not get back out of is a trap however
	 * good it looks, which is a lesson harnessXray learned by shipping one.
	 *
	 * The status dot is the only thing in the header that moves. It is the
	 * answer to "is it doing something", asked from across the room.
	 */
	let { xray, onxray }: { xray: boolean; onxray: () => void } = $props();

	let picking = $state(false);

	const status = $derived(
		session.status === 'waiting' ? 'waiting' : session.status === 'running' ? 'working' : 'idle'
	);

	const dotTone = $derived(
		session.status === 'waiting'
			? '--co-approval'
			: session.status === 'running'
				? '--co-model'
				: '--co-library'
	);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') picking = false;
	}}
/>

<header class="bar co-frost">
	<span class="co-wordmark mark">colo<em>phon</em></span>

	<span class="dot" style:--tone="var({dotTone})" class:live={session.status !== 'idle'}></span>
	<span class="co-eyebrow status">{status}</span>

	{#if session.usage.total}
		<span class="co-num spend" title="Total tokens across this conversation">
			{session.usage.total.toLocaleString()}
		</span>
	{/if}

	<div class="spacer"></div>

	<a class="link" href={resolve('/vault')}>vault</a>

	<button class="link" onclick={() => session.newThread()}>new thread</button>

	<button class="link" class:on={xray} onclick={onxray} aria-pressed={xray}>x-ray</button>

	<div class="picker">
		<button class="link" onclick={() => (picking = !picking)} aria-expanded={picking}>
			{THEMES.find((t) => t.id === theme.active)?.label ?? 'theme'}
		</button>
		{#if picking}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="scrim" onclick={() => (picking = false)}></div>
			<ul class="menu co-frost">
				<li>
					<button
						class:sel={theme.choice === 'system'}
						onclick={() => {
							theme.set('system');
							picking = false;
						}}
					>
						<span>System</span><span class="note">Follow the machine.</span>
					</button>
				</li>
				{#each THEMES as t (t.id)}
					<li>
						<button
							class:sel={theme.choice === t.id}
							onclick={() => {
								theme.set(t.id);
								picking = false;
							}}
						>
							<span>{t.label}</span><span class="note">{t.note}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<a class="link" href={resolve('/lab/probe')}>lab</a>
</header>

<style>
	.bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		height: 2.6rem;
		padding: 0 1rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		position: relative;
		z-index: 20;
	}

	.mark {
		font-size: 0.875rem;
	}

	.dot {
		width: 5px;
		height: 5px;
		border-radius: 999px;
		background: var(--tone);
		opacity: 0.55;
		margin-left: 0.4rem;
	}
	.dot.live {
		opacity: 1;
		animation: breathe 1.5s ease-in-out infinite;
	}
	@keyframes breathe {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}

	.status {
		font-size: 0.5625rem;
	}

	.spend {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	.spacer {
		flex: 1;
	}

	.link {
		border: 0;
		background: transparent;
		padding: 0.15rem 0.25rem;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		text-decoration: none;
		cursor: pointer;
		transition: color 150ms ease;
	}
	.link:hover {
		color: var(--foreground);
	}
	.link.on {
		color: var(--co-accent);
	}

	.picker {
		position: relative;
	}

	/* Catches the next click anywhere so the menu closes, without a global
	   listener that has to be added and removed in the right order. */
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
	}

	.menu {
		position: absolute;
		top: calc(100% + 0.4rem);
		right: 0;
		z-index: 40;
		min-width: 15rem;
		margin: 0;
		padding: 0.25rem;
		list-style: none;
		border: 1px solid color-mix(in oklab, var(--border) 90%, transparent);
		border-radius: var(--radius-sm);
		box-shadow: 0 10px 30px -18px rgb(0 0 0 / 0.6);
	}
	.menu button {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		width: 100%;
		padding: 0.35rem 0.5rem;
		border: 0;
		border-radius: 3px;
		background: transparent;
		text-align: left;
		color: var(--foreground);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		cursor: pointer;
	}
	.menu button:hover {
		background: var(--muted);
	}
	.menu button.sel {
		color: var(--co-accent);
	}
	.note {
		font-size: 0.625rem;
		color: var(--muted-foreground);
	}
</style>
