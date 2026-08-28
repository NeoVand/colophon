import type { Node, Topology } from './topology';

/**
 * The agent's own shape, laid out — the loop, not a workflow.
 *
 * ── The decision this file records ──────────────────────────────────────────
 * The graph panel used to draw the **research workflow's** step graph, always,
 * including during ordinary conversations. The chat agent never executes that
 * workflow, so in every normal run the picture was of something that was not
 * happening, and its "which node is lit" was computed by matching tool-call
 * names against workflow step ids — names that can never match. It was dead by
 * construction, and no amount of polish on the drawing would have changed that.
 *
 * The fix is not to pick one of the two subjects. It is that **the panel draws
 * whichever machine is actually running**: the workflow when the deep-research
 * pipeline is in flight, and this — the agent loop — the rest of the time.
 * Both readings come from the live system. `readTopology` reads
 * `serializedStepGraph`, the topology the engine will execute; this reads what
 * the built agent answers when you ask it what it has.
 *
 * ── Why a loop needs its own reader at all ──────────────────────────────────
 * LangGraph compiles a graph you can read back, which is what makes
 * harnessXray's `getGraphAsync({ xray: true })` possible. A Mastra agent has no
 * compiled topology: it is a loop, and the loop is in the framework rather than
 * in any object you can serialise. So the shape below is assembled here — but
 * every part of it is *measured*, from `getModel()`, `getToolsForExecution()`,
 * `listAgents()`, `listSkills()` and `getMemory()` on the agent that will serve
 * the next request. Add a tool and a box appears; take the memory away and its
 * node goes. Nothing here is a list anybody maintains by hand, which is the
 * only property that matters.
 *
 * Pure: no Mastra, no fetch. The endpoint measures, this arranges, the view
 * draws.
 */

/** What `/api/agent/shape` reports. Every field is read off the built agent. */
export interface AgentShape {
	id: string;
	name: string;
	/** As the provider will see it — `gpt-5`, `openai.responses`. */
	model: { id: string; provider: string };
	/**
	 * Everything the model is shown on every call, including the four Mastra
	 * mints for itself: `agent-<key>` for a subagent and the three `skill*` tools
	 * once skills are attached.
	 */
	tools: {
		id: string;
		description?: string;
		/** Set when this tool is a delegation, holding the subagent's display name. */
		subagent?: string;
		/** True when the call pauses for a human before it runs. */
		approval?: boolean;
	}[];
	skills: { name: string; description?: string }[];
	scorers: string[];
	/** Whether this request has somewhere to remember, and at what scope. */
	memory: { attached: boolean; note?: string };
	/** Configured processors, by name. Empty today; drawn the moment they are not. */
	processors: { input: string[]; output: string[] };
}

/** The id of the model node, so a caller can special-case it without a string. */
export const MODEL_NODE = '__model';
/** The id of the row that says the loop goes round. */
export const LOOP_NODE = '__loop';

/**
 * A shape → a drawing, in the same rank-and-lane form a workflow produces.
 *
 * Sharing `Topology` with `readTopology` is what lets one `GraphView` draw both
 * subjects. The ranks read down the page:
 *
 *   start          the question
 *   [context]      memory and any input processors — what is assembled before
 *                  the model is called at all
 *   model          the loop's centre, labelled with the model that will serve it
 *   tools          everything the model may reach for, side by side because it
 *                  chooses between them rather than running them in order
 *   loop           the return: back to the model while it keeps calling tools
 *   [output]       output processors, which are the only thing that can refuse
 *   end            the answer
 *
 * The tool rank is deliberately one rank however many tools there are. Twelve
 * boxes across is a lot, and the alternative — splitting them over several
 * ranks to fit — would say they run in an order, which is exactly the false
 * claim this panel exists not to make.
 */
export function agentTopology(shape: AgentShape): Topology {
	const nodes: Node[] = [{ id: '__start', label: 'you ask', kind: 'start', rank: 0, lane: 0 }];
	let rank = 1;

	/** Adds a rank of nodes and returns their ids, or advances nothing if empty. */
	const rankOf = (made: Omit<Node, 'rank' | 'lane'>[]): void => {
		if (!made.length) return;
		made.forEach((node, lane) => nodes.push({ ...node, rank, lane }));
		rank++;
	};

	rankOf([
		...(shape.memory.attached
			? [
					{
						id: '__memory',
						label: 'memory',
						kind: 'other' as const,
						description:
							shape.memory.note ??
							'Recalled and re-attached before the model is called, not fetched by a tool.'
					}
				]
			: []),
		...shape.processors.input.map((name) => ({
			id: `in:${name}`,
			label: name,
			kind: 'other' as const,
			description: 'Input processor — runs before the model sees the turn.'
		}))
	]);

	rankOf([
		{
			id: MODEL_NODE,
			label: shape.model.id,
			kind: 'step',
			description: `${shape.name} · ${shape.model.provider}. Every call goes through model(), which is what keeps the wire observable.`
		}
	]);

	rankOf(
		shape.tools.map((tool) => ({
			// The id is the tool's real name because that is what a `tool-call`
			// event carries — which is the whole reason this panel can light up and
			// the workflow drawing could not.
			id: tool.id,
			label: tool.subagent ?? tool.id,
			kind: 'step' as const,
			description: tool.description,
			// Reuses the workflow drawing's amber mark for "this can stop and wait
			// for you". A tool behind `requireApproval` and a step that can suspend
			// are the same fact about a run, so they get the same glyph.
			canSuspend: tool.approval
		}))
	);

	rankOf([
		{
			id: LOOP_NODE,
			label: 'back to the model, while it keeps calling tools',
			kind: 'loop'
		}
	]);

	rankOf(
		shape.processors.output.map((name) => ({
			id: `out:${name}`,
			label: name,
			kind: 'other' as const,
			description: 'Output processor — the only thing here that can refuse a result.'
		}))
	);

	nodes.push({ id: '__end', label: 'answer', kind: 'end', rank, lane: 0 });

	/*
	 * Edges join every node of a rank to every node of the next, exactly as
	 * `readTopology` does for a parallel stage — so a fan-out and its fan-in
	 * draw correctly rather than as a chain through whichever node came last.
	 */
	const edges = [];
	const byRank = new Map<number, Node[]>();
	for (const node of nodes) {
		const row = byRank.get(node.rank);
		if (row) row.push(node);
		else byRank.set(node.rank, [node]);
	}
	const ranks = [...byRank.keys()].sort((a, b) => a - b);
	for (let i = 1; i < ranks.length; i++) {
		for (const from of byRank.get(ranks[i - 1])!) {
			for (const to of byRank.get(ranks[i])!) edges.push({ from: from.id, to: to.id });
		}
	}

	return {
		nodes,
		edges,
		width: Math.max(...[...byRank.values()].map((r) => r.length), 1)
	};
}
