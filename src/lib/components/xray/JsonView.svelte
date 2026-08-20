<script lang="ts">
	import Self from './JsonView.svelte';

	/**
	 * A payload, opened up.
	 *
	 * The timeline can only ever say *that* something happened — `search`,
	 * `12 results`. This says what it actually carried, which is where the
	 * interesting readings live: the query the model really wrote as opposed to
	 * the one you assume it wrote, the twelve-field result object of which the
	 * agent used two, the sixty-kilobyte string that quietly became history and
	 * will be paid for again on every subsequent call.
	 *
	 * Three things it refuses to do, each because the alternative has burned
	 * someone:
	 *
	 * **It does not open everything.** A tool result is routinely a tree of a
	 * few thousand nodes; fully expanded it is a wall, and a wall is not an
	 * inspection. Two levels is what fits on a strip of screen, and the depth
	 * control above raises it.
	 *
	 * **It does not trust the value.** This renders whatever came off the wire,
	 * which means it must survive `undefined`, a getter that throws, a function,
	 * a `Map`, a cycle, and an array of forty thousand entries. Each of those is
	 * handled below rather than assumed away.
	 *
	 * **It borrows no legend colour.** The `--co-*` family means *subsystems* —
	 * ochre is retrieval everywhere in this app — so a JSON viewer that tinted
	 * its strings sage would be saying "library" about a piece of punctuation.
	 * Keys take the app's own accent; value kinds are separated by tone steps
	 * off the foreground instead, which is a second, smaller legend that cannot
	 * collide with the first.
	 */

	type Kind = 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'other' | 'array' | 'object';

	interface Props {
		value: unknown;
		/** The key this value sits under. Absent at the top of the tree. */
		name?: string;
		/** 0 at the top; each nesting adds one. */
		level?: number;
		/** Nodes at this level or deeper start folded. */
		openTo?: number;
		/**
		 * True for the widget — the depth control plus one node — and false for
		 * every node it renders. One file plays both parts so the tree can recurse
		 * into itself without a second component existing only to be a node.
		 */
		root?: boolean;
		/** The containers between here and the top, so a cycle can be spotted. */
		seen?: readonly object[];
	}

	let { value, name, level = 0, openTo = 2, root = true, seen = [] }: Props = $props();

	/** Strings longer than this get a `show all`; a narrow strip fits ~40. */
	const CLAMP = 90;
	/** …and only this much of one is ever put in the DOM while clamped. */
	const PREVIEW = 300;
	/** Rows revealed per click on a capped array. */
	const PAGE = 200;
	/**
	 * What `all` means on the depth control.
	 *
	 * Not `Infinity`: a cycle is caught below, but a legitimately deep structure
	 * would still mount tens of thousands of components on one click, and the
	 * click that hangs the tab is worse than the row you have to open by hand.
	 */
	const DEEP = 12;

	/* ── reading the value ──────────────────────────────────────────────── */

	function kindOf(v: unknown): Kind {
		if (v === null) return 'null';
		if (Array.isArray(v)) return 'array';
		switch (typeof v) {
			case 'undefined':
				return 'undefined';
			case 'string':
				return 'string';
			case 'number':
			case 'bigint':
				return 'number';
			case 'boolean':
				return 'boolean';
			case 'object':
				break;
			default:
				// function, symbol — nothing JSON can hold, but the browser can.
				return 'other';
		}
		if (v instanceof Map || v instanceof Set) return 'object';
		// A date, a regex, an error or a byte buffer read far better as one line
		// than as the field list its prototype technically has.
		if (v instanceof Date || v instanceof RegExp || v instanceof Error) return 'other';
		if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return 'other';
		return 'object';
	}

	/** One line for anything that is not a container. Never throws. */
	function scalarText(v: unknown): string {
		try {
			if (v === null) return 'null';
			if (v === undefined) return 'undefined';
			if (typeof v === 'bigint') return `${v}n`;
			if (typeof v === 'symbol') return v.toString();
			if (typeof v === 'function') return `ƒ ${v.name || 'anonymous'}()`;
			if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
			if (v instanceof Error) return `${v.name}: ${v.message}`;
			if (v instanceof ArrayBuffer) return `ArrayBuffer · ${v.byteLength} bytes`;
			if (ArrayBuffer.isView(v)) return `${v.constructor?.name ?? 'bytes'} · ${v.byteLength} bytes`;
			return String(v);
		} catch {
			// A `toString` that throws is rare and entirely legal. Losing one row is
			// acceptable; losing the render is not.
			return '[unreadable]';
		}
	}

	interface Entry {
		/** Unique within this node — a duplicate `{#each}` key aborts the render. */
		id: string;
		label: string;
		value: unknown;
	}

	function entriesOf(v: unknown): Entry[] {
		try {
			if (Array.isArray(v)) {
				return v.map((item, i) => ({ id: `i${i}`, label: String(i), value: item }));
			}
			if (v instanceof Map) {
				// Indexed rather than keyed by the map key: a Map key may be an object,
				// and two of them can stringify identically.
				return [...v.entries()].map(([k, val], i) => ({
					id: `m${i}`,
					label: typeof k === 'string' ? k : scalarText(k),
					value: val
				}));
			}
			if (v instanceof Set) {
				return [...v.values()].map((val, i) => ({ id: `s${i}`, label: String(i), value: val }));
			}
			return Object.entries(v as object).map(([k, val]) => ({ id: `k${k}`, label: k, value: val }));
		} catch {
			// Object.entries walks getters, and a getter is arbitrary code.
			return [];
		}
	}

	const kind = $derived(kindOf(value));
	const branch = $derived(kind === 'array' || kind === 'object');
	const container = $derived(branch ? (value as object) : undefined);

	/**
	 * A cycle, caught by ancestry rather than by a `try`.
	 *
	 * Recursing into an object that is already above us on this path is the only
	 * way this component can fail to terminate, and it is not exotic — an error
	 * with a `cause` chain or anything holding a reference to its own run does
	 * it. Marking the row and stopping shows the reader the cycle, which is more
	 * useful than either hanging or silently omitting it.
	 */
	const cyclic = $derived(Boolean(container && seen.includes(container)));
	const entries = $derived(branch && !cyclic ? entriesOf(value) : []);
	const foldable = $derived(branch && !cyclic && entries.length > 0);
	const nextSeen = $derived(container ? [...seen, container] : seen);

	/* ── what is open, and how much of it ───────────────────────────────── */

	/**
	 * `undefined` until the reader touches this node, and only then does its own
	 * choice outrank the depth control. Derived rather than assigned in an
	 * effect: an effect that both reads and writes open-state is exactly the
	 * `effect_update_depth_exceeded` this codebase has shipped before.
	 */
	let override = $state<boolean | undefined>(undefined);
	const open = $derived(override ?? level < openTo);

	let cap = $state(PAGE);
	const shown = $derived(entries.slice(0, cap));
	const hidden = $derived(Math.max(0, entries.length - cap));

	let full = $state(false);
	const text = $derived(kind === 'string' ? (value as string) : '');
	const long = $derived(text.length > CLAMP);
	const preview = $derived(
		kind !== 'string'
			? scalarText(value)
			: full
				? text
				: // Sliced *before* the whitespace is collapsed, so the regex never runs
					// over a sixty-kilobyte paper body just to produce a line of 300
					// characters. Newlines go because a preview is one line — a run of them
					// would make the row three deep and say nothing.
					text.slice(0, PREVIEW).replace(/\s+/g, ' ')
	);

	const summary = $derived.by(() => {
		if (cyclic) return 'circular';
		if (kind === 'array') return `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`;
		if (value instanceof Map) return `Map · ${entries.length}`;
		if (value instanceof Set) return `Set · ${entries.length}`;
		if (!entries.length) return 'empty';
		// The first few key names, because "what is in here" is the question a
		// folded object is actually being asked.
		const head = entries
			.slice(0, 3)
			.map((e) => e.label)
			.join(', ');
		return entries.length > 3 ? `${head}, +${entries.length - 3}` : head;
	});

	/* ── the depth control, owned by the widget ─────────────────────────── */

	/**
	 * `undefined` until the reader picks a depth, so the prop stays in charge
	 * until then. Seeding a `$state` from `openTo` instead would capture only its
	 * first value — the compiler says so, and it would be a real bug the day a
	 * caller wants to open a particular event wider.
	 */
	let chosenDepth = $state<number | undefined>(undefined);
	const depth = $derived(chosenDepth ?? openTo);

	const DEPTHS: { label: string; to: number }[] = [
		{ label: '1', to: 1 },
		{ label: '2', to: 2 },
		{ label: 'all', to: DEEP }
	];
