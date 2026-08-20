<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import { session } from '$lib/agent/session.svelte';
	import { SKILL_CARDS, type SkillCard } from '$lib/agent/skills';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';

	/**
	 * What the agent could look up, and what it actually did.
	 *
	 * A skill is a document the model can decide to read. Its *description*
	 * sits in front of the model on every single call; its *instructions* only
	 * arrive if the model calls the `skill` tool and asks for them by name. So
	 * a skill has two prices, and only one of them is paid on a turn that never
	 * needed it. Both are on screen, because that trade is the entire reason
	 * this mechanism exists and it is invisible from a chat window.
	 *
	 * ── Activation is read, not reported ────────────────────────────────────
	 * Nothing is passed into the agent to make this panel work. Mastra registers
	 * a `skill` tool the moment any skill exists, so an activation *is* a tool
	 * call in the run — `skill({ name })` — and a reference fetch is
	 * `skill_read({ skillName, path })`. Both are already in `session.turns`,
	 * folded out of the same stream the conversation reads.
	 *
	 * That is the house rule from harnessXray and it earns its keep here: the
	 * panel shows the skills the run *used*, not the skills it was *configured*
	 * with. Those differ constantly, and the gap is the interesting reading. A
	 * skill that never activates across a week of runs is a description that
	 * fails to advertise what it is for — a copy problem, and one you cannot
	 * see any other way.
	 */

	let {
		/** Overridable so the Lab can show a different roster than Study runs. */
		skills = SKILL_CARDS,
		/** Hosted in another frame's tab group; that frame draws the header. */
		bare = false
	}: { skills?: readonly SkillCard[]; bare?: boolean } = $props();

	/**
	 * Each skill, with what the run did to it.
	 *
	 * One pass over the run's tool calls rather than a lookup table keyed by
	 * skill name: the key would come from the model's own arguments, and a
	 * plain object indexed by attacker-chosen strings is a class of bug not
	 * worth inviting to save a loop over four skills.
	 */
	const rows = $derived.by(() => {
		const calls = session.turns.flatMap((turn) => turn.tools);
		return skills.map((card) => {
			let used = 0;
			const read: string[] = [];

			for (const tool of calls) {
				const args = (tool.args ?? {}) as {
					name?: unknown;
					skillName?: unknown;
					path?: unknown;
				};
				if (tool.name === 'skill') {
					if (args.name === card.name) used++;
				} else if (tool.name === 'skill_read' && args.skillName === card.name) {
					if (typeof args.path !== 'string') continue;
					// `skill_read` is called with the advertised path
					// (`references/skeleton.md`); the card lists the bare key. Normalise
					// so the two can be compared at all.
					const file = args.path.replace(/^references\//, '');
					if (!read.includes(file)) read.push(file);
				}
			}

			return { card, used, read };
		});
	});

	const activeCount = $derived(rows.filter((row) => row.used > 0).length);
	const alwaysCost = $derived(skills.reduce((total, s) => total + s.always, 0));
	const deferred = $derived(skills.reduce((total, s) => total + s.onDemand, 0));

	/** One expanded at a time — the panel is a column, not a page. */
	let open = $state('');
</script>

<PanelFrame
	{bare}
	label="skills"
	icon={ICON.skills}
	tone="accent"
	readout={skills.length ? `${skills.length} available · ${activeCount} activated` : undefined}
>
	{#if !skills.length}
		<EmptyState
			icon={ICON.skills}
			tone="accent"
			title="No skills attached"
			note="A skill is a document the model reads only when it asks for it by name."
		/>
	{:else}
		<div class="content">
			<ul class="list">
				{#each rows as { card, used, read } (card.name)}
					<li class="row" class:on={used > 0}>
						<!--
							Hollow ring → filled, the same two-state glyph the library panel
							uses for depth. One shape whose inking changes reads as a scale;
							two different badges read as two unrelated facts.
						-->
						<span class="mark" aria-hidden="true"></span>

						<div class="body">
							<button
								class="head co-bare"
								onclick={() => (open = open === card.name ? '' : card.name)}
								aria-expanded={open === card.name}
							>
								<span class="name co-num">{card.name}</span>
								<span class="co-eyebrow state">
									{used ? (used > 1 ? `activated ×${used}` : 'activated') : 'dormant'}
								</span>
								<HugeiconsIcon icon={open === card.name ? ICON.expand : ICON.collapse} size={12} />
							</button>

							<!-- The line the model sees on every call. It is the whole basis on
							     which the model decides to activate, so it is quoted verbatim
							     rather than paraphrased into panel copy. -->
							<p class="desc">{card.description}</p>

							{#if open === card.name}
								<ul class="contributes">
									{#each card.contributes as line, i (i)}
										<li>{line}</li>
									{/each}
								</ul>

								{#if card.references.length}
									<p class="refs co-num">
										{#each card.references as file, i (file)}{i ? ', ' : ''}<span
												class:got={read.includes(file)}>{file}</span
											>{/each}
										<span class="note">{read.length ? 'fetched' : 'available to skill_read'}</span>
									</p>
								{/if}

								<!--
									The compaction rule used to be a paragraph at the foot of the
									panel explaining why "activated ×2" happens. It belongs on the
									word it explains, where it is read by whoever is puzzled.
								-->
								<p class="cost co-num">
									<span class="k">{card.always}</span> tok in context always ·
									<span class="k" class:on={used > 0}>{card.onDemand}</span> tok
									<Tooltip
										text="Instructions leave again on a compaction, so a long run can load the same skill twice."
									>
										<span>{used ? 'loaded' : 'only if activated'}</span>
									</Tooltip>
								</p>
							{/if}
						</div>
					</li>
				{/each}
			</ul>

			<!-- The two numbers the paragraph here was circling around. Left as a
			     readout: the split between what is always paid for and what is not
			     is the panel's whole argument, and it fits on one line. -->
			<p class="co-num foot">
				{alwaysCost} tok always · {deferred} deferred
			</p>
		</div>
	{/if}
</PanelFrame>

<style>
	.content {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
		padding: 0.6rem 0.7rem 0.75rem;
	}

	.k {
		color: color-mix(in oklab, var(--foreground) 70%, transparent);
	}
	.k.on {
		color: var(--co-accent);
	}

	/* Sits under a scrolling list, so it is `flex: none` — a foot that scrolls
	   away is not a foot. */
	.foot {
		flex: none;
		margin: 0;
		padding-top: 0.5rem;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
	}

	.list {
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
		padding: 0.45rem 0;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
	}
	.row:last-child {
		border-bottom: 0;
	}

	.mark {
		flex: none;
		width: 7px;
		height: 7px;
		margin-top: 0.42rem;
		border-radius: 999px;
		border: 1px solid color-mix(in oklab, var(--co-accent) 45%, transparent);
		background: transparent;
		transition:
			background-color 250ms ease,
			box-shadow 250ms ease;
	}
	.row.on .mark {
		background: var(--co-accent);
		border-color: var(--co-accent);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--co-accent) 20%, transparent);
	}

	.body {
		flex: 1;
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0;
		background: none;
		border: 0;
		cursor: pointer;
		color: inherit;
		text-align: left;
	}
	.head :global(svg) {
		flex: none;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		transition: color 150ms ease;
	}
	.head:hover :global(svg) {
		color: var(--muted-foreground);
	}

	.name {
		font-size: 0.75rem;
		color: color-mix(in oklab, var(--foreground) 80%, transparent);
		transition: color 200ms ease;
	}
	.row.on .name {
		color: var(--foreground);
	}

	.state {
		margin-left: auto;
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
	}
	.row.on .state {
		color: var(--co-accent);
	}

	.desc {
		margin: 0.15rem 0 0;
		font-size: 0.6875rem;
		line-height: 1.45;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		text-wrap: pretty;
	}

	.contributes {
		margin: 0.4rem 0 0;
		padding: 0;
		list-style: none;
	}
	.contributes li {
		position: relative;
		padding-left: 0.7rem;
		font-size: 0.6875rem;
		line-height: 1.45;
		color: color-mix(in oklab, var(--foreground) 65%, transparent);
		text-wrap: pretty;
	}
	.contributes li + li {
		margin-top: 0.2rem;
	}
	/* A tick rather than a bullet: these are things the run gains, not items in
	   an inventory. */
	.contributes li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.5em;
		width: 4px;
		height: 1px;
		background: color-mix(in oklab, var(--co-accent) 60%, transparent);
	}

	.refs,
	.cost {
		margin: 0.35rem 0 0;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}
	.refs .got {
		color: var(--co-accent);
	}
	.refs .note {
		margin-left: 0.4rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}
</style>
