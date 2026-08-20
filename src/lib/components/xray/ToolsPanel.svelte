<script lang="ts">
	import { onMount } from 'svelte';
	import PanelFrame, { type PanelTab } from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { ICON } from '$lib/icons';
	import { session } from '$lib/agent/session.svelte';
	import { callsByTool, failureRate, slowest, totalToolTime } from '$lib/xray/inventory';
	import { ms } from '$lib/xray/format';

	/**
	 * The tools, read twice.
	 *
	 * A tool has two costs and a conversation shows neither. **Inventory** is
	 * what it costs to merely have: name, description and JSON Schema go out on
	 * every provider call whether or not the model reaches for the tool, so five
	 * tools are a fixed charge levied twelve times across a twelve-step turn.
	 * **Calls** is what it cost to use: how often, how slowly, how often it
	 * failed.
	 *
	 * They are tabs rather than two panels because they are the same subject
	 * seen twice — the same five tools, billed two different ways — and putting
	 * them side by side is what makes the comparison available at all. A tool
	 * with a long description and no calls is the interesting row, and it is
	 * invisible from either tab alone.
	 *
	 * The inventory comes from `/api/tools`, which builds the real tool
	 * factories and serialises the real schemas rather than reciting a list
	 * someone maintains. The calls come from `$lib/xray/inventory`, folded over
	 * the tool records the run already publishes.
	 */

	/**
	 * The wire shape, declared here rather than imported.
	 *
	 * `$lib/agent/tools` reaches server-only modules, so a component may not
	 * import it even for a type. If the endpoint changes, this changes.
	 */
	interface WireTool {
		id: string;
		description: string;
		descriptionChars: number;
		schemaChars: number;
		chars: number;
		approval: boolean;
	}

	let inventory = $state<WireTool[]>([]);
	let fixedTax = $state(0);
	let loadError = $state('');
	let loaded = $state(false);

	async function load() {
		try {
			const response = await fetch('/api/tools');
			if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
			const data = (await response.json()) as { tools: WireTool[]; chars: number };
			inventory = data.tools ?? [];
			fixedTax = data.chars ?? 0;
			loadError = '';
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loaded = true;
		}
	}

	// `onMount`, not `$effect`: this writes state it would otherwise depend on,
	// which is the shape that produces `effect_update_depth_exceeded`.
	onMount(load);

	/** Heaviest first — the question is always which one or two dominate. */
	const weighted = $derived([...inventory].sort((a, b) => b.chars - a.chars));

	/**
	 * Delegations are excluded on purpose.
	 *
	 * A subagent arrives in the stream as a tool call, but counting it here
	 * would put "paper reader" in a list of retrieval tools and average its
	 * forty seconds in with a cache hit. Its cost is a whole second context
	 * window, which is a different unit and has its own panel; the foot note
	 * below says so rather than leaving the arithmetic quietly short.
	 */
	const runs = $derived(session.turns.flatMap((t) => t.tools).filter((t) => !t.subagent));
	const delegations = $derived(
		session.turns.flatMap((t) => t.tools).filter((t) => t.subagent).length
	);

	const tallies = $derived(callsByTool(runs));
	const spent = $derived(totalToolTime(runs));
	const failed = $derived(failureRate(runs));
	const worst = $derived(slowest(runs, 3));

	/** The busiest tool's time, so the bars scale to the run rather than to a guess. */
	const peak = $derived(tallies.reduce((n, t) => Math.max(n, t.ms), 0));

	let tab = $state('inventory');

	const tabs = $derived<PanelTab[]>([
		{ id: 'inventory', label: 'inventory', count: inventory.length },
		{ id: 'calls', label: 'calls', count: runs.length }
	]);

	/**
	 * Characters, not bytes.
	 *
	 * `bytes()` would print `1.9 KB` and claim a unit these are not — a schema
	 * is counted in characters, the same unit `context.ts` bills in, and the two
	 * numbers only agree while nobody converts one of them.
	 */
	function kc(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
	}

	const readout = $derived(
		tab === 'inventory'
			? loaded && !loadError
				? `${kc(fixedTax)} chars every call`
				: ''
			: runs.length
				? `${ms(spent)} in tools`
				: ''
	);

	/** Hosted in another frame's tab group; that frame draws the header. */
	let { bare = false }: { bare?: boolean } = $props();
</script>

