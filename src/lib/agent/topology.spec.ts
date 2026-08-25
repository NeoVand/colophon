import { describe, it, expect } from 'vitest';
import { readTopology } from './topology';

/**
 * Both fixtures are real output from `workflow.serializedStepGraph`, captured
 * via `/lab/graph` — the linear one from the actual research pipeline, the
 * branching one from a throwaway workflow built purely to make `.parallel()`
 * and `.branch()` show their shapes. Nothing here is written from documentation.
 */

const LINEAR = [
	{
		type: 'step',
		step: { id: 'scope', description: 'Turn the question into searches.', canSuspend: false }
	},
	{
		type: 'step',
		step: { id: 'search', description: 'Run every planned search.', canSuspend: false }
	},
	{
		type: 'step',
		step: { id: 'select', description: 'Choose what is worth opening.', canSuspend: false }
	},
	{
		type: 'step',
		step: { id: 'read', description: 'Read each in its own window.', canSuspend: false }
	},
	{ type: 'step', step: { id: 'write', description: 'Write the answer.', canSuspend: false } }
];

const BRANCHING = [
	{ type: 'step', step: { id: 'first', canSuspend: false } },
	{
		type: 'parallel',
		steps: [
			{ type: 'step', step: { id: 'left', canSuspend: false } },
			{ type: 'step', step: { id: 'right', canSuspend: false } }
		]
	},
	{
		type: 'conditional',
		steps: [
			{ type: 'step', step: { id: 'whenTrue', canSuspend: false } },
			{ type: 'step', step: { id: 'whenFalse', canSuspend: false } }
		],
		serializedConditions: [
			{ id: 'whenTrue-condition', fn: 'async () => true' },
			{ id: 'whenFalse-condition', fn: 'async () => false' }
		]
	}
];

describe('a linear pipeline', () => {
	it('reads as start, one step per rank, end', () => {
		const { nodes, width } = readTopology(LINEAR);
		expect(nodes.map((n) => n.id)).toEqual([
			'__start',
			'scope',
			'search',
			'select',
			'read',
			'write',
			'__end'
		]);
		expect(width).toBe(1);
	});

	it('chains each step to the next, and nothing else', () => {
		const { edges } = readTopology(LINEAR);
		expect(edges).toHaveLength(6);
		expect(edges[0]).toEqual({ from: '__start', to: 'scope' });
		expect(edges.at(-1)).toEqual({ from: 'write', to: '__end' });
	});

	it('keeps the step description, which is the label a person reads', () => {
		const read = readTopology(LINEAR).nodes.find((n) => n.id === 'read');
		expect(read?.description).toBe('Read each in its own window.');
	});
});

describe('parallel and conditional', () => {
	it('puts siblings on one rank in separate lanes', () => {
		const { nodes, width } = readTopology(BRANCHING);
		const left = nodes.find((n) => n.id === 'left');
		const right = nodes.find((n) => n.id === 'right');
		expect(left?.rank).toBe(right?.rank);
		expect(left?.lane).toBe(0);
		expect(right?.lane).toBe(1);
		expect(width).toBe(2);
	});

	/**
	 * The bug an "edge to the last sibling" implementation would ship: a fan-in
	 * that only joins one branch, drawing a chain where the engine runs a
	 * barrier.
	 */
	it('joins every branch of a rank to every node of the next', () => {
		const { edges } = readTopology(BRANCHING);
		const intoTrue = edges.filter((e) => e.to === 'whenTrue').map((e) => e.from);
		expect(intoTrue.sort()).toEqual(['left', 'right']);
	});

	it('labels a conditional edge with the predicate its author wrote', () => {
		const { nodes, edges } = readTopology(BRANCHING);
		expect(nodes.find((n) => n.id === 'whenTrue')?.when).toBe('async () => true');
		expect(edges.find((e) => e.to === 'whenFalse')?.conditional).toBe(true);
	});

	it('does not mark an unconditional edge as conditional', () => {
		const { edges } = readTopology(BRANCHING);
		expect(edges.find((e) => e.to === 'left')?.conditional).toBeUndefined();
	});
});

describe('degrading honestly', () => {
	it('draws an unrecognised entry kind rather than dropping the stage', () => {
		const { nodes } = readTopology([
			{ type: 'step', step: { id: 'a' } },
			{ type: 'someFutureVerb' }
		]);
		const unknown = nodes.find((n) => n.kind === 'other');
		expect(unknown?.label).toBe('someFutureVerb');
		// start, a, unknown, end — the stage is still there.
		expect(nodes).toHaveLength(4);
	});

	it('survives a missing or malformed graph', () => {
		for (const input of [null, undefined, {}, 'nope', []]) {
			expect(() => readTopology(input)).not.toThrow();
		}
		const empty = readTopology([]);
		expect(empty.nodes.map((n) => n.kind)).toEqual(['start', 'end']);
		expect(empty.edges).toEqual([{ from: '__start', to: '__end' }]);
	});

	it('names a step that arrived without an id, rather than keying on undefined', () => {
		const { nodes } = readTopology([{ type: 'parallel', steps: [{ type: 'step', step: {} }] }]);
		expect(nodes[1].id).toBeTruthy();
		expect(nodes[1].id).not.toContain('undefined');
	});
});
