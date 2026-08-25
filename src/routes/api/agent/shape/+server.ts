import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createColophon } from '$lib/agent/colophon';
import { subagentOf } from '$lib/agent/events';
import { isStorageConfigured } from '$lib/server/storage';
import type { AgentShape } from '$lib/agent/agent-topology';

/**
 * The agent, asked what it is.
 *
 * `/api/graph` publishes the research workflow's step graph; this is the other
 * subject the graph panel draws, and the one it draws during an ordinary
 * conversation. Everything below comes from Mastra's own accessors on the agent
 * that will serve the next request — never from the factories it was built out
 * of, and never from a list kept by hand.
 *
 * That distinction has already cost this project once. The tools panel used to
 * add up what the tool factories returned; it imported one of the three and
 * never called it, and it could not see the four tools Mastra *mints* — the
 * `agent-<key>` delegation and the three `skill*` tools. It reported six tools
 * and 5,900 characters against a real twelve and 13,306, and the largest single
 * line item was the one it had declared uncountable. Anything assembled from
 * parts drifts from the thing it describes; only the thing itself does not.
 *
 * ── What was measured, and what it said ─────────────────────────────────────
 * Probed against @mastra/core 1.60.0 with the built agent rather than read from
 * the docs:
 *
 *   getModel()                        → { modelId: 'gpt-5', provider:
 *                                         'openai.responses', … }
 *   listAgents()                      → { paperReader: Agent }
 *   listSkills()                      → [{ name, description, path, … }]
 *   getMemory()                       → undefined with no thread, so this route
 *                                       takes one; without it the drawing would
 *                                       always say the agent has no memory.
 *   listConfiguredInputProcessors()   → [] — none configured today. Drawn the
 *   listConfiguredOutputProcessors()  → [] day one is, with no edit here.
 *   getToolsForExecution({})          → the twelve, in send order.
 *
 * Building the agent is cheap and key-free: factories and closures, nothing
 * touching the network until a tool executes. Gating is `hooks.server.ts`'s job.
 */

/** The converted tool, as it will go on the wire. See `/api/tools` for the rest. */
interface Sent {
	description?: string;
	requireApproval?: unknown;
	needsApprovalFn?: unknown;
}

export const GET: RequestHandler = async ({ url }) => {
	/*
	 * The thread matters. `getMemory()` returns undefined when the agent was
	 * built without one — memory attaches only where there is somewhere to keep
	 * it — so a shape fetched without a thread would draw an agent that cannot
	 * remember, for an app whose whole memory story is that it can.
	 */
	const thread = url.searchParams.get('thread') ?? undefined;

	const { agent } = (await createColophon({ thread })) as unknown as {
		agent: {
			name: string;
			id?: string;
			getModel(): Promise<{ modelId?: string; provider?: string }>;
			getToolsForExecution(c: object): Promise<Record<string, Sent>>;
			listAgents(): Promise<Record<string, { name?: string }>>;
			listSkills(): Promise<{ name?: string; description?: string }[]>;
			listScorers(): Promise<Record<string, unknown>>;
			getMemory(): Promise<unknown>;
			listConfiguredInputProcessors(): Promise<{ name?: string; id?: string }[]>;
			listConfiguredOutputProcessors(): Promise<{ name?: string; id?: string }[]>;
		};
	};

	const [model, sent, subagents, skills, scorers, memory, inputs, outputs] = await Promise.all([
		agent.getModel(),
		agent.getToolsForExecution({}),
		agent.listAgents(),
		agent.listSkills(),
		agent.listScorers(),
		agent.getMemory(),
		agent.listConfiguredInputProcessors(),
		agent.listConfiguredOutputProcessors()
	]);

	/** `agent-paperReader` → `Paper reader`, from the registered agent's own name. */
	const displayName = (id: string): string | undefined => {
		const key = id.match(/^agent-(.+)$/)?.[1];
		if (!key) return undefined;
		// The agent's own `name` where it has one, and otherwise the same
		// de-camelling the event timeline uses, so one delegation is not called
		// two different things in two panels.
		return subagents[key]?.name ?? subagentOf(id);
	};

	const named = (p: { name?: string; id?: string }, i: number) =>
		p.name ?? p.id ?? `processor ${i}`;

	const shape: AgentShape = {
		id: agent.id ?? 'colophon',
		name: agent.name,
		model: { id: model.modelId ?? 'unknown', provider: model.provider ?? 'unknown' },
		tools: Object.entries(sent).map(([id, tool]) => ({
			id,
			description: tool.description,
			...(displayName(id) ? { subagent: displayName(id) } : {}),
			// A flag or a per-call predicate: this reads "can pause", not "will
			// pause every time", which is the honest claim.
			approval: Boolean(tool.requireApproval) || Boolean(tool.needsApprovalFn)
		})),
		skills: skills.map((s) => ({ name: s.name ?? 'skill', description: s.description })),
		scorers: Object.keys(scorers),
		memory: {
			attached: Boolean(memory),
			note: memory
				? 'Resource-scoped: what it learns about the reader outlives this conversation.'
				: isStorageConfigured()
					? 'No thread on this request, so nothing is being remembered.'
					: 'DATABASE_URL is not set, so there is nowhere to remember.'
		},
		processors: { input: inputs.map(named), output: outputs.map(named) }
	};

	return json(shape);
};
