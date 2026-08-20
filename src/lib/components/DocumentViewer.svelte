<script lang="ts" module>
	/**
	 * The kinds, restated rather than imported.
	 *
	 * The union lives in `$lib/server/db/documents.schema.ts`, and importing it
	 * here — even as a type — puts a `$lib/server` module in the client's import
	 * graph, which SvelteKit refuses on purpose: one careless change turns a type
	 * import into a value import and ships the database credentials to the
	 * browser. Four strings, written twice, is the cheap side of that trade.
	 */
	export type DocumentKind = 'markdown' | 'typst' | 'latex' | 'html';

	/**
	 * What this component needs, and nothing else.
	 *
	 * Structural rather than `typeof documents.$inferSelect` for the same reason:
	 * a preview held in memory, a row off the wire with string dates, and a
	 * draft that has never been saved should all be viewable.
	 */
	export interface ViewableDocument {
		id: string;
		title: string;
		kind: DocumentKind;
		body: string;
		tags?: string[];
		updatedAt?: Date | string | null;
	}

	interface Section {
		level: number;
		text: string;
		line: number;
		key: string;
	}

	/**
	 * LaTeX sectioning, in one regex.
	 *
	 * This does not become a `latex.ts` beside `typst.ts`, and the asymmetry is
	 * deliberate: `typst.ts` exists because it also *validates*, which is real
	 * logic with real failure modes and a test file. Finding `\section{}` is four
	 * command names and a nesting order. A module for it would be ceremony.
	 *
	 * The key is the line number, never the text — two chapters called
	 * "Discussion" is ordinary, and a duplicate key in a Svelte keyed each throws
	 * and aborts the render.
	 */
	const LATEX_LEVELS = ['part', 'chapter', 'section', 'subsection', 'subsubsection'];

	function latexOutline(source: string): Section[] {
		const sections: Section[] = [];
		const lines = source.split('\n');

		for (let i = 0; i < lines.length; i++) {
			// A commented-out section is still in the file and is not in the paper.
			const live = lines[i].replace(/(^|[^\\])%.*$/, '$1');
			const match = /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{(.+?)\}/.exec(live);
			if (!match) continue;
			sections.push({
				level: LATEX_LEVELS.indexOf(match[1]) + 1,
				text: match[2].replace(/\\[a-zA-Z]+\s*/g, '').trim() || match[2],
				line: i + 1,
				key: `l${i + 1}`
			});
		}

		return sections;
	}

	type Tone = 'cmd' | 'str' | 'plain';

	interface Token {
		text: string;
		tone: Tone;
	}

	/**
	 * Commands and strings, picked out of one line.
	 *
	 * Tokens, not markup — the same rule `xray/highlight.ts` follows and for the
	 * same reason. A function returning a highlighted *string* would be one
	 * `{@html}` away from executing a document, and the documents here are pasted
	 * and generated. Every token is rendered as a real element with a text node.
	 *
	 * The invariant that makes it safe to point at anything: the concatenation of
	 * every `text` is exactly the input. Nothing the pattern fails to understand
	 * is dropped; it falls through as `plain` and reaches the screen verbatim.
	 */
	const PATTERNS: Partial<Record<DocumentKind, RegExp>> = {
		typst: /(#[a-zA-Z][A-Za-z0-9_.-]*)|("(?:\\.|[^"\\])*")|(`[^`]*`)/g,
		latex: /(\\[a-zA-Z@]+\*?)|(\$[^$]*\$)/g
	};

	function tokenize(line: string, kind: DocumentKind): Token[] {
		const pattern = PATTERNS[kind];
		if (!pattern) return [{ text: line, tone: 'plain' }];

		// `matchAll` clones the regex, so the module-level pattern is safe to
		// share across lines and instances — its lastIndex is never advanced.
		const tokens: Token[] = [];
		let last = 0;

		for (const m of line.matchAll(pattern)) {
			const at = m.index ?? 0;
			if (at > last) tokens.push({ text: line.slice(last, at), tone: 'plain' });
			tokens.push({ text: m[0], tone: m[1] !== undefined ? 'cmd' : 'str' });
			last = at + m[0].length;
		}
		if (last < line.length) tokens.push({ text: line.slice(last), tone: 'plain' });

		return tokens;
	}
</script>

<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ICON } from '$lib/icons';
	import PanelFrame, { type PanelTab } from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Prose from '$lib/components/Prose.svelte';
	import { inspectTypst } from '$lib/typst';
	import { relative } from '$lib/xray/format';
	import type { Snippet } from 'svelte';

	/**
	 * A document, shown as the kind of thing it is.
	 *
	 * Four formats, one panel, and the differences between them are the point.
	 * Markdown is prose and is set to be read. Typst and LaTeX are *source* —
	 * nobody reads a `.typ` file for pleasure, they navigate it, so it gets an
	 * outline rail and a bracket check instead of a rendering. HTML is neither:
	 * it is markup of unknown origin, and the only honest thing to do with it is
	 * show you what it says before deciding to run it.
	 *
	 * The tone defaults to `library` because a draft sits beside the papers it
	 * cites and belongs to the same half of the product. If the vault ever earns
	 * a legend colour of its own, this default is the single line that changes.
	 */
	let {
		doc,
		tone = 'library',
		actions
	}: {
		doc?: ViewableDocument | null;
		tone?: string;
		/** Passed through to the panel header — edit, delete, export. */
		actions?: Snippet;
	} = $props();

	let active = $state('read');

	/**
	 * The scrolling source pane.
	 *
	 * `bind:this` rather than an attachment because the thing that scrolls it —
	 * the outline rail — is a sibling, not a child. An attachment would hand the
	 * node to a callback that would then have to park it in exactly this
	 * variable, which is the same reference with a longer path to it.
	 */
	let pane = $state<HTMLElement | null>(null);

	const kind = $derived(doc?.kind ?? 'markdown');
	const source = $derived(doc?.body ?? '');

	/** Typst is the only kind that can tell us it is malformed. */
	const reading = $derived(kind === 'typst' ? inspectTypst(source) : null);
	const sections = $derived(
		kind === 'typst' ? (reading?.headings ?? []) : kind === 'latex' ? latexOutline(source) : []
	);

	/**
	 * Indent relative to the shallowest heading in *this* document.
	 *
	 * A paper made entirely of `\section` would otherwise start two levels in
	 * and waste a third of a narrow rail on empty space it can never fill.
	 */
	const topLevel = $derived(sections.length ? Math.min(...sections.map((s) => s.level)) : 1);

	const lines = $derived(source.split('\n'));

	/**
	 * Tokenised once per document rather than once per render.
	 *
	 * A chapter is a few thousand lines and every one of them is re-tokenised on
	 * any state change if this is done inline in the template — including on a
	 * tab click, which is the one interaction that has to feel instant.
	 */
	const rows = $derived(
		lines.map((line, i) => ({
			n: i + 1,
			comment: kind === 'typst' ? /^\s*\/\//.test(line) : kind === 'latex' && /^\s*%/.test(line),
			heading:
				kind === 'typst'
					? /^\s*=+[ \t]/.test(line)
					: kind === 'latex' && /^\s*\\(part|chapter|(sub)*section)\*?\s*\{/.test(line),
			tokens: tokenize(line, kind)
		}))
	);

	const words = $derived(source.trim() ? source.trim().split(/\s+/).length : 0);

	/**
	 * Tabs are the same subject seen differently, never navigation.
	 *
	 * Markdown has two honest readings — set as prose, or as the text you typed.
	 * HTML has two — what it says, and what it does. Typst and LaTeX have one
	 * until there is a compiler, so they get no tab bar rather than a tab bar
	 * with one tab in it.
	 */
	const tabs = $derived<PanelTab[]>(
		kind === 'markdown'
			? [
					{ id: 'read', label: 'read', icon: ICON.prose },
					{ id: 'source', label: 'source', icon: ICON.raw }
				]
			: kind === 'html'
				? [
						{ id: 'source', label: 'source', icon: ICON.raw },
						{ id: 'preview', label: 'preview', icon: ICON.inspect }
					]
				: []
	);

	/**
	 * Which of the three renderings is on screen.
	 *
	 * Derived once and used by both the branch and the rail, because the first
	 * version had the two conditions written separately and they disagreed:
	 * opening a Typst file while `active` was still `preview` from an HTML one
	 * showed the source with its outline silently missing.
	 */
	const view = $derived(
		kind === 'markdown'
			? active === 'source'
				? 'source'
				: 'read'
			: kind === 'html' && active === 'preview'
				? 'preview'
				: 'source'
	);

	const readout = $derived(
		kind === 'markdown'
			? `${words.toLocaleString()} words`
			: `${lines.length.toLocaleString()} lines`
	);

	/**
	 * Markdown that opens with its own title, minus that title.
	 *
	 * The panel is already showing it two centimetres above. Only stripped when
	 * the heading actually matches — a document whose first line is a different
	 * `# heading` keeps it, because that one is content.
	 */
	const prose = $derived.by(() => {
		if (kind !== 'markdown') return source;
		const match = /^\s*#\s+(.+?)\s*(?:\n|$)/.exec(source);
		if (match && doc && match[1].toLowerCase() === doc.title.trim().toLowerCase()) {
			return source.slice(match[0].length).replace(/^\s*\n/, '');
		}
		return source;
	});

	function goto(line: number) {
		const row = pane?.querySelector(`[data-line="${line}"]`);
		if (!row) return;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		row.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
	}
</script>

<PanelFrame
	label="document"
	icon={kind === 'markdown' ? ICON.prose : ICON.raw}
	{tone}
	{tabs}
	bind:active
	readout={doc ? readout : undefined}
	{actions}
>
	{#if !doc}
		<EmptyState
			icon={ICON.prose}
			title="No document open"
			note="Notes, drafts and papers share one store, each addressed by a slug that never follows its title — which is why a link pasted into last spring's digest still resolves."
			{tone}
		/>
	{:else}
		<div class="doc">
			<header class="head">
				<h2 class="title">{doc.title}</h2>
				<p class="meta co-num">
					<span class="kind">{doc.kind}</span>
					{#if doc.updatedAt}<span class="sep">·</span>edited {relative(doc.updatedAt)}{/if}
					{#each doc.tags ?? [] as tag, i (i)}<span class="tag">#{tag}</span>{/each}
				</p>
			</header>

			{#if !source.trim()}
				<EmptyState
					icon={ICON.prose}
					title="Nothing written yet"
					note="The body is a column in the vault, not a file on one laptop — which is why the paragraph you started on a train is already here."
					{tone}
				/>
			{:else if view === 'read'}
				<div class="scroll read">
					<Prose text={prose} />
				</div>
			{:else if view === 'preview'}
				<!--
					The document is rendered in an iframe with `sandbox` set to the empty
					string, which is every restriction at once: no scripts, no forms, no
					plugins, no top-level navigation, and — because `allow-same-origin` is
					absent — a unique opaque origin, so the page cannot read this app's
					cookies, storage or session.

					What is NOT used here, ever, is `{@html}`. `Prose.svelte` may use it
					because `renderMarkdown` builds every tag itself and escapes every
					character of source text; the tree it emits is one this app authored.
					An HTML document in the vault is the opposite — it was pasted, exported
					or generated, and `{@html}` would run it *inside* the app's origin with
					the reader's session attached. That is not a rendering, it is an
					execution, and the one that matters is the one nobody looks at.
				-->
				<div class="scroll frame-wrap">
					<iframe class="preview" title="{doc.title} — sandboxed preview" sandbox="" srcdoc={source}
					></iframe>
					<p class="caveat">
						Sandboxed: scripts, forms and navigation are switched off, and the page has no access to
						this origin. It is styled by its own document, not by the app's theme.
					</p>
				</div>
			{:else}
				{#if reading?.problem}
					{@const problem = reading.problem}
					<!-- The check is worth having only if it takes you to the line. -->
					<button class="problem" onclick={() => goto(problem.line)}>
						<HugeiconsIcon icon={ICON.error} size={12} />
						<span>{problem.message}</span>
					</button>
				{/if}

				<div class="stage">
					{#if sections.length}
						<nav class="rail" aria-label="Outline">
							<p class="co-eyebrow rail-label">outline</p>
							<ul>
								{#each sections as section (section.key)}
									<li style:--depth={section.level - topLevel}>
										<button class="jump" onclick={() => goto(section.line)}>
											<span class="name">{section.text}</span>
											<span class="co-num at">{section.line}</span>
										</button>
									</li>
								{/each}
							</ul>
						</nav>
					{/if}

					<div class="scroll source" bind:this={pane}>
						<!--
							Keyed by line *number*, never by line text. Repeated lines are
							ordinary in source — a file of closing braces has hundreds — and a
							duplicate key throws, which aborts the render and leaves the
							previous document on screen rather than merely misdrawing.
						-->
						{#each rows as row (row.n)}
							<div
								class="line"
								class:comment={row.comment}
								class:heading={row.heading}
								data-line={row.n}
							>
								<span class="n co-num">{row.n}</span>
								<code class="text"
									>{#each row.tokens as token, i (i)}<span
											class:cmd={token.tone === 'cmd'}
											class:str={token.tone === 'str'}>{token.text}</span
										>{/each}</code
								>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</PanelFrame>

<style>
	.doc {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
	}

	/* The document's own title, in the reading face — not another eyebrow. The
	   panel header says what kind of thing this is; this says which one. */
	.head {
		flex: none;
		padding: 0.7rem 0.9rem 0.5rem;
	}
	.title {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 1.05rem;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem;
		margin: 0.25rem 0 0;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}
	.kind {
		color: color-mix(in oklab, var(--co-library) 85%, transparent);
	}
	.sep {
		opacity: 0.5;
	}
	.tag {
		color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
	}

	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.2rem 0.9rem 2rem;
	}
	.read {
		padding-top: 0.4rem;
	}

	/* The bracket check, as a line you can act on rather than a badge. */
	.problem {
		flex: none;
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		width: 100%;
		border: 0;
		background: color-mix(in oklab, var(--co-error) 7%, transparent);
		padding: 0.4rem 0.9rem;
		text-align: left;
		font-size: 0.6875rem;
		line-height: 1.45;
		color: var(--co-error);
		cursor: pointer;
		transition: background-color 150ms ease;
	}
	.problem:hover {
		background: color-mix(in oklab, var(--co-error) 12%, transparent);
	}

	.stage {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.rail {
		flex: none;
		width: 12.5rem;
		min-height: 0;
		overflow-y: auto;
		padding: 0.5rem 0.4rem 2rem 0.9rem;
		border-right: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
	}
	/* Below this the rail is competing with the source for a measure neither can
	   spare, and the source is the thing being read. */
	@media (max-width: 700px) {
		.rail {
			display: none;
		}
	}
	.rail-label {
		margin: 0 0 0.35rem;
		font-size: 0.5rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}
	.rail ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.jump {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		width: 100%;
		border: 0;
		background: transparent;
		/* Depth as indent, so the structure is legible without a single rule or
		   disclosure triangle. */
		padding: 0.14rem 0.2rem 0.14rem calc(0.2rem + var(--depth) * 0.6rem);
		text-align: left;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		cursor: pointer;
		border-radius: 2px;
		transition: color 150ms ease;
	}
	.jump:hover {
		color: var(--foreground);
	}
	.jump .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.jump .at {
		flex: none;
		font-size: 0.5625rem;
		opacity: 0.45;
	}

	.source {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.55;
		padding-left: 0.5rem;
	}
	.line {
		display: flex;
		gap: 0.6rem;
		min-height: 1.55em;
	}
	.n {
		flex: none;
		width: 2.5ch;
		text-align: right;
		font-size: 0.625rem;
		/* 0.75rem × 1.55 ÷ 0.625rem. The gutter is set smaller than the code, so
		   it needs the code's *computed* line height, not the code's ratio, or the
		   numbers drift a pixel further from their lines with every screenful. */
		line-height: 1.86;
		color: color-mix(in oklab, var(--muted-foreground) 38%, transparent);
		user-select: none;
	}
	.text {
		flex: 1;
		min-width: 0;
		/* Wrapped, not scrolled sideways. A panel is a third of the screen and a
		   line of Typst is often longer than that; a horizontal scrollbar hides
		   the end of every long line behind a gesture. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: color-mix(in oklab, var(--foreground) 82%, transparent);
	}

	/* Three families of ink, and none of them borrowed from the --co-* legend:
	   ochre means retrieval in this app and must not also mean "a command". The
	   --co-file-* family exists precisely for conventional associations, and
	   amber-for-code / green-for-strings is the convention every reader already
	   has from their editor. */
	.text .cmd {
		color: var(--co-file-code);
	}
	.text .str {
		color: var(--co-file-data);
	}
	.line.comment .text {
		color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
		font-style: italic;
	}
	.line.heading .text {
		color: var(--foreground);
		font-weight: 600;
	}

	.frame-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.4rem;
	}
	.preview {
		width: 100%;
		min-height: 24rem;
		flex: 1;
		border: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
		border-radius: var(--radius-sm);
		/* Not a background token, and not a literal colour either: `color-scheme`
		   tells the embedded document which canvas to paint for itself. An HTML
		   file in the vault carries its own styling and is almost always written
		   for a light page — handing it this app's dark ground would leave black
		   text on it. The frame below says out loud that it is a separate document. */
		color-scheme: light;
	}
	.caveat {
		margin: 0;
		font-size: 0.625rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
	}
</style>
