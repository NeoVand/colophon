/**
 * A workflow's shape, laid out.
 *
 * Not a diagram anyone drew. The input is `workflow.serializedStepGraph` — the
 * topology the engine will actually execute — so when the pipeline changes, the
 * picture changes with it and cannot drift. That is the same rule harnessXray's
 * graph view keeps, reached by a different road: LangGraph publishes a compiled
 * node/edge graph, Mastra publishes a serialised step graph, and both are the
 * territory rather than a map of it.
 *
 * ── The three entry kinds, observed rather than assumed ─────────────────────
 * Read off a real build via `/lab/graph`, including a throwaway workflow built
 * purely to exercise the branches the real one does not use yet:
 *
 *   { type: 'step',        step: { id, description?, canSuspend } }
 *   { type: 'parallel',    steps: [ …entries ] }
 *   { type: 'conditional', steps: [ …entries ],
 *                          serializedConditions: [ { id, fn } ] }
 *
 * `fn` is the condition's **source text**, which is a gift: a branch can be
 * labelled with the predicate a person wrote rather than with "condition 1".
 *
 * Anything unrecognised becomes a single node of kind `other` rather than being
 * dropped, so a Mastra upgrade that adds a builder verb degrades to a visible
 * unknown instead of a silently shorter graph.
 */

export type NodeKind = 'start' | 'step' | 'end' | 'other';

export interface Node {
	id: string;
	label: string;
	kind: NodeKind;
	description?: string;
	/** True when the step can suspend — where a run can stop and wait for you. */
	canSuspend?: boolean;
	/** Column in the flow, from 0. Steps that run together share one. */
	rank: number;
	/** Position within the rank, for laying siblings out side by side. */
	lane: number;
	/** The predicate that guards this node, as its author wrote it. */
	when?: string;
}

export interface Edge {
	from: string;
	to: string;
	/** True when this edge is taken only if a condition holds. */
	conditional?: boolean;
}

export interface Topology {
	nodes: Node[];
	edges: Edge[];
	/** The widest rank — how many things can be in flight at once. */
	width: number;
}

interface Entry {
	type?: string;
	step?: { id?: string; description?: string; canSuspend?: boolean };
	steps?: Entry[];
	serializedConditions?: { id?: string; fn?: string }[];
}

/** `whenTrue-condition` → `whenTrue`, so a condition can find its step. */
function stepOfCondition(id: string | undefined): string {
	return (id ?? '').replace(/-condition$/, '');
}

/**
 * Serialised graph → nodes and edges, in ranks.
 *
 * Ranks rather than free positions: a workflow is a sequence of stages, some of
 * which hold several steps, and that is exactly a rank. Laying it out here
 * instead of in the component keeps the renderer to drawing, and lets the shape
 * be tested without a browser.
 */
export function readTopology(serialized: unknown, { id = 'workflow' } = {}): Topology {
	const entries = Array.isArray(serialized) ? (serialized as Entry[]) : [];

	const nodes: Node[] = [{ id: '__start', label: 'start', kind: 'start', rank: 0, lane: 0 }];
	const edges: Edge[] = [];

	// The ids at the previous rank, so a stage can be joined to all of them —
	// which is what makes a parallel fan-in draw correctly rather than as a
	// chain through whichever branch happened to be listed last.
	let previous = ['__start'];
	let rank = 1;

	for (const entry of entries) {
		const conditions = new Map(
			(entry.serializedConditions ?? []).map((c) => [stepOfCondition(c.id), c.fn ?? ''])
		);

		const children: Entry[] =
			entry.type === 'step' ? [entry] : Array.isArray(entry.steps) ? entry.steps : [];

		const made: Node[] = [];

		if (!children.length) {
			// An entry kind this does not know. Still occupies a stage, so it is
			// drawn — a graph that quietly omits a stage is worse than one that
			// admits it does not recognise it.
			made.push({
				id: `${id}:unknown-${rank}`,
				label: entry.type ?? 'unknown',
				kind: 'other',
				rank,
				lane: 0
			});
		} else {
			children.forEach((child, lane) => {
				const step = child.step ?? {};
				const stepId = step.id ?? `${entry.type}-${rank}-${lane}`;
				made.push({
					id: stepId,
					label: stepId,
					kind: child.type === 'step' ? 'step' : 'other',
					description: step.description,
					canSuspend: step.canSuspend,
					rank,
					lane,
					...(conditions.has(stepId) ? { when: conditions.get(stepId) } : {})
				});
			});
		}

		for (const node of made) {
			nodes.push(node);
			for (const from of previous) {
				edges.push({ from, to: node.id, ...(node.when ? { conditional: true } : {}) });
			}
		}

		previous = made.map((n) => n.id);
		rank++;
	}

	nodes.push({ id: '__end', label: 'end', kind: 'end', rank, lane: 0 });
	for (const from of previous) edges.push({ from, to: '__end' });

	const counts = new Map<number, number>();
	for (const node of nodes) counts.set(node.rank, (counts.get(node.rank) ?? 0) + 1);

	return { nodes, edges, width: Math.max(...counts.values(), 1) };
}
