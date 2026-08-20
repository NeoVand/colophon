<script lang="ts">
	import { resolve } from '$app/paths';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import { session } from '$lib/agent/session.svelte';
	import { theme, THEMES } from '$lib/theme.svelte';
	import Menu, { type MenuOption } from '$lib/components/ui/Menu.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import type { FlankMode } from '$lib/layout.svelte';

	/**
	 * The bar that never goes away.
	 *
	 * Whatever mode the app is in, the way out is here — the theme, the book,
	 * history, a new thread. A mode you can enter and not get back out of is a
	 * trap however good it looks, which is a lesson harnessXray learned by
	 * shipping one.
	 *
	 * Everything right of the wordmark is an icon with a tooltip rather than a
	 * word. Nine labelled controls is a menu bar; nine glyphs at 14px is chrome,
	 * and chrome is what a header should be.
	 *
	 * The status dot is the only thing here that moves. It answers "is it doing
	 * something" from across the room.
	 */
	let {
		flank,
		onflank,
		mode,
		onmode,
		onsettings,
		onabout,
		onthreads,
		onnew
	}: {
		flank: boolean;
		onflank: () => void;
		mode: FlankMode;
		onmode: (mode: FlankMode) => void;
		onsettings: () => void;
		onabout: () => void;
		onthreads: () => void;
		onnew: () => void;
	} = $props();

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

	/** System first: "follow the machine" is a real choice, not the absence of one. */
	const themeItems: MenuOption[] = $derived([
		{
			id: 'system',
			label: 'System',
			note: 'Follow the machine.',
			selected: theme.choice === 'system',
			onselect: () => theme.set('system')
		},
		...THEMES.map((t) => ({
			id: t.id,
			label: t.label,
			note: t.note,
			icon: t.scheme === 'dark' ? ICON.dark : ICON.light,
			selected: theme.choice === t.id,
			onselect: () => theme.set(t.id)
		}))
	]);

	const activeScheme = $derived(THEMES.find((t) => t.id === theme.active)?.scheme ?? 'dark');
</script>

<header class="bar co-frost">
	<span class="co-wordmark mark">colo<em>phon</em></span>

	<span class="dot" style:--tone="var({dotTone})" class:live={session.status !== 'idle'}></span>
	<span class="co-eyebrow status">{status}</span>

	{#if session.usage.total}
		<Tooltip text="Total tokens across this conversation">
			<span class="co-num spend">{session.usage.total.toLocaleString()}</span>
		</Tooltip>
	{/if}

	<div class="spacer"></div>

	<Tooltip text="Past conversations">
		<button class="icon" onclick={onthreads} aria-label="History">
			<HugeiconsIcon icon={ICON.thread} size={14} />
		</button>
	</Tooltip>

	<Tooltip text="Start a new conversation">
		<button class="icon" onclick={onnew} aria-label="New thread">
			<HugeiconsIcon icon={ICON.generate} size={14} />
		</button>
	</Tooltip>

	<Tooltip text="The vault — what is being followed, and what came of it">
		<a class="icon" href={resolve('/vault')} aria-label="Vault">
			<HugeiconsIcon icon={ICON.library} size={14} />
		</a>
	</Tooltip>

	<Tooltip text="The book — how all of this works">
		<a class="icon" href={resolve('/book')} aria-label="Book">
			<HugeiconsIcon icon={ICON.book} size={14} />
		</a>
	</Tooltip>

	<span class="sep" aria-hidden="true"></span>

	<!-- Only offered while the flank is open. A cockpit with nowhere to be drawn
	     is a control that does nothing, which is worse than one that is absent. -->
	{#if flank}
		<Tooltip text={mode === 'cockpit' ? 'Show the panels' : 'Draw the instruments'}>
			<button
				class="icon"
				class:on={mode === 'cockpit'}
				onclick={() => onmode(mode === 'cockpit' ? 'panels' : 'cockpit')}
				aria-label="Cockpit mode"
				aria-pressed={mode === 'cockpit'}
			>
				<HugeiconsIcon icon={ICON.graph} size={14} />
			</button>
		</Tooltip>
	{/if}

	<Tooltip text={flank ? 'Hide the X-ray' : 'Show the X-ray'}>
		<button class="icon" class:on={flank} onclick={onflank} aria-label="X-ray" aria-pressed={flank}>
			<HugeiconsIcon icon={ICON.panel} size={14} />
		</button>
	</Tooltip>

	<Menu items={themeItems} align="end">
		{#snippet trigger()}
			<HugeiconsIcon icon={activeScheme === 'dark' ? ICON.dark : ICON.light} size={14} />
		{/snippet}
	</Menu>

	<Tooltip text="Settings">
		<button class="icon" onclick={onsettings} aria-label="Settings">
			<HugeiconsIcon icon={ICON.settings} size={14} />
		</button>
	</Tooltip>

	<Tooltip text="About Colophon">
		<button class="icon" onclick={onabout} aria-label="About">
			<HugeiconsIcon icon={ICON.about} size={14} />
		</button>
	</Tooltip>
</header>

<style>
	.bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.15rem;
		height: 2.6rem;
		padding: 0 0.65rem 0 1rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		position: relative;
		z-index: 20;
	}

	.mark {
		font-size: 0.875rem;
		margin-right: 0.45rem;
	}

	.dot {
		width: 5px;
		height: 5px;
		border-radius: 999px;
		background: var(--tone);
		opacity: 0.55;
		flex: none;
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
		margin-left: 0.35rem;
	}

	.spend {
		font-size: 0.625rem;
		margin-left: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	.spacer {
		flex: 1;
	}

	/* A hairline, not a pipe: it groups the view controls away from navigation
	   without adding a second visual weight to a 2.6rem bar. */
	.sep {
		width: 1px;
		height: 0.9rem;
		margin: 0 0.3rem;
		background: color-mix(in oklab, var(--border) 80%, transparent);
	}

	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		cursor: pointer;
		transition:
			color 150ms ease,
			background-color 150ms ease;
	}
	.icon:hover {
		color: var(--foreground);
		background: color-mix(in oklab, var(--muted) 70%, transparent);
	}
	.icon.on {
		color: var(--co-accent);
	}
</style>