</script>

{#if root}
	<div class="tree">
		<div class="control">
			<span class="co-eyebrow lab">depth</span>
			{#each DEPTHS as d (d.label)}
				<button
					class="co-eyebrow step"
					class:on={depth === d.to}
					onclick={() => (chosenDepth = d.to)}
				>
					{d.label}
				</button>
			{/each}
		</div>

		<!--
			Keyed on the depth so changing it remounts the tree.

			Without this, a node the reader had folded by hand would keep sitting
			folded through `depth all` — the control would visibly do nothing to the
			one row you were looking at. Remounting drops every per-node override at
			once, which is what "set the depth" is understood to mean.
		-->
		{#key depth}
			<Self {value} {name} level={0} openTo={depth} root={false} seen={[]} />
		{/key}
	</div>
{:else if branch}
	<div class="node">
		<button
			class="row branch"
			type="button"
			aria-expanded={foldable ? open : undefined}
			disabled={!foldable}
			onclick={() => (override = !open)}
		>
			<span class="twist" aria-hidden="true">{foldable ? (open ? '▾' : '▸') : '·'}</span>
			{#if name !== undefined}<span class="key">{name}</span>{/if}
			<span class="brace">{kind === 'array' ? '[' : '{'}</span>
			<span class="summary" class:cyclic>{summary}</span>
			<span class="brace">{kind === 'array' ? ']' : '}'}</span>
		</button>

		{#if open && foldable}
			<div class="kids">
				{#each shown as entry (entry.id)}
					<Self
						value={entry.value}
						name={entry.label}
						level={level + 1}
						{openTo}
						root={false}
						seen={nextSeen}
					/>
				{/each}
				{#if hidden}
					<!--
						The cap is not a nicety. A search result can hold tens of thousands
						of entries and each one here is a component; mounting them all to
						show a reader the first six is how an inspector becomes the reason
						the tab froze.
					-->
					<button class="more" type="button" onclick={() => (cap += PAGE)}>
						… {hidden.toLocaleString()} more
					</button>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<div class="row leaf">
		<span class="twist" aria-hidden="true"></span>
		{#if name !== undefined}<span class="key">{name}</span>{/if}
		<span
			class="val"
			class:s={kind === 'string'}
			class:n={kind === 'number'}
			class:b={kind === 'boolean'}
			class:nil={kind === 'null' || kind === 'undefined'}
			class:other={kind === 'other'}
			class:wrapped={full}>{preview}</span
		>
		{#if long}
			<button class="more tight" type="button" onclick={() => (full = !full)}>
				{full ? 'less' : `all ${text.length.toLocaleString()}`}
			</button>
		{/if}
	</div>
{/if}

<style>
	.tree {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		line-height: 1.65;
	}

	.control {
		display: flex;
		align-items: baseline;
		gap: 0.15rem;
		padding-bottom: 0.35rem;
	}
	.lab {
		font-size: 0.5rem;
		margin-right: 0.2rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}
	.step {
		border: 0;
		background: transparent;
		padding: 0 0.25rem;
		cursor: pointer;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
	}
	.step:hover {
		color: var(--muted-foreground);
	}
	.step.on {
		color: var(--co-accent);
	}

	.row {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		width: 100%;
		min-width: 0;
		text-align: left;
		font: inherit;
		border: 0;
		padding: 0;
		background: transparent;
		color: inherit;
	}
	.row.branch:not(:disabled) {
		cursor: pointer;
	}
	.row.branch:not(:disabled):hover .summary,
	.row.branch:not(:disabled):hover .twist {
		color: var(--muted-foreground);
	}

	.twist {
		flex: none;
		width: 0.7rem;
		font-size: 0.5625rem;
		color: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
	}

	/* The one place the app's own accent appears in a payload: a key is
	   Colophon's word for the thing, not the run's data. */
	.key {
		flex: none;
		color: var(--co-accent);
	}
	.key::after {
		content: ':';
		margin-left: 0.05em;
		color: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
	}

	.brace {
		flex: none;
		color: color-mix(in oklab, var(--muted-foreground) 40%, transparent);
	}

	.summary {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
	.summary.cyclic {
		font-style: italic;
		color: color-mix(in oklab, var(--co-error) 70%, var(--muted-foreground));
	}

	/* ── value tones: near-neutral by design, so none of them can be read as
	   a subsystem colour. Difference comes from where each sits between the
	   foreground and the muted grey, plus weight and slant. ─────────────── */

	.val {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: color-mix(in oklab, var(--foreground) 80%, transparent);
	}
	.val.wrapped {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		overflow: visible;
	}

	.val.s::before,
	.val.s::after {
		content: '"';
		color: color-mix(in oklab, var(--muted-foreground) 40%, transparent);
	}
	.val.n {
		color: color-mix(in oklab, var(--foreground) 72%, var(--co-accent));
		font-variant-numeric: tabular-nums;
	}
	.val.b {
		font-weight: 600;
		color: color-mix(in oklab, var(--co-accent) 45%, var(--muted-foreground));
	}
	.val.nil,
	.val.other {
		font-style: italic;
		color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
	}

	/* Indent and a hairline, matching the delegation lane in the timeline:
	   nesting is shown by a rule, never by a box. */
	.kids {
		margin-left: 0.35rem;
		padding-left: 0.6rem;
		border-left: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
	}

	.more {
		border: 0;
		background: transparent;
		padding: 0;
		cursor: pointer;
		font: inherit;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		transition: color 180ms ease;
	}
	.more:hover {
		color: var(--co-accent);
	}
	.more.tight {
		flex: none;
		align-self: flex-start;
	}
</style>
