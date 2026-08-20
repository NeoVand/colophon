<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/agent/session.svelte';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	/**
	 * What this run drew.
	 *
	 * The flank version of the gallery, and a different question from it. The
	 * gallery is an archive — everything Colophon has ever made, in a store that
	 * outlives every thread. This panel is the *run*: only the figures belonging
	 * to the conversation beside it, in the order they were asked for, including
	 * the one still waiting on you.
	 *
	 * Folded out of the tool results the run already publishes, like every other
	 * panel here. Nothing is passed into the agent to make it work, and if the
	 * agent's tools changed tomorrow this would simply go quiet rather than lie.
	 *
	 * ── Why the pending calls are shown, not just the finished ones ─────────────
	 * `generate_image` is the only tool in Colophon that spends rather than
	 * reads, so it is the only one that pauses for a human first. A panel that
	 * showed just the results would be blank at the exact moment it has something
	 * worth saying — that a call is sitting there with your name on it. The
	 * waiting slot is therefore a tile like any other; it fills in with the
	 * picture when the picture arrives.
	 */

	type State = 'waiting' | 'drawing' | 'done' | 'failed';

	interface Shot {
		/**
		 * Turn index prefixed onto the tool-call id.
		 *
		 * A tool-call id is unique inside its turn, and that is all it promises.
		 * Keys in a keyed `{#each}` must be unique across the whole list, and a
		 * duplicate does not merely misdraw — it throws, and the throw aborts the
		 * render, leaving the previous DOM frozen on screen. The prefix makes a
		 * collision impossible by construction.
		 */
		id: string;
		/** The file name asked for, which is the only human-readable handle. */
		slug: string;
		/** The brief, verbatim, for the hover title. This is what was approved. */
		brief: string;
		/** Where the bytes are served from, once there are any. */
		href?: string;
		bytes?: number;
		/** Pixel dimensions. The tool calls this `size`; the blob store does not. */
		dims?: string;
		/**
		 * Why it failed, when it did.
		 *
		 * Worth carrying rather than collapsing to the word "failed". The two
		 * failures this tool actually has are "the account is not verified for
		 * gpt-image-2" and "blob storage is full" — both of which are things the
		 * reader can go and fix, and neither of which is guessable from a red
		 * tile.
		 */
		note?: string;
		state: State;
	}

	function text(value: unknown): string | undefined {
		return typeof value === 'string' && value ? value : undefined;
	}

	/**
	 * The tool's published path, turned back into a route.
	 *
	 * `generate_image` returns `/figures/<slug>.png` — the literal string the
	 * agent pastes into a document — and the rest of that path is the route's
	 * `[...path]` parameter. Anything that does not match that shape gets no
	 * link at all rather than a guessed one; a tile that navigates somewhere
	 * wrong is worse than a tile that does not navigate.
	 */
	function hrefOf(path: string | undefined): string | undefined {
		const match = path?.match(/^\/figures\/(.+)$/);
		return match ? resolve('/figures/[...path]', { path: match[1] }) : undefined;
	}

	const shots = $derived.by(() => {
		const out: Shot[] = [];

		session.turns.forEach((turn, t) => {
			// A plain array, not a Set: it holds at most a handful of ids and it is
			// rebuilt on every read of this derived, so there is nothing to keep.
			const seen: string[] = [];

			for (const tool of turn.tools) {
				if (tool.name !== 'generate_image') continue;
				seen.push(tool.id);

				const args = (tool.args ?? {}) as Record<string, unknown>;
				const result = (tool.result ?? {}) as Record<string, unknown>;
				// The approval carries the same tool-call id, which is what lets a
				// paused call be told apart from one that is simply slow. gpt-image-2
				// takes the better part of a minute, so "waiting on you" and "drawing"
				// look identical from the outside and mean opposite things.
				const held = turn.approval?.name === 'generate_image' && turn.approval.id === tool.id;

				out.push({
					id: `${t}:${tool.id}`,
					slug: text(args.slug) ?? 'figure',
					brief: text(args.prompt) ?? '',
					href: hrefOf(text(result.path)),
					bytes: typeof result.bytes === 'number' ? result.bytes : undefined,
					dims: text(result.size),
					// A failed call's `result` is the error itself, not an object —
					// `tool-error` puts the message where the result would have been.
					note: tool.failed ? text(tool.result) : undefined,
					state: tool.failed ? 'failed' : tool.done ? 'done' : held ? 'waiting' : 'drawing'
				});
			}

			// An approval can land before the call it belongs to has been announced
			// as a tool-call, in which case there is no ToolRun to hang it on yet.
			// Without this the panel is empty for the whole time the decision is
			// open — the one stretch where it has something to say.
			const pending = turn.approval;
			if (pending && pending.name === 'generate_image' && !seen.includes(pending.id)) {
				const args = (pending.args ?? {}) as Record<string, unknown>;
				out.push({
					id: `${t}:${pending.id}`,
					slug: text(args.slug) ?? 'figure',
					brief: text(args.prompt) ?? '',
					state: 'waiting'
				});
			}
		});

		return out;
	});

	const drawn = $derived(shots.filter((s) => s.state === 'done').length);
	const waiting = $derived(shots.filter((s) => s.state === 'waiting').length);

	const readout = $derived(
		[drawn && `${drawn} drawn`, waiting && `${waiting} waiting`].filter(Boolean).join(' · ')
	);

	function kb(n: number | undefined): string {
		if (!n || !Number.isFinite(n)) return '';
		if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
		return `${(n / 1024 / 1024).toFixed(1)} MB`;
	}

	/** The line under a tile: whichever facts exist, never a dangling separator. */
	function under(shot: Shot): string {
		if (shot.state === 'waiting') return 'waiting on you';
		if (shot.state === 'drawing') return 'drawing…';
		if (shot.state === 'failed') return 'failed';
		return [kb(shot.bytes), shot.dims].filter(Boolean).join(' · ');
	}

	/** Hosted in another frame's tab group; that frame draws the header. */
	let { bare = false }: { bare?: boolean } = $props();
