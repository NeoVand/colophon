<script module lang="ts">
	/**
	 * The X-ray's instruments, named once.
	 *
	 * Exported from the module script rather than kept private because the
	 * parent owns the on/off record and would otherwise have to re-type the ids
	 * — two lists of five strings that must agree, which is one list too many.
	 */
	export const PANELS = [
		{ id: 'spend', label: 'Spend', note: 'Tokens, by kind, for the whole conversation.' },
		{ id: 'memory', label: 'Memory', note: 'What survives past this thread.' },
		{ id: 'context', label: 'Context', note: 'The outgoing request, taken apart.' },
		{ id: 'library', label: 'Library', note: 'Every paper met, and how well it is known.' },
		{ id: 'events', label: 'Events', note: 'The raw stream, in order, with timings.' }
	] as const;

	export type PanelId = (typeof PANELS)[number]['id'];

	/** A model the picker offers. `note` is what choosing it costs you. */
	export interface ModelOption {
		id: string;
		note: string;
	}

	export const MODELS: ModelOption[] = [
		{ id: 'gpt-5', note: 'The default. Holds a long read together.' },
		{ id: 'gpt-5-mini', note: 'Quicker and cheaper; thinner synthesis.' },
		{ id: 'gpt-5-nano', note: 'For wiring and smoke tests, not for digests.' }
	];
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import { ICON } from '$lib/icons';
	import { theme, THEMES } from '$lib/theme.svelte';

	/**
	 * Settings, as five readouts you can push on.
	 *
	 * Deliberately server-blind. Nothing here imports `$lib/server/*` — the
	 * model default and the delivery status arrive as props, because the moment
	 * a settings panel reaches for `env` it stops being a component and becomes
	 * a second copy of the server's configuration, drifting from the first.
	 *
	 * The theme is the one exception to "props in, events out", and it is not
	 * really an exception: the theme store *is* the browser's state, it paints
	 * the document itself, and routing it through the parent would mean the
	 * picker and the header could disagree about what is on screen.
	 */
	interface Props {
		open?: boolean;
		/** The model the next run will use. */
		model?: string;
		models?: ModelOption[];
		onmodel?: (id: string) => void;
		/** Panels the flank is showing. Missing means shown. */
		panels?: Partial<Record<PanelId, boolean>>;
		onpanel?: (id: PanelId, on: boolean) => void;
		/** Whether the server has somewhere to deliver a digest. */
		delivery?: boolean;
		/** Where it goes, when it is configured. */
		deliveryTo?: string;
		/** Called after local storage is wiped, before the reload. */
		onclear?: () => void;
	}

	let {
		open = $bindable(false),
		model = 'gpt-5',
		models = MODELS,
		onmodel,
		panels = {},
		onpanel,
		delivery = false,
		deliveryTo,
		onclear
	}: Props = $props();

	/* ── the live swatches ──────────────────────────────────────────────────
	   A picker that shows four identical grey rectangles is a list of words.
	   These are the real palettes, read off the real stylesheet.

	   How, and why it does not flash: each theme's tokens live in a `:root`
	   block, so they cannot be sampled from a nested element — the only place
	   they exist is the document element. So we set the attribute, read, and
	   put it back, all inside one synchronous task. `getComputedStyle` forces a
	   recalculation of the root's own style and nothing else; descendants are
	   only marked dirty, and by the time the browser gets round to restyling
	   them the original values are back. No paint happens in between, so no
	   transition on any element ever sees the intermediate value. */
	interface Swatch {
		bg: string;
		fg: string;
		edge: string;
		accent: string;
		tool: string;
		library: string;
	}

	let swatches = $state<Record<string, Swatch>>({});

	/**
	 * Whether the machine is asking for dark, kept live.
	 *
	 * The System row shows the palette it would actually give you, which is a
	 * different picture at 2pm and at 2am. A plain listener rather than an
	 * effect: this reads the OS, not any tracked state.
	 */
	let prefersDark = $state(false);
	const systemId = $derived(prefersDark ? 'midnight' : 'paper');
	const systemLabel = $derived(THEMES.find((t) => t.id === systemId)?.label ?? systemId);

	onMount(() => {
		const root = document.documentElement;
		const prevTheme = root.getAttribute('data-theme');
		const prevDark = root.classList.contains('dark');
		// Live object: re-reading it after each attribute change gives fresh values.
		const cs = getComputedStyle(root);
		const read = (name: string) => cs.getPropertyValue(name).trim();
		const out: Record<string, Swatch> = {};

		try {
			for (const t of THEMES) {
				// `chalk` and `midnight` have no `[data-theme]` block of their own —
				// they *are* the base `:root` and `.dark`. Setting the attribute
				// anyway is harmless: it matches no rule, which is exactly right.
				root.setAttribute('data-theme', t.id);
				root.classList.toggle('dark', t.scheme === 'dark');
				out[t.id] = {
					bg: read('--background'),
					fg: read('--foreground'),
					edge: read('--border'),
					accent: read('--co-accent'),
					tool: read('--co-tool'),
					library: read('--co-library')
				};
			}
		} finally {
			// In a `finally` because leaving the document in another theme is a
			// far worse failure than a picker without swatches.
			if (prevTheme === null) root.removeAttribute('data-theme');
			else root.setAttribute('data-theme', prevTheme);
			root.classList.toggle('dark', prevDark);
		}

		swatches = out;

		const media = window.matchMedia('(prefers-color-scheme: dark)');
		prefersDark = media.matches;
		const onchange = (e: MediaQueryListEvent) => (prefersDark = e.matches);
		media.addEventListener('change', onchange);
		return () => media.removeEventListener('change', onchange);
	});

	/**
	 * Built as a string rather than with `style:` directives so an unsampled
	 * theme yields an empty declaration the browser drops, and the fallbacks in
	 * the stylesheet stand in. A swatch that is briefly grey beats one that is
	 * briefly transparent.
	 */
	function swatchStyle(id: string): string {
		const s = swatches[id];
		if (!s) return '';
		return (
			`--sw-bg:${s.bg};--sw-fg:${s.fg};--sw-edge:${s.edge};` +
			`--sw-a:${s.accent};--sw-b:${s.tool};--sw-c:${s.library}`
		);
	}

	/* ── panels ─────────────────────────────────────────────────────────── */

	const shown = (id: PanelId) => panels[id] !== false;

	/* ── danger ─────────────────────────────────────────────────────────── */

	let confirming = $state(false);
	let doomed = $state(0);

	/**
	 * Prefix scan, not a hardcoded list.
	 *
	 * The keys are written by whichever module needs one — `colophon:theme` in
	 * the theme store, `colophon:thread` in the session, `colophon:xray` on the
	 * page — and a list here would go stale the first time someone adds a
	 * fourth without knowing this button exists. Then "clear local data" would
	 * quietly leave some behind, which is the one thing it must not do.
	 */
	function localKeys(): string[] {
		const keys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k?.startsWith('colophon:')) keys.push(k);
		}
		return keys;
	}

	function arm() {
		doomed = localKeys().length;
		confirming = true;
	}

	function clearLocal() {
		for (const k of localKeys()) localStorage.removeItem(k);
		onclear?.();
		// A reload rather than resetting each store in place. The theme, the
		// thread id and the panel toggles live in three different modules; a
		// half-cleared app still showing yesterday's thread is a worse answer
		// than a blank second.
		location.reload();
	}

	/**
	 * Disarm on close, so reopening never lands on a red button.
	 *
	 * This cannot be a `$derived`: whether you have confirmed is something you
	 * did, not something computed from `open`. And it is a safe effect — it
	 * reads `open` and writes `confirming`, never the reverse, so it cannot
	 * become the `effect_update_depth_exceeded` loop this codebase has shipped
	 * twice. The Sheet owns the close, so there is no handler to hang it on.
	 */
	$effect(() => {
		if (!open) confirming = false;
	});
