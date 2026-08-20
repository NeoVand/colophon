<script lang="ts">
	import { session, type LoggedEvent } from '$lib/agent/session.svelte';
	import { subagentOf } from '$lib/agent/events';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	/**
	 * Every event in the run, in the order it arrived.
	 *
	 * Two things this shows that a chat window structurally cannot:
	 *
	 * **Delegation, as a lane.** A subagent's calls are indented under the
	 * parent. Everything inside that lane was paid for once, in a context window
	 * that was then discarded — only the small reply came back. Drawn as one
	 * more row it would look like one more tool call, which is the opposite of
	 * what it costs and the opposite of what it is for.
	 *
	 * **The shape of the wait.** With elapsed time on every row, a run that
	 * spent ninety seconds inside one fetch looks nothing like one that made
	 * thirty quick calls, and neither is distinguishable from the conversation.
	 *
	 * Text deltas are folded rather than listed. Several hundred `text` rows
	 * carrying two words each would bury every event that matters, and the
	 * answer they compose is already on screen to the left.
	 */

	/**
	 * The three readings, as tabs on the frame rather than as buttons of this
	 * panel's own. They are the same subject seen at three depths, which is
	 * exactly what a tab is for — `tools` is what the run *did*, `quiet` drops
	 * the per-token chatter, `all` is the wire.
	 *
	 * A plain string because `PanelFrame`'s `active` is bindable and untyped
	 * beyond `string`; the comparisons below are the narrowing.
	 */
	let filter = $state('tools');

	interface Row {
		key: string;
		at: number;
		kind: string;
		label: string;
		detail?: string;
		tone: string;
		lane?: string;
	}

	/** Fold a run of text deltas into one row that counts them. */
	function rowsOf(log: LoggedEvent[]): Row[] {
		const rows: Row[] = [];
		let textRun: { at: number; chars: number; seq: number } | undefined;

		const flushText = () => {
			if (!textRun) return;
			rows.push({
				key: `text-${textRun.seq}`,
				at: textRun.at,
				kind: 'text',
				label: 'text',
				detail: `${textRun.chars.toLocaleString()} chars`,
				tone: '--co-model'
			});
			textRun = undefined;
		};

		for (const { seq, at, event } of log) {
			if (event.k === 'text') {
				textRun ??= { at, chars: 0, seq };
				textRun.chars += event.text.length;
				continue;
			}
			flushText();

			switch (event.k) {
				case 'start':
					rows.push({
						key: `s${seq}`,
						at,
						kind: 'start',
						label: 'run started',
						tone: '--co-model'
					});
					break;
				case 'reasoning':
					if (event.state === 'start') {
						rows.push({
							key: `r${seq}`,
							at,
							kind: 'reasoning',
							label: 'reasoning',
							tone: '--co-model'
						});
					}
					break;
				case 'tool-call':
					rows.push({
						key: `tc${seq}`,
						at,
						kind: 'tool-call',
						label: event.subagent ?? event.name,
						detail: briefArgs(event.args),
						tone: event.subagent ? '--co-subagent' : '--co-tool',
						lane: event.subagent
					});
					break;
				case 'tool-result':
					rows.push({
						key: `tr${seq}`,
						at,
						kind: event.failed ? 'tool-error' : 'tool-result',
						label: event.name ? (subagentOf(event.name) ?? event.name) : 'result',
						detail: event.failed ? 'failed' : briefResult(event.result),
						tone: event.failed ? '--co-error' : '--co-library',
						lane: event.name ? subagentOf(event.name) : undefined
					});
					break;
				case 'step':
					rows.push({
						key: `st${seq}`,
						at,
						kind: 'step',
						label: 'step',
						detail: `${event.usage.total.toLocaleString()} tok`,
						tone: '--co-memory'
					});
					break;
				case 'approval':
					rows.push({
						key: `a${seq}`,
						at,
						kind: 'approval',
						label: `approval · ${event.name}`,
						detail: 'run suspended',
						tone: '--co-approval'
					});
					break;
				case 'tripwire':
					rows.push({
						key: `tw${seq}`,
						at,
						kind: 'tripwire',
						label: 'gate',
						detail: event.reason,
						tone: '--co-gate'
					});
					break;
				case 'done':
					rows.push({
						key: `d${seq}`,
						at,
						kind: 'done',
						label: 'finished',
						detail: `${event.usage.total.toLocaleString()} tok`,
						tone: '--co-model'
					});
					break;
				case 'error':
					rows.push({
						key: `e${seq}`,
						at,
						kind: 'error',
						label: 'error',
						detail: event.message,
						tone: '--co-error'
					});
					break;
			}
		}
		flushText();
		return rows;
	}

	/** The first thing in the arguments a person would want to see. */
	function briefArgs(args: unknown): string | undefined {
		if (!args || typeof args !== 'object') return undefined;
		const a = args as Record<string, unknown>;
		for (const key of ['query', 'arxivId', 'id', 'prompt', 'slug']) {
			const v = a[key];
			if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}…` : v;
		}
		return undefined;
	}

	function briefResult(result: unknown): string | undefined {
		if (!result || typeof result !== 'object') return undefined;
		const r = result as Record<string, unknown>;
		if (Array.isArray(r.results)) return `${r.results.length} results`;
		if (typeof r.chars === 'number') return `${Math.round(r.chars / 1000)}k chars`;
		if (typeof r.citation === 'string') return r.citation.slice(0, 50);
		if (typeof r.bytes === 'number') return `${Math.round(r.bytes / 1024)} KB`;
		return undefined;
	}

	const all = $derived(rowsOf(session.events));

	/* Each reading materialised rather than switched on, so the tabs can carry
	   their own counts — the number beside a tab is the reason to reach for it. */
	const toolRows = $derived(
		all.filter((r) => r.kind.startsWith('tool') || r.kind === 'approval' || r.kind === 'tripwire')
	);
	const quietRows = $derived(
		all.filter((r) => r.kind !== 'text' && r.kind !== 'step' && r.kind !== 'reasoning')
	);

	const rows = $derived(filter === 'all' ? all : filter === 'tools' ? toolRows : quietRows);

	const tabs = $derived([
		{ id: 'tools', label: 'tools', count: toolRows.length },
		{ id: 'quiet', label: 'quiet', count: quietRows.length },
		{ id: 'all', label: 'all', count: all.length }
	]);

	let scroller = $state<HTMLDivElement>();
	$effect(() => {
		void rows.length;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});
</script>

<PanelFrame label="events" icon={ICON.events} tone="tool" {tabs} bind:active={filter}>
	{#if !all.length}
		<EmptyState
			icon={ICON.events}
			tone="tool"
			title="Nothing yet"
			note="Every chunk the run publishes lands here, in order. A delegation gets its own indented lane, and the elapsed time on each row is what tells one slow fetch apart from thirty quick ones."
		/>
	{:else if !rows.length}
		<!-- Honest about which of the two emptinesses this is: the run did publish
		     events, this reading just excludes all of them. Showing the same
		     "nothing yet" copy here would blame the run for a filter. -->
		<EmptyState
			icon={ICON.filter}
			tone="tool"
			title="Nothing in this reading"
			note="The run published {all.length} events and none of them survive this filter. Switch to all to see the wire itself, folded text deltas included."
		/>
	{:else}
		<div bind:this={scroller} class="rows">
			{#each rows as row (row.key)}
				<div class="row" class:laned={Boolean(row.lane)} style:--tone="var({row.tone})">
					<span class="co-num t">{(row.at / 1000).toFixed(1)}</span>
					<span class="tick" aria-hidden="true"></span>
					<span class="label">{row.label}</span>
					{#if row.detail}<span class="detail">{row.detail}</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
</PanelFrame>

<style>
	.rows {
		overflow-y: auto;
		min-height: 0;
		padding: 0.4rem 0.7rem 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		line-height: 1.7;
	}

	.row {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		white-space: nowrap;
	}

	/* The lane. An indent and a rule, so a delegation reads as a nested run
	   rather than as a differently-coloured sibling. */
	.row.laned {
		padding-left: 0.9rem;
		margin-left: 0.35rem;
		border-left: 1px solid color-mix(in oklab, var(--co-subagent) 35%, transparent);
	}

	.t {
		flex: none;
		width: 2.4rem;
		text-align: right;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}

	.tick {
		flex: none;
		width: 4px;
		height: 4px;
		border-radius: 1px;
		background: var(--tone);
		opacity: 0.85;
	}

	.label {
		flex: none;
		color: var(--tone);
	}

	.detail {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}
</style>
