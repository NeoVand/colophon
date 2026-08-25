import { describe, it, expect, vi } from 'vitest';

/**
 * The test that is the point of the module.
 *
 * `tool-meta.ts` is a lookup table beside a tool set that lives somewhere else,
 * and that is exactly the shape of thing that goes stale in silence: adding a
 * tool costs nothing and forgetting its identity costs nothing *visibly* — the
 * fallback renders, the chip says something plausible, and the new tool quietly
 * looks like an MCP plug forever.
 *
 * So the tool set is imported for real, from the same factories the agent uses,
 * and walked. When someone adds a sixth tool this fails by name.
 *
 * `$env/dynamic/private` is a SvelteKit virtual module reached through
 * `image-tools` → `server/images`; it has to be mocked for a node run.
 */
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { createResearchTools } = await import('./tools');
const { createImageTools } = await import('./image-tools');
const { toolMeta, hasToolMeta, toolColor, TOOL_NAMES } = await import('./tool-meta');

/** Exactly what `createColophon` hands the agent as `tools`. */
function liveToolNames(): string[] {
	return Object.keys({ ...createResearchTools().tools, ...createImageTools().tools });
}

/** The `--co-*` legend, from layout.css. A tone outside it is a colour typo. */
const TONES = [
	'user',
	'model',
	'tool',
	'library',
	'memory',
	'subagent',
	'approval',
	'gate',
	'error',
	'accent'
];

describe('every tool the agent carries has an identity', () => {
	it('leaves none of them to the fallback', () => {
		const missing = liveToolNames().filter((name) => !hasToolMeta(name));
		expect(missing).toEqual([]);
	});

	it('walks a tool set worth walking', () => {
		// Guards the guard: a factory that returned nothing would make the test
		// above pass by having nothing to check.
		expect(liveToolNames().length).toBeGreaterThanOrEqual(5);
	});

	it('claims no tool the agent does not carry', () => {
		const live = new Set(liveToolNames());
		expect(TOOL_NAMES.filter((name) => !live.has(name))).toEqual([]);
	});
});

describe('the entries are legible at nine pixels', () => {
	it('gives every tool its own glyph', () => {
		// Shared glyphs defeat the whole module: these rows sit under each other.
		const glyphs = TOOL_NAMES.map((name) => toolMeta(name).icon);
		expect(new Set(glyphs).size).toBe(TOOL_NAMES.length);
	});

	it('keeps blurbs to a phrase', () => {
		for (const name of TOOL_NAMES) {
			const { blurb } = toolMeta(name);
			expect(blurb.length, `${name}: "${blurb}"`).toBeLessThanOrEqual(40);
			expect(blurb.endsWith('.'), `${name} ends in a full stop`).toBe(false);
		}
	});

	it('tones every tool from the legend', () => {
		for (const name of TOOL_NAMES) {
			expect(TONES, name).toContain(toolMeta(name).tone);
		}
	});
});

describe('what is not ours', () => {
	it('reads an unknown tool as an MCP plug', () => {
		const meta = toolMeta('notion_search_pages');
		expect(meta.blurb).toBe('from an MCP server');
	});

	it('reads agent-* as delegation, not as MCP', () => {
		// Mastra names a subagent call `agent-<name>`; the roster is per run, so
		// this is matched by shape rather than listed.
		expect(toolMeta('agent-paperReader').tone).toBe('subagent');
	});

	it('hands back a colour a style binding can use', () => {
		expect(toolColor('cite')).toBe('var(--co-accent)');
	});
});
