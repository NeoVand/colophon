import { describe, it, expect } from 'vitest';
import { projectWorkflow, type WorkflowEvent } from './workflow-events';

/**
 * The fixtures below are **observed**, and where they are not, it says so.
 *
 * The chunk shapes were captured by running a small two-step workflow against
 * the installed `@mastra/core` 1.60.0 and printing every chunk `fullStream`
 * produced — which is how the three surprises in this feed were found:
 * `workflow-step-start` and `workflow-step-result` carry `startedAt`/`endedAt`
 * that the published type never mentions, `workflow-step-finish` never reaches
 * a consumer at all, and a failed step's `error` arrives as a live `Error`
 * instance, so `JSON.stringify` on it yields `{}`.
 *
 * Two things are *not* from a captured run and are marked where they appear:
 * the values inside `finalWorkflowResult`, which come from the deep-research
 * workflow's own `outputSchema` rather than from a keyed run, and the
 * `workflow-step-suspended` frame, which this pipeline has no step to produce
 * yet. Both are read defensively for that reason.
 */

const STEP_START = {
	type: 'workflow-step-start',
	runId: '0b17b26e-5b2a-4a34-9d3f-2b5a9c6d1e40',
	from: 'WORKFLOW',
	payload: {
		stepName: 'scope',
		id: 'scope',
		stepCallId: 'a1f0d2c4-4a1e-4c1b-9a44-7f0b6d2b3f11',
		payload: { question: 'Do sparse autoencoders recover monosemantic features?' },
		startedAt: 1_755_600_000_000,
		status: 'running'
	}
};

const STEP_RESULT = {
	type: 'workflow-step-result',
	runId: '0b17b26e',
	from: 'WORKFLOW',
	payload: {
		stepName: 'scope',
		id: 'scope',
		stepCallId: 'a1f0d2c4',
		payload: { question: 'Do sparse autoencoders recover monosemantic features?' },
		startedAt: 1_755_600_000_000,
		status: 'success',
		output: {
			question: 'Do sparse autoencoders recover monosemantic features?',
			plan: { queries: ['sparse autoencoder features'], angle: 'What the evidence supports.' }
		},
		endedAt: 1_755_600_004_200
	}
};

const STEP_FAILED = {
	type: 'workflow-step-result',
	runId: '0b17b26e',
	from: 'WORKFLOW',
	payload: {
		id: 'read',
		stepCallId: 'c3',
		status: 'failed',
		startedAt: 1_755_600_010_000,
		endedAt: 1_755_600_011_500,
		// A live Error, exactly as observed — which is why the projector reaches
		// for `.message` instead of forwarding the object.
		error: new Error('arXiv returned 503'),
		tripwire: undefined
	}
};

/*
 * Synthesised by `WorkflowRunOutput.close()` rather than published by the
 * engine. The envelope is captured; the three fields inside
 * `finalWorkflowResult` are the deep-research workflow's declared output.
 */
const WORKFLOW_FINISH = {
	type: 'workflow-finish',
	runId: '0b17b26e',
	from: 'WORKFLOW',
	payload: {
		workflowStatus: 'success',
		metadata: {},
		output: { usage: { inputTokens: 41_233, outputTokens: 3_180, totalTokens: 44_413 } },
		finalWorkflowResult: {
			answer: 'Sparse autoencoders recover partially monosemantic features (Lee et al., 2026).',
			citedIds: ['arxiv:2601.00042', 'arxiv:2602.11871'],
			papersRead: 3
		}
	}
};

/**
 * The chunk that would be the obvious one to key "a step finished" on, and is
 * the wrong one: `WorkflowRunOutput` filters it out before `fullStream`, so it
 * never reaches a consumer. It is here to hold the projector to ignoring it.
 */
const STEP_FINISH = {
	type: 'workflow-step-finish',
	runId: '0b17b26e',
	from: 'WORKFLOW',
	payload: { id: 'scope', metadata: {} }
};

