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
	 * ── The graticule ───────────────────────────────────────────────────────
	 * The empty field used to be an empty `<svg>` and the words `nothing
	 * retrieved yet` — visually a blank box, which is the single worst thing an
	 * instrument can be, because a blank box and a broken box look identical.
	 *
	 * So the grid's *slots* are drawn: a lattice of faint pinpricks, always
	 * present, which papers ink in as they arrive. This is a graticule, not
	 * fabricated data — the same claim a dial's tick marks make. It says "marks
	 * appear here", which is true, and it never says how many are coming.
	 *
	 * ── Filling the box ─────────────────────────────────────────────────────
	 * The grid used to be a fixed 8×3-ish shape scaled with `meet`, so in a cell
	 * twice as wide as that ratio the dots shrank to fit the height and left a
	 * dead margin down both sides. The column count is now derived from the box's
	 * measured aspect, so the lattice is roughly the shape of the space it is
	 * given at any flank width and `meet` has almost nothing left to trim.
	 *
	 * Measuring is safe here — no `$effect` writes what it reads. The wrapper's
	 * size comes from the flex row above it and never from the SVG inside it, so
	 * the aspect cannot chase itself.
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

	let boxW = $state(0);
	let boxH = $state(0);

	/* Clamped hard at both ends: a 1px-tall box during the first layout pass
	   would otherwise ask for a thousand-column lattice. */
	const aspect = $derived(boxW > 0 && boxH > 0 ? Math.min(6, Math.max(0.7, boxW / boxH)) : 2.6);

	const cols = $derived(
		Math.max(MIN_COLS, Math.ceil(Math.sqrt(Math.max(1, ordered.length) * aspect)))
	);
	const rows = $derived(
		Math.max(MIN_ROWS, Math.ceil(ordered.length / cols), Math.round(cols / aspect))
	);

	/** The lattice. Index is the key: positions are fixed, papers are not. */
	const slots = $derived(
		Array.from({ length: cols * rows }, (_, i) => ({
			cx: (i % cols) * CELL + CELL / 2,
			cy: Math.floor(i / cols) * CELL + CELL / 2
		}))
	);

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
	<div class="plot" bind:clientWidth={boxW} bind:clientHeight={boxH}>
		<svg
			viewBox="0 0 {cols * CELL} {rows * CELL}"
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label="{papers.length} papers seen, {readCount} read, {citedCount} cited"
		>
			{#each slots as s, i (i)}
				<circle class="slot" cx={s.cx} cy={s.cy} r="0.9" />
			{/each}
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
	</div>

	<ul class="key">
		<li><i class="listed"></i><span class="co-num">{papers.length}</span> listed</li>
		<li><i class="read"></i><span class="co-num">{readCount}</span> read</li>
		<li><i class="cited"></i><span class="co-num">{citedCount}</span> cited</li>
	</ul>
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

	.plot {
		flex: 1;
		min-height: 0;
		min-width: 0;
	}
	svg {
		height: 100%;
		width: 100%;
	}

	/* The lattice. Faint enough that a field of them is a texture rather than a
	   reading, present enough that the instrument is never a blank rectangle. */
	.slot {
		fill: color-mix(in oklab, var(--foreground) 13%, transparent);
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
		gap: 0.05rem 0.7rem;
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
	.key .co-num {
		color: color-mix(in oklab, var(--foreground) 75%, transparent);
	}
</style>