</script>

<PanelFrame {bare} label="figures" icon={ICON.figure} tone="user" {readout}>
	{#if !shots.length}
		<EmptyState
			icon={ICON.figure}
			tone="user"
			title="Nothing drawn yet"
			note="The one tool that spends rather than reads, so it stops and asks first."
		/>
	{:else}
		<div class="scroll">
			<ul class="grid">
				{#each shots as shot (shot.id)}
					<li>
						<!--
							A finished figure is a link to its own file; an unfinished one is
							not a link at all. A dead anchor that looks like a live one is
							worse than a plain tile — it is a promise the panel cannot keep
							until the bytes exist.
						-->
						<svelte:element
							this={shot.href ? 'a' : 'div'}
							class="tile"
							class:pending={shot.state !== 'done'}
							href={shot.href}
							target={shot.href ? '_blank' : undefined}
							rel={shot.href ? 'noreferrer noopener' : undefined}
							title={shot.note || shot.brief || shot.slug}
						>
							<span
								class="frame"
								class:held={shot.state === 'waiting'}
								class:broke={shot.state === 'failed'}
							>
								{#if shot.href}
									<img src={shot.href} alt={shot.slug} loading="lazy" decoding="async" />
								{:else}
									<span class="mark" aria-hidden="true"></span>
								{/if}
							</span>
							<span class="slug co-num">{shot.slug}</span>
							<span
								class="meta co-num"
								class:held={shot.state === 'waiting'}
								class:broke={shot.state === 'failed'}>{under(shot)}</span
							>
						</svelte:element>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</PanelFrame>

<style>
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.6rem 0.7rem 0.8rem;
	}

	.grid {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		/* Small on purpose. This is a flank panel a third the width of the chat,
		   and the question it answers — "did the figure land" — is answerable from
		   a postage stamp. The full-size look lives one click away. */
		grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
		gap: 0.55rem 0.5rem;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		text-decoration: none;
		color: inherit;
	}

	.frame {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 3 / 2;
		overflow: hidden;
		border-radius: 2px;
		background: color-mix(in oklab, var(--muted) 55%, transparent);
	}
	.frame img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition: opacity 200ms ease;
	}
	.tile:hover .frame img {
		opacity: 0.85;
	}

	/* A held slot is amber, because a run waiting on a person is a state of the
	   run and not a slower version of working. It matches the approval card in
	   the conversation, which is the thing you have to go and act on. */
	.frame.held {
		background: color-mix(in oklab, var(--co-approval) 12%, transparent);
	}
	.frame.broke {
		background: color-mix(in oklab, var(--co-error) 10%, transparent);
	}

	/* The placeholder, before there is a picture. A dot rather than a spinner:
	   generation takes the better part of a minute and a spinner for a minute
	   reads as a hang. */
	.mark {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
	}
	.frame.held .mark {
		background: var(--co-approval);
	}
	.frame.broke .mark {
		background: var(--co-error);
	}

	.slug {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--foreground) 75%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color 150ms ease;
	}
	.tile:hover .slug {
		color: var(--co-accent);
	}
	.tile.pending .slug {
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
	}

	.meta {
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta.held {
		color: var(--co-approval);
	}
	/* The message itself is on the tile's `title`, because a flank panel is
	   five characters wide and "Blob storage is full (64 MB of 64 MB)" is not. */
	.meta.broke {
		color: var(--co-error);
	}
</style>
