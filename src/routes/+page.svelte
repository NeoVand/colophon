<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/agent/session.svelte';
	import { theme } from '$lib/theme.svelte';
	import { layout } from '$lib/layout.svelte';
	import * as threads from '$lib/threads';

	import Header from '$lib/components/Header.svelte';
	import Split from '$lib/components/Split.svelte';
	import Stack, { type PanelSpec } from '$lib/components/Stack.svelte';
	import Conversation from '$lib/components/chat/Conversation.svelte';
	import Composer from '$lib/components/chat/Composer.svelte';
	import ActivityStrip from '$lib/components/chat/ActivityStrip.svelte';
	import ThreadList from '$lib/components/chat/ThreadList.svelte';
	import SettingsSheet from '$lib/components/SettingsSheet.svelte';
	import AboutSheet from '$lib/components/AboutSheet.svelte';
	import Cockpit from '$lib/components/cockpit/Cockpit.svelte';

	import SpendBar from '$lib/components/xray/SpendBar.svelte';
	import MemoryPanel from '$lib/components/xray/MemoryPanel.svelte';
	import ContextPanel from '$lib/components/xray/ContextPanel.svelte';
	import LibraryPanel from '$lib/components/xray/LibraryPanel.svelte';
	import EventTimeline from '$lib/components/xray/EventTimeline.svelte';
	import GraphPanel from '$lib/components/xray/GraphPanel.svelte';
	import McpPanel from '$lib/components/xray/McpPanel.svelte';
	import SkillsPanel from '$lib/components/xray/SkillsPanel.svelte';

	/**
	 * The working surface: a conversation, and the dissection beside it.
	 *
	 * The flank is a `Split` rather than a fixed column and a `Stack` rather
	 * than a fixed order — the divider drags, the instruments reorder, fold and
	 * hide. That is not decoration: eight panels do not fit a screen at once,
	 * and which of them matter depends entirely on what you are doing. Reading
	 * a paper, the library and events; tuning a prompt, the context window.
	 *
	 * `onMount` for every startup call. All of them read `localStorage` and
	 * write tracked state, which inside an `$effect` is a write to something the
	 * effect depends on — `effect_update_depth_exceeded`, shipped twice here.
	 */
	let settingsOpen = $state(false);
	let aboutOpen = $state(false);
	let threadsOpen = $state(false);
	let model = $state('gpt-5');

	onMount(() => {
		theme.start();
		layout.start();
		session.restore();
		threads.touch(session.thread);
	});

	/**
	 * The instruments, in the order they are first offered.
	 *
	 * `grow` is each panel's share of the leftover height. Spend, memory, skills
	 * and MCP are a fixed handful of rows and take none — giving them an equal
	 * eighth starves the four that are lists. Events earns the most: it is the
	 * one that is useless with three rows showing.
	 */
	const PANELS: PanelSpec[] = [
		{ id: 'spend', label: 'spend', tone: 'tok-new', component: SpendBar, grow: 0 },
		{ id: 'memory', label: 'memory', tone: 'memory', component: MemoryPanel, grow: 0 },
		{ id: 'graph', label: 'graph', tone: 'subagent', component: GraphPanel, grow: 0.9 },
		{ id: 'context', label: 'context', tone: 'memory', component: ContextPanel, grow: 0.8 },
		{ id: 'library', label: 'library', tone: 'library', component: LibraryPanel, grow: 1.1 },
		{ id: 'events', label: 'events', tone: 'tool', component: EventTimeline, grow: 1.4 },
		{ id: 'skills', label: 'skills', tone: 'accent', component: SkillsPanel, grow: 0 },
		{ id: 'mcp', label: 'mcp', tone: 'tool', component: McpPanel, grow: 0 }
	];

	const panelVisibility = $derived(
		Object.fromEntries(PANELS.map((p) => [p.id, layout.isVisible(p.id)]))
	);

	function openThread(id: string) {
		session.open(id);
		threads.touch(id);
		threadsOpen = false;
	}

	function newThread() {
		session.newThread();
		threads.touch(session.thread);
	}
</script>

<svelte:head><title>Colophon</title></svelte:head>

<div class="app">
	<Header
		flank={layout.showFlank}
		onflank={() => layout.toggleFlank()}
		mode={layout.mode}
		onmode={(m) => layout.setMode(m)}
		onsettings={() => (settingsOpen = true)}
		onabout={() => (aboutOpen = true)}
		onthreads={() => (threadsOpen = true)}
		onnew={newThread}
	/>

	<main>
		{#if layout.showFlank}
			<Split defaultSize={layout.flank} onresize={(p) => layout.setFlank(p)}>
				{#snippet left()}
					{@render work()}
				{/snippet}
				{#snippet right()}
					<aside class="flank">
						{#if layout.mode === 'cockpit'}
							<Cockpit />
						{:else}
							<Stack panels={PANELS} />
						{/if}
					</aside>
				{/snippet}
			</Split>
		{:else}
			{@render work()}
		{/if}
	</main>
</div>

{#snippet work()}
	<section class="work">
		<Conversation />
		<ActivityStrip />
		<Composer />
	</section>
{/snippet}

<ThreadList bind:open={threadsOpen} current={session.thread} onopen={openThread} />

<SettingsSheet
	bind:open={settingsOpen}
	{model}
	onmodel={(m) => (model = m)}
	panels={panelVisibility}
	onpanel={(id) => layout.toggleVisible(id)}
	onclear={() => {
		threads.clear();
		layout.reset();
		session.newThread();
	}}
/>

<AboutSheet bind:open={aboutOpen} />

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
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	/*
		A flank, not a sidebar.

		Separated by the splitter's hairline and nothing else — no card, no
		shadow, no second background. The instruments inside are already
		obviously distinct objects; a box around each is how a panel of readouts
		becomes a form.
	*/
	.flank {
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 0.7rem 0.5rem 0.7rem 0.85rem;
		min-height: 0;
		overflow: hidden;
	}
</style>
