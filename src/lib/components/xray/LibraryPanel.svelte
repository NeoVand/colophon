<script lang="ts">
	import { session } from '$lib/agent/session.svelte';
	import { flip } from 'svelte/animate';

	/**
	 * Every paper this run has met, and how well it knows each one.
	 *
	 * This is the panel that makes Colophon's central claim inspectable. A
	 * citation here cannot be invented — the `cite` tool refuses anything that
	 * did not arrive over the network — and the three states below are exactly
	 * the distinctions that guarantee makes:
	 *
	 *   listed  a search returned it. You have seen a title and an abstract.
	 *   read    the full text was fetched. Claims about contents are allowed.
	 *   cited   it is actually referenced in what was written.
	 *
	 * The gap between them is the interesting reading. A run with twenty listed
	 * and one read was properly selective; a run with twenty read and one cited
	 * spent a great deal of money to say very little. Neither is visible from
	 * the conversation, and both are visible here at a glance.
	 *
	 * Nothing is passed in to make this work: it is folded out of the tool
	 * results the run already publishes. If the agent stopped cooperating, this
	 * panel would carry on.
	 */

	const papers = $derived(session.papers);
	const readCount = $derived(papers.filter((p) => p.depth === 'read').length);
	const citedCount = $derived(papers.filter((p) => p.cited).length);

	/**
	 * Promotion rises.
	 *
	 * Insertion order is the honest default and it made the panel useless in the
	 * one case that matters: a search returns twelve papers, one of them is read
	 * and cited, and the header says "1 cited" while the four rows you can see
	 * are all things the run glanced at and discarded. The question this panel
	 * answers is "what did it actually use", so what it used goes to the top.
	 *
	 * Stable within each band, so within "listed" the order is still the order
	 * they were found — and `animate:flip` below means a promotion is something
	 * you *see happen* rather than a list that has quietly rearranged itself.
	 */
	const rank = (p: { cited: boolean; depth: string }) => (p.cited ? 0 : p.depth === 'read' ? 1 : 2);
	const ordered = $derived(
		papers
			.map((p, i) => ({ p, i }))
			.sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
			.map(({ p }) => p)
	);
</script>

<section class="panel">
	<header>
		<span class="co-eyebrow">library</span>
		{#if papers.length}
			<span class="co-num tally">
				<span class="k listed">{papers.length}</span> seen ·
				<span class="k read">{readCount}</span> read ·
				<span class="k cited">{citedCount}</span> cited
			</span>
		{/if}
	</header>

	{#if !papers.length}
		<p class="quiet">Nothing retrieved yet. A search puts papers here.</p>
	{:else}
		<ul>
			{#each ordered as paper (paper.id)}
				<li
					class="row"
					class:read={paper.depth === 'read'}
					class:cited={paper.cited}
					animate:flip={{ duration: 320 }}
				>
					<!--
						The depth mark, as three states of one glyph rather than three
						different badges. Depth only ever increases — a paper met again in
						a search has not become less known — so a mark that fills in is a
						truer picture than a label that swaps.
					-->
					<span class="mark" aria-hidden="true"></span>
					<div class="body">
						<p class="title">
							{#if paper.url}
								<a href={paper.url} target="_blank" rel="noreferrer noopener">{paper.title}</a>
							{:else}{paper.title}{/if}
						</p>
						<p class="meta co-num">
							{#if paper.authors?.length}{paper.authors[0].split(' ').pop()}{paper.authors.length >
								1
									? ' et al.'
									: ''}{/if}{#if paper.year}
								· {paper.year}{/if}{#if paper.chars}
								· {Math.round(paper.chars / 1000)}k chars{/if}
						</p>
					</div>
					<span class="co-eyebrow state">
						{paper.cited ? 'cited' : paper.depth}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		gap: 0.5rem;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		flex: none;
	}
	header .co-eyebrow {
		color: color-mix(in oklab, var(--co-library) 70%, var(--muted-foreground));
	}

	.tally {
		margin-left: auto;
		font-size: 0.625rem;
		color: var(--muted-foreground);
	}
	.k.listed {
		color: color-mix(in oklab, var(--co-library) 55%, var(--muted-foreground));
	}
	.k.read {
		color: var(--co-library);
	}
	.k.cited {
		color: var(--co-accent);
	}

	.quiet {
		margin: 0;
		font-size: 0.75rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		min-height: 0;
	}

	.row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
	}
	.row:last-child {
		border-bottom: 0;
	}

	/* Hollow ring → filled → ringed-and-filled. The shape is constant; only how
	   much of it is inked changes, so the three states read as one scale. */
	.mark {
		flex: none;
		width: 7px;
		height: 7px;
		margin-top: 0.32rem;
		border-radius: 999px;
		border: 1px solid color-mix(in oklab, var(--co-library) 50%, transparent);
		background: transparent;
		transition:
			background-color 250ms ease,
			box-shadow 250ms ease;
	}
	.row.read .mark {
		background: var(--co-library);
		border-color: var(--co-library);
	}
	.row.cited .mark {
		background: var(--co-accent);
		border-color: var(--co-accent);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--co-accent) 22%, transparent);
	}

	.body {
		flex: 1;
		min-width: 0;
	}

	.title {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.35;
		color: color-mix(in oklab, var(--foreground) 78%, transparent);
		text-wrap: pretty;
	}
	.row.read .title,
	.row.cited .title {
		color: var(--foreground);
	}
	.title a {
		color: inherit;
		text-decoration: none;
	}
	.title a:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.meta {
		margin: 0.1rem 0 0;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}

	.state {
		flex: none;
		font-size: 0.5rem;
		padding-top: 0.2rem;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
	}
	.row.cited .state {
		color: var(--co-accent);
	}
</style>
