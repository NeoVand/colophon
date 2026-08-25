<script lang="ts">
	import type { IconSvgElement } from '@hugeicons/svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { session, type LoggedEvent } from '$lib/agent/session.svelte';
	import { subagentOf } from '$lib/agent/events';
	import { toolMeta } from '$lib/agent/tool-meta';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Toolbar from '$lib/components/ui/Toolbar.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';

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

	let {
		/** A row was clicked; the page opens the inspector on that event. */
		onselect,
		/** The `seq` currently open, so the row can show it is the one. */
		selected
	}: { onselect?: (seq: number) => void; selected?: number } = $props();

	interface Row {
		key: string;
		/**
		 * The `LoggedEvent.seq` this row is a summary of, when it is a summary of
		 * exactly one.
		 *
		 * This is what makes a row openable. Every label in this list —
		 * `search_papers`, `3.4s`, `12 results` — is a sentence somebody wrote,
		 * and the whole promise of an X-ray is that you can get behind the
		 * sentence to the object. `Inspector` has always been able to show that
		 * object; there was simply no way to say *which* one, so it was mounted
		 * nowhere and the timeline was a list of claims you had to take on faith.
		 *
		 * Absent on the folded text row, which stands for a run of many events and
		 * so has no single one to open.
		 */
		seq?: number;
		at: number;
		kind: string;
		label: string;
		detail?: string;
		tone: string;
		lane?: string;
		/** The tool's own glyph, so a column of calls is readable as a column. */
		icon?: IconSvgElement;
		/** The tool's blurb, on hover. Nothing on screen has to carry it. */
		hint?: string;
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
						seq,
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
							seq,
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
						seq,
						at,
						kind: 'tool-call',
						label: event.subagent ?? event.name,
						detail: briefArgs(event.args),
						tone: event.subagent ? '--co-subagent' : '--co-tool',
						lane: event.subagent,
						icon: toolMeta(event.name).icon,
						hint: toolMeta(event.name).blurb
					});
					break;
				case 'tool-result':
					rows.push({
						key: `tr${seq}`,
						seq,
						at,
						kind: event.failed ? 'tool-error' : 'tool-result',
						label: event.name ? (subagentOf(event.name) ?? event.name) : 'result',
						detail: event.failed ? 'failed' : briefResult(event.result),
						tone: event.failed ? '--co-error' : '--co-library',
						lane: event.name ? subagentOf(event.name) : undefined,
						icon: event.name ? toolMeta(event.name).icon : undefined,
						hint: event.name ? toolMeta(event.name).blurb : undefined
					});
					break;
				case 'step':
					rows.push({
						key: `st${seq}`,
						seq,
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
						seq,
						at,
						kind: 'approval',
						label: `approval · ${event.name}`,
						detail: 'run suspended',
						tone: '--co-approval'
					});
					break;
				case 'stage':
					/*
					 * A pipeline stage, on the same timeline as everything else.
					 *
					 * Only the *end* of a stage gets a row. A start and a finish for
					 * five stages is ten rows describing five things, and the finish is
					 * the one carrying the duration — which is the whole reason to look
					 * here rather than at the pipeline panel, where the stage is already
					 * drawn as a mark that lights.
					 */
					if (event.state !== 'start') {
						rows.push({
							key: `sg${seq}`,
							seq,
							at,
							kind: event.state === 'failed' ? 'error' : 'stage',
							label: `stage · ${event.step}`,
							detail: event.error ?? (event.ms ? `${(event.ms / 1000).toFixed(1)}s` : event.state),
							tone: event.state === 'failed' ? '--co-error' : '--co-subagent'
						});
					}
					break;
				case 'tripwire':
					rows.push({
						key: `tw${seq}`,
						seq,
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
						seq,
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
						seq,
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

	/**
	 * Where "clear" cleared to.
	 *
	 * A high-water mark rather than `session.events = []`, because this panel is
	 * a *reading* of the log and not its owner: the run panel counts steps out of
	 * it, the graph reconstructs the topology from it, and the ribbon draws it.
	 * Emptying the array to tidy one scroller would silently blank three other
	 * instruments — so clearing hides rows here and touches nothing else.
	 *
	 * A new thread restarts `seq` at zero, which would leave a stale mark hiding
	 * everything; `floor` below drops back to zero when the log is shorter than
	 * the mark, so a fresh run always shows itself.
	 */
	let clearedAt = $state(0);
	const nextSeq = $derived(
		session.events.length ? session.events[session.events.length - 1].seq + 1 : 0
	);
	const floor = $derived(clearedAt > nextSeq ? 0 : clearedAt);

	const all = $derived(rowsOf(session.events.filter((e) => e.seq >= floor)));

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

	/**
	 * Whether the view rides the tail.
	 *
	 * Auto-scroll is right by default and wrong the moment anyone is reading: a
	 * live research turn publishes hundreds of rows, and every one of them yanked
	 * the scroller away from whatever was being looked at. The lock is the fix,
	 * and it is a lock rather than a scroll-position heuristic because "did the
	 * human scroll, or did we" is not reliably answerable from a scroll event.
	 */
	let follow = $state(true);

	$effect(() => {
		void rows.length;
		if (follow && scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	function toLatest(): void {
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
	}

	/** Feedback for a copy has to come from the button; nothing else moves. */
	let copied = $state(false);
	let flash: ReturnType<typeof setTimeout> | undefined;

	async function copyEvents(): Promise<void> {
		// The reading on screen, not the whole log — copying rows a filter is
		// hiding would hand over something the panel never showed.
		const text = rows
			.map((r) =>
				[`${(r.at / 1000).toFixed(1)}s`, r.lane ? `  ${r.label}` : r.label, r.detail ?? '']
					.join('\t')
					.trimEnd()
			)
			.join('\n');
		await navigator.clipboard.writeText(text);
		copied = true;
		clearTimeout(flash);
		flash = setTimeout(() => (copied = false), 1200);
	}
</script>

{#snippet viewTools()}
	<IconButton
		icon={ICON.run}
		label="follow the tail"
		active={follow}
		onclick={() => (follow = !follow)}
	/>
	<IconButton
		icon={ICON.expand}
		label="jump to latest"
		disabled={!rows.length}
		onclick={toLatest}
	/>
{/snippet}

{#snippet logTools()}
	<IconButton
		icon={copied ? ICON.check : ICON.copy}
		label="copy events"
		disabled={!rows.length}
		onclick={copyEvents}
	/>
	<IconButton
		icon={ICON.trash}
		label="clear"
		disabled={!all.length}
		onclick={() => (clearedAt = nextSeq)}
	/>
{/snippet}

<PanelFrame label="events" icon={ICON.events} tone="tool" {tabs} bind:active={filter}>
	{#snippet actions()}
		<Toolbar groups={[viewTools, logTools]} />
	{/snippet}

	{#if !all.length}
		<EmptyState icon={ICON.events} tone="tool" title="Nothing yet" />
	{:else if !rows.length}
		<!-- Honest about which of the two emptinesses this is: the run did publish
		     events, this reading just excludes all of them. Showing the same
		     "nothing yet" copy here would blame the run for a filter. -->
		<EmptyState icon={ICON.filter} tone="tool" title="{all.length} events, none in this reading" />
	{:else}
		<div bind:this={scroller} class="rows">
			{#each rows as row (row.key)}
				<!--
					A button, not a div, and only when there is something to open.

					The folded text row summarises many events and has no single one
					behind it, so it stays inert rather than opening an arbitrary
					member of the run it stands for.
				-->
				<svelte:element
					this={row.seq === undefined ? 'div' : 'button'}
					role={row.seq === undefined ? undefined : 'button'}
					type={row.seq === undefined ? undefined : 'button'}
					class="row"
					class:laned={Boolean(row.lane)}
					class:openable={row.seq !== undefined}
					class:on={row.seq !== undefined && row.seq === selected}
					style:--tone="var({row.tone})"
					onclick={row.seq === undefined ? undefined : () => onselect?.(row.seq!)}
				>
					<span class="co-num t">{(row.at / 1000).toFixed(1)}</span>
					<!-- A tool call gets its own glyph and everything else gets the tick.
					     Both occupy the same 11px column, so the rows still line up and
					     the marked ones are the ones worth finding. -->
					{#if row.icon}
						<span class="glyph" aria-hidden="true">
							<HugeiconsIcon icon={row.icon} size={11} />
						</span>
					{:else}
						<span class="tick" aria-hidden="true"></span>
					{/if}
					<span class="label" title={row.hint}>{row.label}</span>
					{#if row.detail}<span class="detail">{row.detail}</span>{/if}
				</svelte:element>
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
		/* Reset, because half of these are buttons now. A row must look identical
		   whether or not it happens to be openable — the affordance is the hover,
		   not a permanent change of weight. */
		width: 100%;
		border: 0;
		padding: 0;
		background: transparent;
		font: inherit;
		color: inherit;
		text-align: left;
	}

	.row.openable {
		cursor: pointer;
		border-radius: 2px;
	}
	.row.openable:hover {
		background: color-mix(in oklab, var(--tone) 10%, transparent);
	}
	.row.on {
		background: color-mix(in oklab, var(--tone) 16%, transparent);
	}
	.row.openable:focus-visible {
		outline: 1px solid color-mix(in oklab, var(--tone) 60%, transparent);
		outline-offset: -1px;
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

	/* Both marks are centred in an 11px column so the labels align whether or
	   not a row carries a glyph. */
	.tick {
		flex: none;
		width: 11px;
		height: 4px;
		border-radius: 1px;
		background: var(--tone);
		opacity: 0.85;
		background-clip: content-box;
		padding: 0 3.5px;
	}

	.glyph {
		flex: none;
		display: inline-flex;
		align-self: center;
		color: var(--tone);
		opacity: 0.9;
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
