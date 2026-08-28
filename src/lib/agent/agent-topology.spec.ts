import { describe, expect, it } from 'vitest';
import { agentTopology, LOOP_NODE, MODEL_NODE, type AgentShape } from './agent-topology';

/**
 * The agent's drawing, and the one property that decides whether it is an
 * instrument or a picture.
 *
 * The graph panel used to draw the research workflow during ordinary chat
 * turns, and light it by matching `tool-call` names against workflow step ids —
 * names that can never match, so nothing ever lit. The test that would have
 * caught that is the first one below: **node ids must be the tool's real name**,
 * because that is what an event carries. Everything else here is layout; that
 * one is the wiring.
 */

const shape = (over: Partial<AgentShape> = {}): AgentShape => ({
	id: 'colophon',
	name: 'Colophon',
	model: { id: 'gpt-5', provider: 'openai.responses' },
	tools: [
		{ id: 'search_papers', description: 'Search arXiv.' },
		{ id: 'generate_image', approval: true },
		{ id: 'agent-paperReader', subagent: 'Paper reader' }
	],
	skills: [{ name: 'literature-review' }],
	scorers: ['citationDensity'],
	memory: { attached: false },
	processors: { input: [], output: [] },
	...over
});

describe('the agent loop, drawn', () => {
	it('keys tool nodes on the name a tool-call event carries', () => {
		const { nodes } = agentTopology(shape());
		const ids = nodes.map((n) => n.id);

		// The delegation especially: the box is labelled "Paper reader" but the
		// id has to stay `agent-paperReader`, because that is what arrives on the
		// wire. Labelling and lighting are different jobs.
		expect(ids).toContain('agent-paperReader');
		expect(nodes.find((n) => n.id === 'agent-paperReader')?.label).toBe('Paper reader');
		expect(ids).toContain('search_papers');
	});

	it('puts every tool in one rank, because the model chooses between them', () => {
		const { nodes } = agentTopology(shape());
		const ranks = new Set(
			nodes.filter((n) => n.id.startsWith('search') || n.id.startsWith('agent-')).map((n) => n.rank)
		);
		expect(ranks.size).toBe(1);
	});

	it('names the model that will actually serve the call', () => {
		const model = agentTopology(shape()).nodes.find((n) => n.id === MODEL_NODE);
		expect(model?.label).toBe('gpt-5');
		expect(model?.description).toContain('openai.responses');
	});

	it('draws the return, which is what makes it a loop and not a pipeline', () => {
		const loop = agentTopology(shape()).nodes.find((n) => n.id === LOOP_NODE);
		expect(loop?.kind).toBe('loop');
		// Between the tools and the end: after a tool, control goes back to the
		// model; the run ends when it stops asking for one.
		const { nodes } = agentTopology(shape());
		const tools = nodes.find((n) => n.id === 'search_papers')!;
		const end = nodes.find((n) => n.kind === 'end')!;
		expect(loop!.rank).toBeGreaterThan(tools.rank);
		expect(loop!.rank).toBeLessThan(end.rank);
	});

	it('marks an approving tool with the same glyph as a suspending step', () => {
		const { nodes } = agentTopology(shape());
		expect(nodes.find((n) => n.id === 'generate_image')?.canSuspend).toBe(true);
		expect(nodes.find((n) => n.id === 'search_papers')?.canSuspend).toBeFalsy();
	});

	it('draws memory only when there is memory', () => {
		expect(agentTopology(shape()).nodes.some((n) => n.id === '__memory')).toBe(false);
		expect(
			agentTopology(shape({ memory: { attached: true } })).nodes.some((n) => n.id === '__memory')
		).toBe(true);
	});

	it('spends no rank on processors it does not have', () => {
		// Today there are none configured. The drawing must not carry an empty
		// stage for them — a stage that exists and holds nothing reads as a stage
		// that ran and did nothing.
		const bare = agentTopology(shape());
		const withOne = agentTopology(shape({ processors: { input: ['moderation'], output: [] } }));
		expect(withOne.nodes.length).toBe(bare.nodes.length + 1);
		expect(withOne.nodes.find((n) => n.label === 'moderation')?.rank).toBe(1);
	});

	it('joins every node of a rank to every node of the next', () => {
		const { nodes, edges } = agentTopology(shape());
		const model = nodes.find((n) => n.id === MODEL_NODE)!;
		const fromModel = edges.filter((e) => e.from === MODEL_NODE);
		const toolCount = nodes.filter((n) => n.rank === model.rank + 1).length;
		// A fan-out drawn as a chain through whichever tool happened to be last
		// is the bug this guards.
		expect(fromModel).toHaveLength(toolCount);
	});

	it('reports the widest rank, which is how many things can be in flight', () => {
		expect(agentTopology(shape()).width).toBe(3);
	});
});