</script>

<Sheet bind:open side="right" title="Settings">
	<div class="sheet">
		<section class="sec">
			<h3 class="co-eyebrow">theme</h3>
			<p class="lede">
				A temperature, not a brightness switch. Each one retunes the whole legend, so the app
				changes character without you having to relearn it.
			</p>

			<div class="rows">
				<button
					class="row"
					class:sel={theme.choice === 'system'}
					aria-pressed={theme.choice === 'system'}
					onclick={() => theme.set('system')}
				>
					<span class="swatch" style={swatchStyle(systemId)} aria-hidden="true">
						<span class="rule r1"></span>
						<span class="rule r2"></span>
						<span class="pips">
							<span class="pip a"></span><span class="pip b"></span><span class="pip c"></span>
						</span>
					</span>
					<span class="text">
						<span class="name">System</span>
						<span class="note">Follow the machine — {systemLabel} right now.</span>
					</span>
					{#if theme.choice === 'system'}
						<HugeiconsIcon icon={ICON.check} size={13} />
					{/if}
				</button>

				{#each THEMES as t (t.id)}
					<button
						class="row"
						class:sel={theme.choice === t.id}
						aria-pressed={theme.choice === t.id}
						onclick={() => theme.set(t.id)}
					>
						<span class="swatch" style={swatchStyle(t.id)} aria-hidden="true">
							<span class="rule r1"></span>
							<span class="rule r2"></span>
							<span class="pips">
								<span class="pip a"></span><span class="pip b"></span><span class="pip c"></span>
							</span>
						</span>
						<span class="text">
							<span class="name">{t.label}</span>
							<span class="note">{t.note}</span>
						</span>
						{#if theme.choice === t.id}
							<HugeiconsIcon icon={ICON.check} size={13} />
						{/if}
					</button>
				{/each}
			</div>
		</section>

		<section class="sec">
			<h3 class="co-eyebrow">model</h3>
			<p class="lede">
				What the next run thinks with. The key never leaves the server — your browser talks to this
				origin and this origin talks to the provider, which is also why Colophon works from networks
				that filter one.
			</p>

			<div class="rows">
				{#each models as m (m.id)}
					<button
						class="row"
						class:sel={m.id === model}
						aria-pressed={m.id === model}
						onclick={() => onmodel?.(m.id)}
					>
						<span class="text">
							<span class="name co-num">{m.id}</span>
							<span class="note">{m.note}</span>
						</span>
						{#if m.id === model}
							<HugeiconsIcon icon={ICON.check} size={13} />
						{/if}
					</button>
				{/each}
			</div>
		</section>

		<section class="sec">
			<h3 class="co-eyebrow">x-ray</h3>
			<p class="lede">
				Which instruments the flank carries. Turning one off hides a reading; it does not change
				what the run does, because nothing here is wired into the agent in the first place.
			</p>

			<div class="rows">
				{#each PANELS as p (p.id)}
					<button
						class="row"
						role="switch"
						aria-checked={shown(p.id)}
						onclick={() => onpanel?.(p.id, !shown(p.id))}
					>
						<span class="text">
							<span class="name">{p.label}</span>
							<span class="note">{p.note}</span>
						</span>
						<span class="track" class:on={shown(p.id)} aria-hidden="true">
							<span class="knob"></span>
						</span>
					</button>
				{/each}
			</div>
		</section>

		<section class="sec">
			<h3 class="co-eyebrow">delivery</h3>
			<p class="lede">
				Whether a finished digest has somewhere to go. Set on the server; shown here so a silent
				morning has an explanation.
			</p>

			<div class="status" class:on={delivery}>
				<HugeiconsIcon icon={ICON.digest} size={14} />
				<span class="text">
					<span class="name">{delivery ? 'Configured' : 'Not configured'}</span>
					<span class="note">
						{#if delivery}
							Digests go to <span class="co-num">{deliveryTo ?? 'the address on file'}</span>.
						{:else}
							No mail key is set, so delivery is never attempted — the digest is written and stays
							in the vault.
						{/if}
					</span>
				</span>
			</div>
		</section>

		<section class="sec danger">
			<h3 class="co-eyebrow">danger</h3>
			<p class="lede">
				Everything Colophon keeps in this browser: the theme, which panels are open, and the id of
				the thread you are in. The thread's contents live in the database — clearing here loses the
				pointer, not the rows.
			</p>

			{#if !confirming}
				<button class="act" onclick={arm}>
					<HugeiconsIcon icon={ICON.trash} size={13} />
					Clear local data
				</button>
			{:else}
				<div class="confirm">
					<p class="warn">
						{doomed}
						{doomed === 1 ? 'key' : 'keys'} will be removed and the page will reload. This cannot be undone.
					</p>
					<div class="pair">
						<button class="act" onclick={() => (confirming = false)}>Cancel</button>
						<button class="act go" onclick={clearLocal}>Clear it</button>
					</div>
				</div>
			{/if}
		</section>
	</div>
</Sheet>

<style>
	.sheet {
		display: flex;
		flex-direction: column;
	}

	/* Sections separate by space, and by one hairline where space alone would
	   let a long note run into the next label. No cards. */
	.sec {
		padding: 1.1rem 0;
	}
	.sec + .sec {
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.sec:first-child {
		padding-top: 0.2rem;
	}

	.lede {
		margin: 0.4rem 0 0.75rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.4rem 0.45rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--foreground);
		text-align: left;
		cursor: pointer;
		transition: background-color 150ms ease;
	}
	.row:hover {
		background: var(--muted);
	}
	.row.sel .name {
		color: var(--co-accent);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		flex: 1;
		min-width: 0;
	}

	.name {
		font-family: var(--font-mono);
		font-size: 0.72rem;
	}

	.note {
		font-size: 0.625rem;
		line-height: 1.4;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		text-wrap: pretty;
	}

	/* ── swatch ───────────────────────────────────────────────────────────
	   A miniature page: the ground, two lines of text, and three of the legend
	   colours. Every value arrives as a custom property sampled off the real
	   stylesheet; the fallbacks are what shows for the frame before that
	   happens, and on any engine where the sampling fails. */
	.swatch {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 0.16rem;
		width: 2.7rem;
		height: 1.85rem;
		padding: 0.3rem 0.3rem 0.26rem;
		border: 1px solid var(--sw-edge, var(--border));
		border-radius: 3px;
		background: var(--sw-bg, var(--muted));
		overflow: hidden;
	}
	.rule {
		height: 2px;
		border-radius: 1px;
		background: var(--sw-fg, var(--muted-foreground));
		opacity: 0.5;
	}
	.r1 {
		width: 82%;
	}
	.r2 {
		width: 54%;
	}
	.pips {
		display: flex;
		gap: 2px;
		margin-top: auto;
	}
	.pip {
		width: 4px;
		height: 4px;
		border-radius: 999px;
	}
	.pip.a {
		background: var(--sw-a, var(--co-accent));
	}
	.pip.b {
		background: var(--sw-b, var(--co-tool));
	}
	.pip.c {
		background: var(--sw-c, var(--co-library));
	}

	/* ── switch ───────────────────────────────────────────────────────────
	   Small enough to belong to a readout rather than to a form. The knob
	   slides; the track only changes tone, so the movement is the signal. */
	.track {
		flex: none;
		position: relative;
		width: 1.55rem;
		height: 0.85rem;
		border-radius: 999px;
		background: color-mix(in oklab, var(--muted-foreground) 28%, transparent);
		transition: background-color 180ms ease;
	}
	.track.on {
		background: color-mix(in oklab, var(--co-accent) 70%, transparent);
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 999px;
		background: var(--background);
		transition: transform 180ms ease;
	}
	.track.on .knob {
		transform: translateX(0.7rem);
	}

	/* ── delivery ─────────────────────────────────────────────────────── */
	.status {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.2rem 0.45rem;
		color: var(--muted-foreground);
	}
	.status.on {
		color: var(--co-accent);
	}
	.status .name {
		color: var(--foreground);
	}
	.status.on .name {
		color: var(--co-accent);
	}

	/* ── danger ───────────────────────────────────────────────────────── */
	.act {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.32rem 0.6rem;
		border: 1px solid color-mix(in oklab, var(--border) 90%, transparent);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		cursor: pointer;
		transition:
			color 150ms ease,
			border-color 150ms ease;
	}
	.act:hover {
		color: var(--foreground);
	}

	/* The only thing in the app allowed to be red, and only once you have said
	   yes to the first step. */
	.act.go {
		color: var(--co-error);
		border-color: color-mix(in oklab, var(--co-error) 45%, transparent);
	}
	.act.go:hover {
		color: var(--co-error);
		border-color: var(--co-error);
	}

	.confirm {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.warn {
		margin: 0;
		font-size: 0.6875rem;
		line-height: 1.5;
		color: var(--co-error);
		text-wrap: pretty;
	}
	.pair {
		display: flex;
		gap: 0.4rem;
	}
</style>
