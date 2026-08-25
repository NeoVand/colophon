<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ColophonEvent } from '$lib/agent/events';

	/**
	 * The visual half of an event.
	 *
	 * Some results are better *seen* than read. `extract_figures` returning
	 * `{ count: 3 }` is a true summary and a useless one — the whole point of
	 * that tool is that an extracted figure is **evidence**, the thing the
	 * authors chose to show, and a row that only counts them makes it
	 * indistinguishable from any other tool that returned three of something.
	 * `generate_image` is worse: a run's most expensive single call, summarised
	 * as a filename.
	 *
	 * Ported from harnessXray, where the argument is put well: the record of a
	 * run should include what it produced, not only what it cost. This is the
	 * one place in the app where the two are on the same line.
	 *
	 * Deliberately not a lightbox. A click opens the figure's own route in a new
	 * tab — the timeline is for scanning, and a viewer that takes over the pane
	 * is the arrangement the event detail was just moved *out* of.
	 */

	let { event }: { event: ColophonEvent } = $props();

	interface Shot {
		/**
		 * The `[...path]` parameter, not a finished URL.
		 *
		 * `resolve()` is called at the markup site rather than here so the link is
		 * demonstrably a resolved route to anything reading the file — including
		 * `svelte/no-navigation-without-resolve`, which cannot follow a string
		 * through a helper and is right not to try.
		 */
		path: string;
		caption: string;
	}

	function text(value: unknown): string | undefined {
		return typeof value === 'string' && value ? value : undefined;
	}

	/**
	 * The tool's published path, reduced to the route parameter.
	 *
	 * Both tools return `/figures/<name>` — the literal string the agent pastes
	 * into a document — and the rest is the route's `[...path]` parameter.
	 * Anything not matching that shape gets no tile rather than a guessed one:
	 * a thumbnail that 404s is worse than no thumbnail, because it reads as the
	 * figure having failed rather than as this component not recognising it.
	 */
	function paramOf(path: unknown): string | undefined {
		return text(path)?.match(/^\/figures\/(.+)$/)?.[1];
	}

	const shots = $derived.by<Shot[]>(() => {
		if (event.k !== 'tool-result' || event.failed) return [];
		const result = (event.result ?? {}) as Record<string, unknown>;

		// One image, and the brief is already on the row above it.
		const single = paramOf(result.path);
		if (single) return [{ path: single, caption: text(result.size) ?? '' }];

		// A paper's own figures, under the paper's own captions.
		if (Array.isArray(result.figures)) {
			return (result.figures as Record<string, unknown>[])
				.map((f) => ({ path: paramOf(f?.path), caption: text(f?.caption) ?? '' }))
				.filter((s): s is Shot => Boolean(s.path));
		}

		return [];
	});
</script>

{#if shots.length}
	<div class="media">
		{#each shots as shot (shot.path)}
			{@const href = resolve('/figures/[...path]', { path: shot.path })}
			<a {href} target="_blank" rel="noreferrer noopener" title={shot.caption || 'figure'}>
				<!-- `loading="lazy"`: a long research run can extract a dozen figures,
				     and a timeline that fetches every one of them on render spends the
				     reader's bandwidth on rows they have scrolled past. -->
				<img src={href} alt={shot.caption || 'figure'} loading="lazy" decoding="async" />
			</a>
		{/each}
	</div>
{/if}

<style>
	/*
		Full row width and evenly padded, not hung in the icon gutter. A figure
		indented under a hanging label reads as shoved into a corner, and these
		are the one thing in the panel worth looking at properly.
	*/
	.media {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0.2rem 0 0.4rem 0.35rem;
		padding-left: 0.55rem;
		border-left: 1px solid color-mix(in oklab, var(--co-library) 30%, transparent);
	}

	a {
		display: block;
		min-width: 0;
		border-radius: 2px;
		overflow: hidden;
		line-height: 0;
	}

	/*
		Capped by height, not width. Figures arrive in wildly different aspect
		ratios — a wide plot beside a tall schematic — and constraining the width
		makes the tall one three rows deep. A common height gives the strip one
		baseline and lets each figure keep its own shape.
	*/
	img {
		height: 4.5rem;
		width: auto;
		max-width: 100%;
		object-fit: contain;
		border: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
		border-radius: 2px;
		background: var(--muted);
		transition: border-color 150ms ease;
	}
	a:hover img,
	a:focus-visible img {
		border-color: color-mix(in oklab, var(--co-library) 60%, transparent);
	}
</style>
