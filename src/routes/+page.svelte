<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import { theme } from '$lib/theme.svelte';
	import Header from '$lib/components/Header.svelte';
	import Conversation from '$lib/components/chat/Conversation.svelte';
	import Composer from '$lib/components/chat/Composer.svelte';
	import EventTimeline from '$lib/components/xray/EventTimeline.svelte';
	import LibraryPanel from '$lib/components/xray/LibraryPanel.svelte';
	import SpendBar from '$lib/components/xray/SpendBar.svelte';

	/**
	 * Two columns: the work, and the dissection.
	 *
	 * The conversation is the product and gets the room. The X-ray is a flank
	 * that can be shut — it is for teaching and for debugging, and someone who
	 * only wants a research companion should not have to look at instrumentation
	 * to use one.
	 *
	 * `onMount` rather than `$effect` for the two startup calls. Both read
	 * `localStorage` and write tracked state; inside an effect that is a write
	 * to something the effect itself depends on, and Svelte 5 answers with
	 * `effect_update_depth_exceeded` — a lesson this codebase has already paid
	 * for once.
	 */
	let xray = $state(false);

	onMount(() => {
		theme.start();
		session.restore();
		xray = localStorage.getItem('colophon:xray') === '1';
	});

	function toggleXray() {
		xray = !xray;
		localStorage.setItem('colophon:xray', xray ? '1' : '0');
	}
</script>

<svelte:head><title>Colophon</title></svelte:head>

<div class="app">
	<Header {xray} onxray={toggleXray} />

	<main class:split={xray}>
		<section class="work">
			<Conversation />
			<Composer />
		</section>

		{#if xray}
			<aside class="flank">
				<SpendBar />
				<div class="hr"></div>
				<div class="slot"><LibraryPanel /></div>
				<div class="hr"></div>
				<div class="slot events"><EventTimeline /></div>
			</aside>
		{/if}
	</main>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background: var(--background);
		color: var(--foreground);
	}

	main {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.work {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	/*
		A flank, not a sidebar.

		Separated by a single hairline and nothing else — no card, no shadow, no
		second background. The instruments inside are already obviously distinct
		objects; drawing a box around each one is how a panel of readouts turns
		into a form. Space and the eyebrow labels do the work.
	*/
	.flank {
		flex: none;
		width: 22rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 0.85rem 0.6rem 0.85rem 1rem;
		border-left: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		min-height: 0;
	}

	.hr {
		flex: none;
		height: 1px;
		background: color-mix(in oklab, var(--border) 45%, transparent);
	}

	/*
		The two scrolling instruments share what the spend bar leaves.

		Without this each one is sized by its content, so a search returning
		twelve papers pushes the event timeline off the bottom of the screen —
		which it did. `flex-basis: 0` rather than `auto` is the load-bearing part:
		with `auto` the basis is still the content height and a long list wins the
		negotiation before it starts.

		Sizing lives here rather than in the panels because it is a fact about
		this column, not about a library. The `:global` reaches the component's
		own root, which is the element that has to do the growing.
	*/
	.slot {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.slot > :global(*) {
		flex: 1;
		min-height: 0;
	}

	/* Event rows are a third the height of a library row, so an even split
	   shows about three of them. Weighted to what each one needs to be useful. */
	.slot.events {
		flex-grow: 1.35;
	}

	/* Under a certain width two columns is one cramped column and one useless
	   one, so the flank goes rather than shrinking past legibility. */
	@media (max-width: 960px) {
		.flank {
			display: none;
		}
	}
</style>
