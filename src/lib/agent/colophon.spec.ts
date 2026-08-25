import { describe, expect, it, vi } from 'vitest';

/**
 * What the agent actually *is*, asserted against what the app claims it is.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * An audit found three features that were written, documented, unit-tested,
 * exported — and attached to nothing:
 *
 *   `COLOPHON_SKILLS`   two skills, counted on the opening screen and listed in
 *                       `SkillsPanel`, never passed to `new Agent()`. No `skill`
 *                       tool ever reached a request. The panel was describing a
 *                       file, not a run.
 *   `COLOPHON_SCORERS`  three scorers, imported by nothing at all.
 *   `toolsForAgent()`   MCP tools, so `MCP_SERVERS` populated a panel of servers
 *                       the agent could not call.
 *
 * Every one of them looked finished from the outside, which is the point: the
 * failure is invisible from the UI, from the types, and from the tests each
 * module already had. The only thing that catches it is asking the built agent
 * what it has. So that is what this does.
 *
 * It is a unit test — no network, no model call, no key. Building the agent
 * runs factories and closures and touches nothing.
 */

const env: Record<string, string | undefined> = { OPENAI_API_KEY: 'sk-test-not-used' };
vi.mock('$env/dynamic/private', () => ({ env }));

const { createColophon } = await import('./colophon');
const { COLOPHON_SKILLS } = await import('./skills');
const { COLOPHON_SCORERS } = await import('./scorers');

/**
 * Mastra's own accessors, which are the only honest way to ask.
 *
 * The first version of this file read `agent.tools`, `agent.agents` and friends
 * as plain properties and every one came back empty — they are private, and a
 * test that reads them would have passed forever on an agent with nothing
 * attached. `listTools()` / `listAgents()` / `listSkills()` / `listScorers()`
 * are what the class actually exposes, and they report what Mastra will use
 * rather than what was passed in, which is the difference that matters here.
 */
interface Built {
	listTools(): Record<string, unknown> | Promise<Record<string, unknown>>;
	listAgents(): Record<string, unknown> | Promise<Record<string, unknown>>;
	listSkills(): unknown[] | Promise<unknown[]>;
	listScorers(): Record<string, unknown> | Promise<Record<string, unknown>>;
	/**
	 * Everything the model is actually shown, which is a strictly larger set
	 * than `listTools()`: it adds `agent-paperReader` for the subagent and
	 * `skill` / `skill_read` / `skill_search` once any skill is attached.
	 * `listTools()` reports what was *assigned*; this reports what is *sent*.
	 */
	getToolsForExecution(ctx: object): Record<string, unknown> | Promise<Record<string, unknown>>;
}
const built = async () => (await createColophon()).agent as unknown as Built;

/**
 * The tools the model is handed on every single request.
 *
 * Spelled out rather than counted, because a count passes while a rename slips
 * through, and because this list is the thing other parts of the app quote.
 */
const TOOLS = [
	'search_papers',
	'fetch_paper',
	'extract_figures',
	'cite',
	'bibliography',
	'generate_image',
	'present_outline',
	'stylize_figure'
];

describe('the agent Colophon actually builds', () => {
	it('carries every built-in tool, by name', async () => {
		const agent = await built();
		const tools = Object.keys(await agent.listTools());
		// A superset check: `listTools()` also reports the tools Mastra mints for
		// skills and subagents, which the next two tests cover by name.
		for (const id of TOOLS) expect(tools).toContain(id);
	});

	it('carries the paper-reader subagent', async () => {
		const agent = await built();
		expect(Object.keys(await agent.listAgents())).toEqual(['paperReader']);
	});

	it('carries the skills the opening screen counts', async () => {
		const agent = await built();
		// The bug: this was empty, while `Preamble` said "2 skills" and
		// `SkillsPanel` listed both of them.
		expect(await agent.listSkills()).toHaveLength(COLOPHON_SKILLS.length);
	});

	it('carries the scorers', async () => {
		const agent = await built();
		expect(Object.keys(await agent.listScorers()).sort()).toEqual(
			Object.keys(COLOPHON_SCORERS).sort()
		);
	});

	it('exposes the `skill` tool, which is what proves the skills landed', async () => {
		const agent = await built();
		// Mastra registers `skill`, `skill_read` and `skill_search` the moment an
		// agent has any skills at all. Before they were attached, none of these
		// appeared on any request — which is the fact `SkillsPanel` was quietly
		// contradicting, since it reads activation off `skill` calls in the run.
		//
		// `getToolsForExecution`, not `listTools`: the skill tools are minted at
		// send time rather than assigned, so the assigned list would never show
		// them however well the skills were wired.
		const sent = Object.keys(await agent.getToolsForExecution({}));
		expect(sent).toEqual(expect.arrayContaining(['skill', 'skill_read', 'skill_search']));
	});

	it('shows the model the subagent as a tool', async () => {
		const agent = await built();
		// The delegation the tools panel used to declare uncountable. It is a real
		// line item on every request and it is right here.
		expect(Object.keys(await agent.getToolsForExecution({}))).toContain('agent-paperReader');
	});

	it('adds no MCP tools when no server is configured', async () => {
		const agent = await built();
		const mcp = Object.keys(await agent.listTools()).filter((id) => id.startsWith('mcp_'));
		expect(mcp).toEqual([]);
	});
});
