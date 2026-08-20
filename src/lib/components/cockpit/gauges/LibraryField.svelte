<script lang="ts">
	import { session } from '$lib/agent/session.svelte';

	/**
	 * Every paper this run has met, as a field of dots.
	 *
	 * `LibraryPanel` is the reading version — titles, authors, a promotion that
	 * you see happen. This is the glance version, and it exists because the
	 * reading you actually want mid-run is a *ratio*, not a list: twenty hollow
	 * dots around one ringed one is a run that searched widely and used almost
	 * nothing, and that shape is visible here before you have read a single
	 * title.
	 *
	 *   hollow  listed — a search returned it. A title and an abstract.
	 *   filled  read — the full text came back. Claims about contents are allowed.
	 *   ringed  cited — it is actually referenced in what was written.
	 *
	 * The three states are one glyph with more of it inked, not three badges,
	 * because depth only ever increases: a paper met again in a search has not
	 * become less known.
	 *
	 * Drawn as an SVG on a fixed grid with `preserveAspectRatio`, which is what
	 * makes it fit any box the layout gives it without a scrollbar or a media
	 * query. The grid starts at 8×3 and only grows once the papers outnumber it,
	 * so the dots stay the same size through a normal run — a gauge whose marks
	 * change size every time a search returns is one you have to re-read rather
	 * than glance at.
	 */

	const MIN_COLS = 8;
	const MIN_ROWS = 3;
	/** Grid pitch in viewBox units. Every radius below is relative to this. */
	const CELL = 10;

	const papers = $derived(session.papers);

	/**
	 * Promotion rises, as in `LibraryPanel`.
	 *
	 * Insertion order is the honest default and it makes the field useless in the
	 * common case: twelve results, one of them read and cited, and the one dot
	 * that matters is somewhere in the middle of a scatter. Cited first, then
	 * read, then listed — stable within each band, so within "listed" it is still
	 * the order they were found.
	 */
	const rank = (p: { cited: boolean; depth: string }) => (p.cited ? 0 : p.depth === 'read' ? 1 : 2);
	const ordered = $derived(
		papers
			.map((p, i) => ({ p, i }))
			.sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
			.map(({ p }) => p)
	);

	// Wider than tall: these boxes are always wider than tall, and a square grid
	// in a wide box wastes the width it was given.
	const cols = $derived(Math.max(MIN_COLS, Math.ceil(Math.sqrt(ordered.length * 2.6))));
	const rows = $derived(Math.max(MIN_ROWS, Math.ceil(ordered.length / cols)));

	const dots = $derived(
		ordered.map((p, i) => ({
			p,
			cx: (i % cols) * CELL + CELL / 2,
			cy: Math.floor(i / cols) * CELL + CELL / 2
		}))
	);

	const readCount = $derived(papers.filter((p) => p.depth === 'read').length);
	const citedCount = $derived(papers.filter((p) => p.cited).length);
</script>

<div class="field">
	<svg
		viewBox="0 0 {cols * CELL} {rows * CELL}"
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="{papers.length} papers seen, {readCount} read, {citedCount} cited"
	>
		{#each dots as d (d.p.id)}
			<g class="dot" class:read={d.p.depth === 'read'} class:cited={d.p.cited}>
				<title>{d.p.title} — {d.p.cited ? 'cited' : d.p.depth}</title>
				{#if d.p.cited}
					<circle class="halo" cx={d.cx} cy={d.cy} r="4.4" />
				{/if}
				<circle class="core" cx={d.cx} cy={d.cy} r="2.6" />
			</g>
		{/each}
	</svg>

	{#if papers.length}
		<ul class="key">
			<li><i class="listed"></i>{papers.length} listed</li>
			<li><i class="read"></i>{readCount} read</li>
			<li><i class="cited"></i>{citedCount} cited</li>
		</ul>
	{:else}
		<span class="idle">nothing retrieved yet</span>
	{/if}
</div>

<style>
	.field {
		height: 100%;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		overflow: hidden;
	}

	svg {
		flex: 1;
		min-height: 0;
		width: 100%;
	}

	.core {
		fill: none;
		stroke: color-mix(in oklab, var(--co-library) 50%, transparent);
		stroke-width: 0.9;
		transition:
			fill 250ms ease,
			stroke 250ms ease;
	}
	.dot.read .core {
		fill: var(--co-library);
		stroke: var(--co-library);
	}
	.dot.cited .core {
		fill: var(--co-accent);
		stroke: var(--co-accent);
	}

	/* The ring is the citation: a mark that has to survive `cite` refusing
	   anything that did not arrive over the network. */
	.halo {
		fill: none;
		stroke: color-mix(in oklab, var(--co-accent) 45%, transparent);
		stroke-width: 0.8;
	}

	.key {
		flex: none;
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.05rem 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted-foreground);
		overflow: hidden;
	}
	.key li {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
	}
	.key i {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 999px;
		border: 1px solid color-mix(in oklab, var(--co-library) 50%, transparent);
	}
	.key i.read {
		background: var(--co-library);
		border-color: var(--co-library);
	}
	.key i.cited {
		background: var(--co-accent);
		border-color: var(--co-accent);
		box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--co-accent) 30%, transparent);
	}

	.idle {
		flex: none;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--muted-foreground);
		opacity: 0.55;
	}
</style>
