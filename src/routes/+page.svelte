<script lang="ts">
	import { onMount } from 'svelte';
	import { Pane, PaneGroup } from 'paneforge';
	import { session } from '$lib/agent/session.svelte';
	import { theme } from '$lib/theme.svelte';
	import { layout } from '$lib/layout.svelte';
	import * as threads from '$lib/threads';
	import { ICON } from '$lib/icons';

	import Header from '$lib/components/Header.svelte';
	import Divider from '$lib/components/Divider.svelte';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import Conversation from '$lib/components/chat/Conversation.svelte';
	import Composer from '$lib/components/chat/Composer.svelte';
	import ActivityStrip from '$lib/components/chat/ActivityStrip.svelte';
	import ThreadList from '$lib/components/chat/ThreadList.svelte';
	import SettingsSheet from '$lib/components/SettingsSheet.svelte';
	import AboutSheet from '$lib/components/AboutSheet.svelte';

	import WorkflowPanel from '$lib/components/xray/WorkflowPanel.svelte';
	import EventTimeline from '$lib/components/xray/EventTimeline.svelte';
	import Inspector from '$lib/components/xray/Inspector.svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import ContextPanel from '$lib/components/xray/ContextPanel.svelte';
	import LibraryPanel from '$lib/components/xray/LibraryPanel.svelte';
	import FiguresPanel from '$lib/components/xray/FiguresPanel.svelte';
	import DocumentsPanel from '$lib/components/xray/DocumentsPanel.svelte';
	import GraphPanel from '$lib/components/xray/GraphPanel.svelte';
	import ToolsPanel from '$lib/components/xray/ToolsPanel.svelte';
	import SubagentsPanel from '$lib/components/xray/SubagentsPanel.svelte';
	import SkillsPanel from '$lib/components/xray/SkillsPanel.svelte';
	import MemoryPanel from '$lib/components/xray/MemoryPanel.svelte';
	import McpPanel from '$lib/components/xray/McpPanel.svelte';
	import TracePanel from '$lib/components/xray/TracePanel.svelte';
	import SpendBar from '$lib/components/xray/SpendBar.svelte';
	import RunPanel from '$lib/components/xray/RunPanel.svelte';

	/**
	 * Three columns: the work, the run, and the machine.
	 *
	 * The first arrangement was two columns with a dozen instruments stacked in
	 * a scrolling strip, and it was rejected on sight — correctly. A column of
	 * twelve collapsed labels is a settings page. What makes an instrument panel
	 * legible is that things which answer the same question sit together, and
	 * that each one gets enough room to be read rather than scrolled.
	 *
	 * So the split is by *question*, not by subsystem:
	 *
	 *   chat     what you asked, and what came back
	 *   middle   what is happening right now — the pipeline, the event stream,
	 *            and the request going out this second
	 *   right    what the machine is made of — its shape, its tools, its crew,
	 *            what it remembers
	 *
	 * The middle column changes constantly during a run. The right column barely
	 * changes at all: it is the harness, and it is what you read *between* runs.
	 * Putting a live event stream next to a static tool inventory was most of
	 * why the first version felt like noise.
	 *
	 * Panels are grouped into tabs where they are two readings of one subject.
	 * A tab is never navigation here — `library`/`figures` is "what this run
	 * gathered", seen two ways.
	 *
	 * Every pane is resizable and every size persists via paneforge's
	 * `autoSaveId`. `onMount` for the stores: each reads `localStorage` and
	 * writes tracked state, which inside an `$effect` is
	 * `effect_update_depth_exceeded` — shipped twice here already.
	 */
	let settingsOpen = $state(false);
	let aboutOpen = $state(false);
	let threadsOpen = $state(false);
	let model = $state('gpt-5');
	let mode = $state<'chat' | 'research'>('chat');

	/** Which tab each grouped panel is showing. */
	let artefacts = $state('library');

	/**
	 * The event the inspector is open on, by `seq`.
	 *
	 * `Inspector` was written, finished and mounted nowhere, and the timeline had
	 * no selection at all — so the one thing an X-ray is *for*, getting behind a
	 * summary to the object it summarises, could not be done here at all. Every
	 * row in that list is a sentence somebody wrote; this is how you check it.
	 *
	 * Held by `seq` rather than by the event object, so the panel keeps following
	 * the live log: the same event re-derived on the next frame is still the one
	 * that is open.
	 */
	let inspecting = $state<number | undefined>();
	const inspected = $derived(session.events.find((e) => e.seq === inspecting));
	/** `Sheet` binds `open`; this keeps the two representations in step. */
	let inspectorOpen = $state(false);
	$effect(() => {
		if (!inspectorOpen) inspecting = undefined;
	});
	let machine = $state('graph');

	onMount(() => {
		theme.start();
		layout.start();
		session.restore();
		threads.touch(session.thread);
	});

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
		onsettings={() => (settingsOpen = true)}
		onabout={() => (aboutOpen = true)}
		onthreads={() => (threadsOpen = true)}
		onnew={newThread}
	/>

	<main>
		{#if layout.showFlank}
			<PaneGroup direction="horizontal" autoSaveId="co:root" class="group">
				<Pane defaultSize={34} minSize={22}>{@render chat()}</Pane>
				<Divider />
				<Pane defaultSize={66} minSize={30}>
					<PaneGroup direction="horizontal" autoSaveId="co:xray" class="group">
						<!-- ── what is happening right now ───────────────────── -->
						<Pane defaultSize={44} minSize={24}>
							<PaneGroup direction="vertical" autoSaveId="co:live" class="group">
								<Pane defaultSize={26} minSize={10} collapsible collapsedSize={6}>
									<!--
										Mounted with no `events` for its whole life until now, so it
										could only ever say "Nothing has run yet" — a finished panel
										wired to nothing, which is this repo's signature failure. The
										events come from the research stream; `running` is true only
										while the pipeline is the thing in flight.
									-->
									<WorkflowPanel
										events={session.workflow}
										running={session.mode === 'research' && session.status === 'running'}
									/>
								</Pane>
								<Divider direction="vertical" />
								<Pane defaultSize={42} minSize={16}>
									<EventTimeline
										selected={inspecting}
										onselect={(seq) => {
											inspecting = seq;
											inspectorOpen = true;
										}}
									/>
								</Pane>
								<Divider direction="vertical" />
								<Pane defaultSize={32} minSize={12} collapsible collapsedSize={6}>
									<ContextPanel />
								</Pane>
							</PaneGroup>
						</Pane>

						<Divider />

						<!-- ── what the machine is made of ───────────────────── -->
						<Pane defaultSize={56} minSize={26}>
							<PaneGroup direction="vertical" autoSaveId="co:machine" class="group">
								<Pane defaultSize={40} minSize={16}>
									<!--
										Papers met, figures drawn, documents written — one group, because
										they answer one question: what does this run have to show for
										itself? `documents` is the only one of the three that outlives the
										thread, which is exactly why it belongs beside the two that do not.
										It was written for this flank and then shipped mounted nowhere, so
										"give it a task and write the paper" had nowhere to land in view.
									-->
									<PanelFrame
										label="artefacts"
										icon={ICON.library}
										tone="library"
										bind:active={artefacts}
										tabs={[
											{ id: 'library', label: 'library', icon: ICON.paper },
											{ id: 'figures', label: 'figures', icon: ICON.figure },
											{ id: 'documents', label: 'documents', icon: ICON.prose }
										]}
									>
										{#if artefacts === 'library'}
											<LibraryPanel bare />
										{:else if artefacts === 'figures'}
											<FiguresPanel bare />
										{:else}
											<DocumentsPanel bare />
										{/if}
									</PanelFrame>
								</Pane>
								<Divider direction="vertical" />
								<Pane defaultSize={40} minSize={18}>
									<PanelFrame
										label="harness"
										icon={ICON.workflow}
										tone="subagent"
										bind:active={machine}
										tabs={[
											{ id: 'graph', label: 'graph' },
											{ id: 'tools', label: 'tools' },
											{ id: 'crew', label: 'crew' },
											{ id: 'skills', label: 'skills' },
											{ id: 'memory', label: 'memory' },
											{ id: 'mcp', label: 'mcp' },
											{ id: 'trace', label: 'trace' }
										]}
									>
										{#if machine === 'graph'}<GraphPanel bare />
										{:else if machine === 'tools'}<ToolsPanel bare />
										{:else if machine === 'crew'}<SubagentsPanel bare />
										{:else if machine === 'skills'}<SkillsPanel bare />
										{:else if machine === 'memory'}<MemoryPanel bare />
										{:else if machine === 'mcp'}<McpPanel bare />
										{:else}
											<!--
												Mounted with no `spans` for its whole life until now, and
												defaulting `configured` to true — so it reported tracing as
												on and idle when it was simply not wired. Both facts now
												come off the run: the server records spans against its own
												clock and streams them as they open and close, and says in
												the same channel whether it is recording at all.
											-->
											<TracePanel
												bare
												spans={session.spans}
												configured={session.tracing.configured}
												reason={session.tracing.reason ?? ''}
												truncated={session.tracing.truncated ?? false}
											/>
										{/if}
									</PanelFrame>
								</Pane>
								<Divider direction="vertical" />
								<!-- The two readouts you glance at rather than read, so they
									     sit at the bottom where the eye rests between runs. -->
								<Pane defaultSize={20} minSize={10} collapsible collapsedSize={6}>
									<PaneGroup direction="horizontal" autoSaveId="co:vitals" class="group">
										<Pane defaultSize={50} minSize={25}><RunPanel /></Pane>
										<Divider />
										<Pane defaultSize={50} minSize={25}><SpendBar /></Pane>
									</PaneGroup>
								</Pane>
							</PaneGroup>
						</Pane>
					</PaneGroup>
				</Pane>
			</PaneGroup>
		{:else}
			{@render chat()}
		{/if}
	</main>
</div>

{#snippet chat()}
	<section class="work">
		<Conversation />
		<ActivityStrip />
		<Composer bind:mode />
	</section>
{/snippet}

<ThreadList bind:open={threadsOpen} current={session.thread} onopen={openThread} />

<SettingsSheet
	bind:open={settingsOpen}
	{model}
	onmodel={(m) => (model = m)}
	onclear={() => {
		threads.clear();
		layout.reset();
		session.newThread();
	}}
/>

<AboutSheet bind:open={aboutOpen} />

<!--
	The inspector, in a sheet rather than a fourth pane.

	A pane is the harnessXray answer and it needs room this layout has already
	spent: three columns are full, and a fourth would put the transcript under
	forty characters. A sheet costs one keystroke to dismiss and can be as wide
	as the frame it is reading, which is what a raw request body needs.
-->
<Sheet bind:open={inspectorOpen} side="right" title="Event">
	<Inspector event={inspected} onclose={() => (inspectorOpen = false)} />
</Sheet>

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

	/* paneforge's own element, which Svelte does not scope-stamp. */
	main :global(.group) {
		height: 100%;
		width: 100%;
	}

	.work {
		height: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
</style>