<PanelFrame {bare} label="tools" icon={ICON.tool} tone="tool" {tabs} bind:active={tab} {readout}>
	{#if tab === 'inventory'}
		{#if !loaded}
			<p class="quiet pad">…</p>
		{:else if loadError}
			<p class="pad">
				<span class="err">{loadError}</span>
				<button class="co-eyebrow retry" onclick={load}>retry</button>
			</p>
		{:else if !inventory.length}
			<EmptyState
				icon={ICON.tool}
				tone="tool"
				title="No tools are wired up."
				note="An agent with no tools can only say things. Every tool it gains is also a permanent line item on each request, which is the trade this tab exists to price."
			/>
		{:else}
			<div class="scroll">
				<ul class="rows">
					{#each weighted as tool (tool.id)}
						<li class="tool">
							<p class="head">
								<span class="co-num id">{tool.id}</span>
								{#if tool.approval}
									<span class="co-eyebrow gated" title="Pauses for a human before it runs">
										approval
									</span>
								{/if}
								<span class="co-num size" title="{tool.chars} characters on every request">
									{kc(tool.chars)}
								</span>
							</p>

							<!-- The bar is the argument: a row's width is its share of what
							     every request pays before the conversation starts. -->
							<span
								class="weight"
								style:width="{fixedTax ? (tool.chars / fixedTax) * 100 : 0}%"
								aria-hidden="true"
							></span>

							<p class="what">{tool.description}</p>
							<p class="co-num split">
								{kc(tool.descriptionChars)} description · {tool.schemaChars
									? `${kc(tool.schemaChars)} schema`
									: 'no schema'}
							</p>
						</li>
					{/each}
				</ul>

				<p class="quiet foot">
					{kc(fixedTax)} characters go out on every call in a turn, used or not — a twelve-step research
					turn pays this twelve times. The paper-reader subagent is a tool to the model as well; Mastra
					writes its schema at run time, so it is not counted here.
				</p>
			</div>
		{/if}
	{:else if !runs.length}
		<EmptyState
			icon={ICON.tool}
			tone="tool"
			title="Nothing called yet."
			note="The other tab is the bill that arrives whether or not anything runs. This one is what it bought — which tool did the work, which kept failing, and where the seconds went."
		/>
	{:else}
		<div class="scroll">
			<p class="co-num summary">
				{runs.length} call{runs.length === 1 ? '' : 's'} · {ms(spent)} inside tools{#if failed}
					· <span class="bad">{Math.round(failed * 100)}% failed</span>{/if}
			</p>

			<ul class="rows">
				{#each tallies as row (row.name)}
					<li class="call" class:bad={row.failed === row.calls}>
						<p class="head">
							<span class="co-num id">{row.name}</span>
							<span class="co-num size">{ms(row.ms)}</span>
						</p>
						<span
							class="weight"
							style:width="{peak ? (row.ms / peak) * 100 : 0}%"
							aria-hidden="true"
						></span>
						<p class="co-num split">
							{row.calls} call{row.calls === 1 ? '' : 's'}{#if row.failed}
								· <span class="bad">{row.failed} failed</span>{/if}
						</p>
					</li>
				{/each}
			</ul>

			{#if worst.length > 1}
				<p class="co-eyebrow section">slowest</p>
				<ul class="rows">
					<!-- Keyed by rank: `slowest` returns a ranking, two calls of one tool
					     can tie on name, and a duplicate key aborts the render. -->
					{#each worst as run, rank (rank)}
						<li class="slow">
							<span class="co-num id">{run.name}</span>
							<span class="co-num size" class:bad={run.failed}>{ms(run.ms)}</span>
						</li>
					{/each}
				</ul>
			{/if}

			<p class="quiet foot">
				Tool time is summed, not elapsed — searches are dispatched together, so this can exceed the
				turn that contains it.{#if delegations}
					{delegations} delegation{delegations === 1 ? '' : 's'} are counted in crew instead: a subagent's
					cost is a second context window, not a call.{/if}
			</p>
		</div>
	{/if}
</PanelFrame>

<style>
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.45rem 0.7rem 0.7rem;
	}
	.pad {
		margin: 0;
		padding: 0.5rem 0.7rem;
	}

	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tool,
	.call {
		padding: 0.4rem 0;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
	}
	.tool:last-child,
	.call:last-child {
		border-bottom: 0;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin: 0;
	}

	.id {
		font-size: 0.6875rem;
		color: var(--co-tool);
		overflow-wrap: anywhere;
	}

	.size {
		margin-left: auto;
		flex: none;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
	}

	/* Approval is a property of the tool, not of a call, so it is stated on the
	   inventory row — the one place it is true before anything happens. */
	.gated {
		flex: none;
		font-size: 0.5rem;
		padding: 0 0.25rem;
		border: 1px solid color-mix(in oklab, var(--co-approval) 35%, transparent);
		border-radius: 2px;
		color: var(--co-approval);
	}

	.weight {
		display: block;
		height: 2px;
		margin: 0.3rem 0;
		min-width: 2px;
		border-radius: 1px;
		background: color-mix(in oklab, var(--co-tool) 55%, transparent);
	}

	.what {
		margin: 0;
		font-size: 0.6875rem;
		line-height: 1.45;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		text-wrap: pretty;
		/* Two lines: enough to tell what the tool is for, short enough that five
		   descriptions still read as a list rather than as documentation. */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.split {
		margin: 0.15rem 0 0;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	.summary {
		margin: 0 0 0.3rem;
		font-size: 0.625rem;
		color: var(--muted-foreground);
	}

	.section {
		margin: 0.6rem 0 0.1rem;
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	.slow {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.15rem 0;
	}

	.bad {
		color: var(--co-error);
	}

	/* A tool where every call failed is the row worth finding, so it stops being
	   ochre: retrieval that never returned is not retrieval. A tool that failed
	   some of the time keeps its colour and says so in the count. */
	.call.bad .id {
		color: var(--co-error);
	}
	.call.bad .weight {
		background: color-mix(in oklab, var(--co-error) 55%, transparent);
	}

	.quiet {
		margin: 0;
		font-size: 0.6875rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
		text-wrap: pretty;
	}
	.foot {
		margin-top: 0.6rem;
	}

	.err {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		color: var(--co-error);
	}

	.retry {
		margin-left: 0.4rem;
		border: 0;
		background: transparent;
		padding: 0;
		cursor: pointer;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
	.retry:hover {
		color: var(--co-accent);
	}
</style>