describe('projectWorkflow', () => {
	it('names the step that started', () => {
		expect(projectWorkflow(STEP_START)).toEqual({
			k: 'step-start',
			step: 'scope',
			at: 1_755_600_000_000
		});
	});

	it('measures a step across the engine’s own two timestamps', () => {
		expect(projectWorkflow(STEP_RESULT)).toEqual({
			k: 'step-finish',
			step: 'scope',
			state: 'done',
			ms: 4_200
		});
	});

	it('keeps a failed step’s message and marks it failed', () => {
		const event = projectWorkflow(STEP_FAILED) as Extract<WorkflowEvent, { k: 'step-finish' }>;
		expect(event).toMatchObject({ state: 'failed', step: 'read', error: 'arXiv returned 503' });
	});

	it('reports the workflow’s own return value, not just its status', () => {
		expect(projectWorkflow(WORKFLOW_FINISH)).toEqual({
			k: 'workflow-done',
			status: 'success',
			usage: { input: 41_233, output: 3_180, total: 44_413 },
			answer: 'Sparse autoencoders recover partially monosemantic features (Lee et al., 2026).',
			citedIds: ['arxiv:2601.00042', 'arxiv:2602.11871'],
			papersRead: 3
		});
	});

	// Not from a captured run: no step in this pipeline suspends yet.
	it('closes a suspended step, which publishes no result of its own', () => {
		expect(
			projectWorkflow({
				type: 'workflow-step-suspended',
				payload: { id: 'select', status: 'suspended' }
			})
		).toEqual({ k: 'step-finish', step: 'select', state: 'suspended', ms: 0 });
	});

	it('ignores workflow-step-finish, which never reaches fullStream', () => {
		expect(projectWorkflow(STEP_FINISH)).toBeNull();
	});

	/*
	 * The projector is a filter before it is a translator. `workflow-step-output`
	 * republishes the entire nested agent feed — every text delta of every paper
	 * being read — and forwarding it would put megabytes on the wire to draw
	 * five rows.
	 */
	it('drops the noisy and the unknown rather than forwarding them', () => {
		for (const chunk of [
			{ type: 'workflow-start', payload: { workflowId: 'deep-research' } },
			{ type: 'workflow-step-output', payload: { output: { type: 'text-delta' } } },
			{ type: 'workflow-step-progress', payload: { id: 'read', completedCount: 1 } },
			{ type: 'something-mastra-adds-in-1.61', payload: {} },
			{ type: 'workflow-step-start', payload: {} },
			undefined,
			null,
			'not a chunk'
		]) {
			expect(projectWorkflow(chunk)).toBeNull();
		}
	});

	it('omits a duration it cannot measure rather than inventing one', () => {
		// `endedAt` absent: a duration from `startedAt` and a local clock would
		// mix two machines' time and could come out negative.
		expect(
			projectWorkflow({
				type: 'workflow-step-result',
				payload: { id: 'write', status: 'success', startedAt: 1_755_600_020_000 }
			})
		).toEqual({ k: 'step-finish', step: 'write', state: 'done', ms: 0 });
	});

	it('leaves a step running when Mastra reports a status it does not know', () => {
		expect(
			projectWorkflow({
				type: 'workflow-step-result',
				payload: { id: 'write', status: 'quantum-superposed' }
			})
		).toBeNull();
	});

	/*
	 * Observed: cancelling mid-run publishes `workflow-canceled` and then
	 * `workflow-finish`, back to back, both saying 'canceled'. Only the second
	 * is projected, so one ending produces one terminal event.
	 */
	it('lets workflow-finish be the single ending, even on a cancellation', () => {
		expect(projectWorkflow({ type: 'workflow-canceled', payload: {} })).toBeNull();
		expect(
			projectWorkflow({ type: 'workflow-finish', payload: { workflowStatus: 'canceled' } })
		).toEqual({ k: 'workflow-done', status: 'canceled', usage: { input: 0, output: 0, total: 0 } });
	});

	it('survives a finish with nothing in it', () => {
		expect(projectWorkflow({ type: 'workflow-finish', payload: {} })).toEqual({
			k: 'workflow-done',
			status: 'success',
			usage: { input: 0, output: 0, total: 0 }
		});
	});
});
