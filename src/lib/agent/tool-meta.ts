import type { IconSvgElement } from '@hugeicons/svelte';
import { ICON } from '$lib/icons';

/**
 * Per-tool identity.
 *
 * A tool call is the most-repeated object in this application — it appears as a
 * chip in the conversation, as a row in the timeline, as a schema band in the
 * context panel — and by default every one of them looks like every other one:
 * a snake_case name in mono. At that size the only question anyone actually has
 * is *which* tool, and a name alone answers it slowest.
 *
 * So each tool gets a glyph, a legend colour and a phrase. The glyph is the
 * identity: no two entries below share one, because these rows sit directly
 * beneath each other and a shared symbol makes the one list whose whole job is
 * "which tool" unable to answer. `search_papers` and `fetch_paper` both touch
 * arXiv; the glyph says which end of it.
 *
 * ── Why the fallback is a plug ──────────────────────────────────────────────
 * An unknown name is very nearly always an MCP tool: `toolsForAgent` merges
 * whatever a configured server advertises, under the server's own ids, and
 * those cannot be enumerated at build time. The other way to be unknown is to
 * be a built-in someone forgot to list here — and `tool-meta.spec.ts` fails the
 * moment that happens. The test is what makes the plug honest.
 */
export interface ToolMeta {
	icon: IconSvgElement;
	/**
	 * A `--co-*` name — 'library', 'tool'. Not a colour: the caller composes
	 * `var(--co-{tone})`, so a theme change stays a theme change.
	 */
	tone: string;
	/** A phrase, never a sentence. Lowercase, no full stop, four words or so. */
	blurb: string;
}

/**
 * Every tool Colophon itself ships.
 *
 * Keep this in the order the agent uses them — search, read, cite, list, draw —
 * because that is the order a person learns them in.
 */
const META: Record<string, ToolMeta> = {
	search_papers: { icon: ICON.search, tone: 'tool', blurb: 'arXiv and OpenAlex, by topic' },
	fetch_paper: { icon: ICON.paper, tone: 'tool', blurb: 'arXiv full text' },

	/* Sage rather than ochre: what comes back is the paper's own material, which
	   is the library growing rather than another fetch happening. */
	extract_figures: { icon: ICON.figure, tone: 'library', blurb: 'figures the authors published' },

	/* Accent, matching the cited mark in the library panel. `cite` is the one
	   tool that can refuse, and what it produces is the app's own guarantee
	   rather than another retrieval. */
	cite: { icon: ICON.cite, tone: 'accent', blurb: 'a citation the run can vouch for' },
	bibliography: { icon: ICON.library, tone: 'library', blurb: 'everything the run consulted' },

	/* Amber, which in this legend means the run is waiting on you — and that is
	   this tool's defining property, not a footnote: `requireApproval` pauses
	   before every render because it is the only call that spends. */
	generate_image: { icon: ICON.generate, tone: 'approval', blurb: 'an illustration, gated on you' }
};

/** Anything a configured MCP server contributed. See the note above. */
const FROM_MCP: ToolMeta = { icon: ICON.mcp, tone: 'tool', blurb: 'from an MCP server' };

/**
 * Delegation, which Mastra surfaces as a tool called `agent-<name>`.
 *
 * Matched by shape rather than listed by name, because the subagent roster is
 * assembled per run and a reader added tomorrow should not read as MCP.
 */
const DELEGATION: ToolMeta = {
	icon: ICON.subagent,
	tone: 'subagent',
	blurb: 'its own context window'
};

/** The names this module claims. The spec walks these against the live tool set. */
export const TOOL_NAMES: readonly string[] = Object.freeze(Object.keys(META));

export function hasToolMeta(name: string): boolean {
	return name in META;
}

export function toolMeta(name: string): ToolMeta {
	return META[name] ?? (name.startsWith('agent-') ? DELEGATION : FROM_MCP);
}

/** The tone as a colour, for a `style:` binding. */
export function toolColor(name: string): string {
	return `var(--co-${toolMeta(name).tone})`;
}
