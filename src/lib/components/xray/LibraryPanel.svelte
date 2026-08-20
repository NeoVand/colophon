<script lang="ts">
	import { session, type KnownPaper } from '$lib/agent/session.svelte';
	import { safeHref } from '$lib/markdown';
	import { flip } from 'svelte/animate';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Toolbar from '$lib/components/ui/Toolbar.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';

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

	/**
	 * …but the order found is still a reading worth having.
	 *
	 * Promotion answers "what did the run use"; insertion order answers "what did
	 * that search actually return, and in what rank" — which is the question when
	 * you suspect the run picked the wrong paper off the top of a list. One
	 * toggle, because these are two readings of one set and not two panels.
	 */
	let byPromotion = $state(true);

	const ordered = $derived(
		byPromotion
			? papers
					.map((p, i) => ({ p, i }))
					.sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
					.map(({ p }) => p)
			: papers
	);

	const cited = $derived(papers.filter((p) => p.cited));

	/**
	 * What a references list should contain: cited if anything was cited,
	 * otherwise everything read.
	 *
	 * A run that read nine papers to cite two should not paste nine. When nothing
	 * is cited yet the read set is the honest fallback — it is at least the set
	 * someone actually opened — and when neither exists the button is dead rather
	 * than handing over an empty clipboard, which looks like a broken copy.
	 */
	const consulted = $derived(cited.length ? cited : papers.filter((p) => p.depth === 'read'));

	/** Author-year-title-url, one per line. Not BibTeX: this is for a message. */
	function reference(p: KnownPaper): string {
		const who = p.authors?.length
			? `${p.authors[0]}${p.authors.length > 1 ? ' et al.' : ''}`
			: 'Unknown';
		return [`${who}${p.year ? ` (${p.year})` : ''}.`, `${p.title}.`, p.url ?? p.id]
			.join(' ')
			.trim();
	}

	let copied = $state(false);
	let flash: ReturnType<typeof setTimeout> | undefined;

	async function copyBibliography(): Promise<void> {
		await navigator.clipboard.writeText(consulted.map(reference).join('\n'));
		copied = true;
		clearTimeout(flash);
		flash = setTimeout(() => (copied = false), 1200);
	}

	/**
	 * Open every cited paper.
	 *
	 * Browsers allow this only because the click is the user's own, and most will
	 * still permit just the first window unless popups are allowed for the site —
	 * so the count is in the tooltip, and a blocked second tab is the browser's
	 * decision to explain rather than ours to work around.
	 */
	function openCited(): void {
		for (const p of cited) if (p.url) window.open(p.url, '_blank', 'noopener,noreferrer');
	}

	/** Hosted in another frame's tab group; that frame draws the header. */
	let { bare = false }: { bare?: boolean } = $props();
</script>

{#snippet orderTools()}
	<IconButton
		icon={ICON.filter}
		label="order found"
		active={!byPromotion}
		onclick={() => (byPromotion = !byPromotion)}
	/>
{/snippet}

{#snippet takeTools()}
	<IconButton
		icon={copied ? ICON.check : ICON.copy}
		label="copy bibliography"
		disabled={!consulted.length}
		onclick={copyBibliography}
	/>
	<IconButton
		icon={ICON.external}
		label={cited.length === 1 ? 'open the cited paper' : `open ${cited.length} cited papers`}
		disabled={!cited.length}
		onclick={openCited}
	/>
{/snippet}

<PanelFrame
	{bare}
	label="library"
	icon={ICON.library}
	tone="library"
	readout={papers.length
		? `${papers.length} seen · ${readCount} read · ${citedCount} cited`
		: undefined}
>
	{#snippet actions()}
		<Toolbar groups={[orderTools, takeTools]} />
	{/snippet}

	{#if !papers.length}
		<EmptyState icon={ICON.library} tone="library" title="Nothing retrieved yet" />
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
							<!--
								`safeHref`, not `paper.url` directly.

								The lint rule that flagged this wants `resolve()`, which is the
								wrong instrument — these are external arXiv links and never app
								routes — but it was pointing at something real. A paper's `url`
								is *data*: most of them are built by us as
								`https://arxiv.org/abs/…`, and the rest arrive from a search
								result, which is to say from outside. Interpolating an unchecked
								string into an `href` is how a `javascript:` URL becomes a click
								target. `safeHref` admits http, https and mailto and nothing
								else — the same guard the markdown renderer uses, for the same
								reason.
							-->
							{#if safeHref(paper.url ?? '')}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
								<a href={safeHref(paper.url ?? '')} target="_blank" rel="noreferrer noopener"
									>{paper.title}</a
								>
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
</PanelFrame>

<style>
	/* The scroller carries the indent, so rows and their hairlines start at the
	   header's left edge rather than at the frame's. */
	ul {
		margin: 0;
		padding: 0.35rem 0.7rem 0.6rem;
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
