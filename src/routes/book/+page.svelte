<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import { theme } from '$lib/theme.svelte';
	import { CHAPTERS } from '$lib/book/chapters';

	/**
	 * The book.
	 *
	 * A field guide to what this application actually does, written about this
	 * codebase rather than about agents in general — every tool name, cap and
	 * refusal in it was read from the source. Each chapter ends by naming the
	 * panel where its idea is happening on screen right now, which is the whole
	 * pedagogy: a diagram of what *should* happen teaches much less than a
	 * readout of what did.
	 *
	 * One chapter at a time, with a contents rail beside it. A single scrolling
	 * page would be the easy build and the wrong one — ten chapters of prose
	 * read as a wall, and the rail is what makes it a book rather than a very
	 * long article.
	 */
	let index = $state(0);
	const chapter = $derived(CHAPTERS[index]);

	onMount(() => {
		theme.start();
		// Deep-linkable: `?c=gate` is what you send someone when you want them to
		// read one chapter, and a book you cannot point at is a book nobody cites.
		const wanted = new URLSearchParams(location.search).get('c');
		const found = CHAPTERS.findIndex((c) => c.id === wanted);
		if (found >= 0) index = found;
	});

	function go(next: number) {
		index = Math.min(CHAPTERS.length - 1, Math.max(0, next));
		history.replaceState(null, '', `?c=${CHAPTERS[index].id}`);
		document.querySelector('.reading')?.scrollTo({ top: 0 });
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.target instanceof HTMLInputElement) return;
		if (event.key === 'ArrowRight') go(index + 1);
		if (event.key === 'ArrowLeft') go(index - 1);
	}
</script>

<svelte:head><title>{chapter?.title} · Colophon</title></svelte:head>
<svelte:window {onkeydown} />

<div class="page">
	<header class="bar co-frost">
		<a class="co-wordmark mark" href={resolve('/')}>colo<em>phon</em></a>
		<span class="co-eyebrow crumb">the book</span>
		<div class="spacer"></div>
		<a class="link" href={resolve('/')}>
			<HugeiconsIcon icon={ICON.close} size={14} />
		</a>
	</header>

	<main>
		<nav aria-label="Contents">
			<p class="co-eyebrow railhead">contents</p>
			<ol>
				{#each CHAPTERS as c, i (c.id)}
					<li>
						<button class="entry" class:on={i === index} onclick={() => go(i)}>
							<span class="co-num n">{String(c.number).padStart(2, '0')}</span>
							<span class="t">
								<span class="title">{c.title}</span>
								<span class="blurb">{c.blurb}</span>
							</span>
						</button>
					</li>
				{/each}
			</ol>
		</nav>

		<div class="reading">
			{#if chapter}
				{@const Chapter = chapter.component}
				<article>
					<p class="co-eyebrow number">chapter {String(chapter.number).padStart(2, '0')}</p>
					<h1>{chapter.title}</h1>
					<Chapter />
				</article>

				<footer class="turn">
					{#if index > 0}
						<button class="page-turn" onclick={() => go(index - 1)}>
							<HugeiconsIcon icon={ICON.collapse} size={12} />
							<span>{CHAPTERS[index - 1].title}</span>
						</button>
					{:else}
						<span></span>
					{/if}
					{#if index < CHAPTERS.length - 1}
						<button class="page-turn next" onclick={() => go(index + 1)}>
							<span>{CHAPTERS[index + 1].title}</span>
							<HugeiconsIcon icon={ICON.collapse} size={12} />
						</button>
					{/if}
				</footer>
			{/if}
		</div>
	</main>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background: var(--background);
		color: var(--foreground);
	}

	.bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		height: 2.6rem;
		padding: 0 0.9rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.mark {
		font-size: 0.875rem;
		text-decoration: none;
		color: inherit;
	}
	.crumb {
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}
	.spacer {
		flex: 1;
	}
	.link {
		display: inline-flex;
		color: var(--muted-foreground);
	}
	.link:hover {
		color: var(--foreground);
	}

	main {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 15rem 1fr;
	}
	@media (max-width: 820px) {
		main {
			grid-template-columns: 1fr;
		}
		nav {
			display: none;
		}
	}

	/* The rail: a hairline and space, no panel. */
	nav {
		overflow-y: auto;
		padding: 1.5rem 0.75rem 2rem 1.25rem;
		border-right: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
	}
	.railhead {
		margin: 0 0 0.75rem 0.4rem;
	}
	nav ol {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.entry {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		width: 100%;
		padding: 0.35rem 0.4rem;
		border: 0;
		border-radius: 3px;
		background: transparent;
		text-align: left;
		cursor: pointer;
		color: var(--muted-foreground);
		transition: color 150ms ease;
	}
	.entry:hover {
		color: var(--foreground);
	}
	.entry.on {
		color: var(--foreground);
	}
	/* The current chapter is marked by a rule in the accent, not a filled box —
	   a highlighted rectangle in a rail of ten is the loudest thing on screen. */
	.entry.on .n {
		color: var(--co-accent);
	}
	.n {
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}
	.t {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.title {
		font-size: 0.8125rem;
		line-height: 1.3;
	}
	.blurb {
		font-size: 0.625rem;
		line-height: 1.4;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
		text-wrap: pretty;
	}

	.reading {
		overflow-y: auto;
		padding: 3rem 2rem 5rem;
	}

	article {
		max-width: 34em;
		margin: 0 auto;
	}
	.number {
		margin: 0 0 0.5rem;
		color: color-mix(in oklab, var(--co-accent) 70%, var(--muted-foreground));
	}
	h1 {
		margin: 0 0 1.5rem;
		font-family: var(--font-serif);
		font-size: 2rem;
		line-height: 1.15;
		font-weight: 600;
		letter-spacing: -0.02em;
		text-wrap: balance;
	}

	.turn {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		max-width: 34em;
		margin: 3rem auto 0;
		padding-top: 1.25rem;
		border-top: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
	}
	.page-turn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border: 0;
		background: transparent;
		padding: 0;
		cursor: pointer;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
	}
	.page-turn:hover {
		color: var(--co-accent);
	}
	.page-turn :global(svg) {
		transform: rotate(180deg);
	}
	.page-turn.next :global(svg) {
		transform: none;
	}
</style>
