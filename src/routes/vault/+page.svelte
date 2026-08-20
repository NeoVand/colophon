<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { theme } from '$lib/theme.svelte';
	import Prose from '$lib/components/Prose.svelte';
	import type { PageData } from './$types';

	/**
	 * Everything the sweep has done, made readable.
	 *
	 * Two columns and no tabs: what is being followed on the left, what was
	 * written on the right. A tab would hide one behind the other, and the whole
	 * value of the pairing is seeing that a subscription has produced four
	 * withheld digests in a row — which is either a quiet field or a query that
	 * needs rewriting, and you cannot tell from either column alone.
	 *
	 * A withheld digest is shown exactly as prominently as a sent one. The gate
	 * staying quiet is the product working, and hiding its output would make it
	 * impossible to judge whether it is too strict.
	 */
	let { data }: { data: PageData } = $props();

	let open = $state<string | null>(null);
	let adding = $state(false);

	onMount(() => theme.start());

	const byId = $derived(new Map(data.subscriptions.map((s) => [s.id, s])));

	function when(at: string | Date | null): string {
		if (!at) return 'never';
		const d = typeof at === 'string' ? new Date(at) : at;
		const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
		if (days === 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 30) return `${days} days ago`;
		return d.toISOString().slice(0, 10);
	}

	/** What the pair of delivery columns actually means, in words. */
	function delivery(d: PageData['digests'][number]): string {
		if (d.verdict !== 'passed') return '';
		if (d.deliveredAt) return `emailed ${when(d.deliveredAt)}`;
		if (d.deliveryError) return 'not delivered';
		return 'not sent';
	}

	/**
	 * The line under a digest, assembled here rather than in the template.
	 *
	 * Interpolating three optional fragments around `{#if}` blocks in markup
	 * means the separators' spaces sit at the start of a line, and Svelte trims
	 * those — which shipped as "…autoencoders ·1 cited· not sent". Joining an
	 * array cannot lose a space and cannot leave a dangling separator when a
	 * fragment is absent, which is the same bug in its other form.
	 */
	/**
	 * The body, minus the heading the row above is already showing.
	 *
	 * A digest's markdown opens with an H1 that *is* its title — `titleOf()`
	 * takes the title from exactly that line — so rendering the body whole under
	 * a row that shows the title prints the headline twice, twenty words apart.
	 *
	 * Stripped here rather than at storage time, deliberately. The stored digest
	 * has to stay a complete document: in an email there is no row above it and
	 * the H1 is the headline. This is a fact about *this view*, so it is fixed in
	 * this view.
	 */
	function bodyOf(d: PageData['digests'][number]): string {
		const first = d.body.match(/^\s*#\s+(.+?)\s*$/m);
		if (!first) return d.body;
		const same = first[1].trim() === d.title.trim();
		return same ? d.body.replace(first[0], '').trimStart() : d.body;
	}

	function subline(d: PageData['digests'][number]): string {
		const sub = d.subscriptionId ? byId.get(d.subscriptionId) : undefined;
		return [sub?.query, `${d.sources.length} cited`, delivery(d)].filter(Boolean).join(' · ');
	}
</script>

<svelte:head><title>Vault · Colophon</title></svelte:head>

<div class="page">
	<header class="bar co-frost">
		<a class="co-wordmark mark" href={resolve('/')}>colo<em>phon</em></a>
		<span class="co-eyebrow crumb">vault</span>
		<div class="spacer"></div>
		{#if data.configured && !data.mail}
			<span
				class="co-eyebrow warn"
				title="RESEND_API_KEY is not set, so digests are stored but never emailed."
				>delivery off</span
			>
		{/if}
		<a class="link" href={resolve('/')}>back</a>
	</header>

	{#if !data.configured}
		<p class="empty">No database configured, so there is nothing to keep.</p>
	{:else}
		<main>
			<!-- ── what is being followed ──────────────────────────────────── -->
			<section class="following">
				<header class="head">
					<span class="co-eyebrow">following</span>
					<button class="link" onclick={() => (adding = !adding)}
						>{adding ? 'cancel' : 'follow a topic'}</button
					>
				</header>

				{#if adding}
					<form
						method="POST"
						action="?/follow"
						use:enhance={() =>
							async ({ update }) => {
								await update();
								adding = false;
							}}
						class="new"
					>
						<label>
							<span class="co-eyebrow">search for</span>
							<input
								name="query"
								required
								placeholder="mechanistic interpretability"
								class="co-field"
							/>
						</label>
						<label>
							<span class="co-eyebrow">why you follow it</span>
							<!--
								The most important field and the least obvious. It goes into the
								sweep's prompt verbatim, and it is what lets a digest decide a
								paper is not worth mentioning. "Following diffusion models" and
								"following diffusion models because I want to know when sampling
								gets cheap enough for real-time video" produce very different
								digests, and only the second can leave something out.
							-->
							<textarea
								name="notes"
								rows="3"
								class="co-field"
								placeholder="I want to know when SAE features become reliable enough to build on."
							></textarea>
						</label>
						<label class="days">
							<span class="co-eyebrow">sweep every</span>
							<input name="everyDays" type="number" min="1" max="30" value="1" class="co-field" />
							<span class="unit">days</span>
						</label>
						<button type="submit" class="go">follow</button>
					</form>
				{/if}

				{#if !data.subscriptions.length}
					<p class="quiet">Nothing followed yet. A subscription is swept once a day.</p>
				{:else}
					<ul class="subs">
						{#each data.subscriptions as sub (sub.id)}
							<li class="sub" class:paused={!sub.active}>
								<p class="q">{sub.query}</p>
								{#if sub.notes}<p class="notes">{sub.notes}</p>{/if}
								<p class="co-num meta">
									every {sub.everyDays}
									{sub.everyDays === 1 ? 'day' : 'days'} · swept {when(sub.lastSweptAt)}
								</p>
								<div class="acts">
									<form method="POST" action="?/toggle" use:enhance>
										<input type="hidden" name="id" value={sub.id} />
										<input type="hidden" name="active" value={String(!sub.active)} />
										<button class="link">{sub.active ? 'pause' : 'resume'}</button>
									</form>
									<form method="POST" action="?/unfollow" use:enhance>
										<input type="hidden" name="id" value={sub.id} />
										<button class="link danger">unfollow</button>
									</form>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── what came of it ─────────────────────────────────────────── -->
			<section class="digests">
				<header class="head">
					<span class="co-eyebrow">digests</span>
					<span class="co-num count">{data.digests.length}</span>
				</header>

				{#if !data.digests.length}
					<p class="quiet">
						Nothing written yet. The daily sweep puts digests here — including the ones the delivery
						gate decided were not worth sending, which are kept on purpose.
					</p>
				{:else}
					<ul class="list">
						{#each data.digests as d (d.id)}
							<li
								class="digest"
								class:withheld={d.verdict === 'withheld'}
								class:failed={d.verdict === 'failed'}
							>
								<button class="row" onclick={() => (open = open === d.id ? null : d.id)}>
									<span class="verdict co-eyebrow">{d.verdict}</span>
									<span class="title">{d.title}</span>
									<span class="co-num stamp">{when(d.createdAt)}</span>
								</button>

								<p class="co-num sub-line">{subline(d)}</p>

								{#if d.reason && d.verdict !== 'passed'}
									<p class="reason">{d.reason}</p>
								{/if}
								{#if d.deliveryError}
									<p class="reason error">{d.deliveryError}</p>
								{/if}

								{#if open === d.id}
									<div class="body"><Prose text={bodyOf(d)} /></div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</main>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background: var(--background);
		color: var(--foreground);
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		height: 2.6rem;
		padding: 0 1rem;
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
	.warn {
		color: var(--co-approval);
	}

	main {
		flex: 1;
		display: grid;
		grid-template-columns: 20rem 1fr;
		gap: 2.5rem;
		max-width: 72rem;
		width: 100%;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}
	@media (max-width: 880px) {
		main {
			grid-template-columns: 1fr;
			gap: 2rem;
		}
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding-bottom: 0.5rem;
		margin-bottom: 0.75rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.head .co-eyebrow {
		color: var(--muted-foreground);
	}
	.count {
		margin-left: auto;
		font-size: 0.625rem;
		color: var(--muted-foreground);
	}

	.link {
		border: 0;
		background: transparent;
		padding: 0;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		text-decoration: none;
		cursor: pointer;
	}
	.link:hover {
		color: var(--foreground);
	}
	.link.danger:hover {
		color: var(--co-error);
	}
	.head .link {
		margin-left: auto;
	}

	.quiet,
	.empty {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.6;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		text-wrap: pretty;
	}
	.empty {
		padding: 3rem 1.5rem;
	}

	/* ── the form ─────────────────────────────────────────────────────── */
	.new {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
		padding-bottom: 1.25rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
	}
	.new label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.new .days {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}
	.new .days input {
		width: 4rem;
	}
	.unit {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--muted-foreground);
	}
	.co-field {
		border: 1px solid var(--border);
		border-radius: 3px;
		background: transparent;
		padding: 0.35rem 0.5rem;
		color: var(--foreground);
		font-family: var(--font-sans);
		font-size: 0.8125rem;
	}
	.go {
		align-self: flex-start;
		padding: 0.3rem 0.8rem;
		border: 1px solid color-mix(in oklab, var(--co-accent) 50%, transparent);
		border-radius: 3px;
		background: transparent;
		color: var(--co-accent);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		cursor: pointer;
	}
	.go:hover {
		background: color-mix(in oklab, var(--co-accent) 12%, transparent);
	}

	/* ── subscriptions ────────────────────────────────────────────────── */
	.subs {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.sub {
		padding-left: 0.7rem;
		border-left: 2px solid color-mix(in oklab, var(--co-library) 45%, transparent);
	}
	/* Paused says so by going grey and losing its mark, rather than by a badge. */
	.sub.paused {
		border-left-color: color-mix(in oklab, var(--border) 100%, transparent);
		opacity: 0.55;
	}
	.q {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 500;
	}
	.notes {
		margin: 0.2rem 0 0;
		font-family: var(--font-serif);
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	.meta {
		margin: 0.3rem 0 0;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
	.acts {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.35rem;
	}

	/* ── digests ──────────────────────────────────────────────────────── */
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
	}
	.digest {
		padding: 0.9rem 0;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
	}

	.row {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		width: 100%;
		border: 0;
		background: transparent;
		padding: 0;
		text-align: left;
		cursor: pointer;
		color: inherit;
	}

	/*
		The verdict, in its own colour.

		`withheld` is violet, not red. The gate staying quiet on a thin week is
		the single most valuable thing this system does, and colouring it as a
		failure would teach exactly the wrong lesson about what a quiet morning
		means.
	*/
	.verdict {
		flex: none;
		width: 4.5rem;
		color: var(--co-library);
	}
	.digest.withheld .verdict {
		color: var(--co-gate);
	}
	.digest.failed .verdict {
		color: var(--co-error);
	}

	.title {
		flex: 1;
		font-family: var(--font-serif);
		font-size: 0.95rem;
		line-height: 1.4;
		text-wrap: pretty;
	}
	.digest.withheld .title {
		color: var(--muted-foreground);
	}
	.row:hover .title {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.stamp {
		flex: none;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
	}

	.sub-line {
		margin: 0.25rem 0 0 5.25rem;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	.reason {
		margin: 0.35rem 0 0 5.25rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--co-gate);
		text-wrap: pretty;
	}
	.reason.error {
		color: var(--co-error);
	}

	.body {
		margin: 1rem 0 0.5rem 5.25rem;
	}
	@media (max-width: 880px) {
		.sub-line,
		.reason,
		.body {
			margin-left: 0;
		}
	}
</style>
