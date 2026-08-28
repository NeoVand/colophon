import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColophonEvent } from './events';
import type { WorkflowEvent } from './workflow-events';
import type { TraceSpan } from './trace';

/**
 * The approval slot, which is where a real run came apart.
 *
 * Asked for two infographics, Colophon requested `generate_image`, suspended
 * for approval, was approved — and then, while that resume stream was still
 * being read, requested a *second* `generate_image` and suspended again. The
 * second approval landed in `turn.approval` mid-stream, and the line that ran
 * after the stream cleared the slot unconditionally. So the card vanished, the
 * composer re-enabled, and the run sat suspended on a server nothing on screen
 * could reach. Approving from the card still in the DOM sent the *first* id
 * back and produced the error the reader actually saw:
 *
 *     resumeStream() cannot resume tool call "call_…" because it is not suspended
 *
 * These tests drive `decide()` against a fake transport that reproduces that
 * interleaving exactly, because it is not reachable any other way — it needs a
 * resume stream that suspends again before it ends.
 */

/*
 * `vi.hoisted`, not a bare `const` above `vi.mock`.
 *
 * `vi.mock` is hoisted to the top of the module, so a spy declared with `const`
 * and then referenced through a forwarding wrapper inside the factory is a
 * different function from the one the tests configure — calls arrived with no
 * arguments at all. `vi.hoisted` runs before the mock and hands the *same* spy
 * to both sides.
 */
const { respond, run, research } = vi.hoisted(() => ({
	respond: vi.fn(),
	run: vi.fn(),
	research: vi.fn()
}));
vi.mock('./stream-client', () => ({ run, respond, research }));

const { Session } = await import('./session.svelte');

type Handlers = { onEvent: (e: ColophonEvent) => void; onError: (m: string) => void };
type ResearchHandlers = {
	onEvent: (e: WorkflowEvent) => void;
	onReady?: (ms: number, data: unknown) => void;
};

const approval = (id: string): ColophonEvent =>
	({ k: 'approval', runId: 'run-1', id, name: 'generate_image', args: {} }) as ColophonEvent;

function seed() {
	const session = new Session();
	session.turns.push({ role: 'colophon', text: '', tools: [] });
	const turn = session.turns[session.turns.length - 1];
	turn.approval = { runId: 'run-1', id: 'call_one', name: 'generate_image', args: {} };
	session.status = 'waiting';
	return { session, turn };
}

describe('deciding an approval', () => {
	/*
	 * Reset *and* re-arm. A bare `mockReset()` leaves the spy with no
	 * implementation at all, and the tests below then interleaved badly enough
	 * that a call arrived with no arguments — passing alone, failing in sequence,
	 * which is the signature of shared mock state rather than of a real defect.
	 * A no-op default plus `mockImplementationOnce` per test keeps each one
	 * independent and makes the expected number of calls explicit.
	 */
	beforeEach(() => {
		respond.mockReset();
		respond.mockImplementation(async () => {});
	});

	it('sends the id of the call actually on screen', async () => {
		const { session, turn } = seed();
		await session.decide(turn, true);

		expect(respond).toHaveBeenCalledWith(
			expect.objectContaining({ runId: 'run-1', toolCallId: 'call_one', approve: true })
		);
	});

	it('clears the slot and goes idle when nothing else suspended', async () => {
		const { session, turn } = seed();
		await session.decide(turn, true);

		expect(turn.approval).toBeUndefined();
		expect(session.status).toBe('idle');
	});

	it('keeps a second approval that arrives during the resume stream', async () => {
		const { session, turn } = seed();
		// The interleaving from the real run: the resumed call finishes, the model
		// asks for another figure, and that one suspends before this stream ends.
		respond.mockImplementationOnce(async ({ onEvent }: Handlers) => {
			onEvent(approval('call_two'));
		});

		await session.decide(turn, true);

		expect(turn.approval?.id).toBe('call_two');
		// Still waiting on a person, so the composer must stay shut.
		expect(session.status).toBe('waiting');
	});

	it('offers the second call as decidable rather than stranding the run', async () => {
		const { session, turn } = seed();
		respond.mockImplementationOnce(async ({ onEvent }: Handlers) => {
			onEvent(approval('call_two'));
		});
		await session.decide(turn, true);

		respond.mockImplementationOnce(async () => {});
		await session.decide(turn, true);

		// The second decision must carry the second id. Sending `call_one` again is
		// precisely the "not suspended" error, because it had already been resumed.
		expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ toolCallId: 'call_two' }));
		expect(turn.approval).toBeUndefined();
		expect(session.status).toBe('idle');
	});

	it('re-enables the card when a decision fails', async () => {
		const { session, turn } = seed();
		respond.mockImplementationOnce(async ({ onError }: Handlers) => {
			onError('resumeStream() cannot resume tool call "call_one" because it is not suspended.');
		});

		await session.decide(turn, true);

		// A decision that did not go through has not been made: the buttons have to
		// come back, or a reload is the only way out.
		expect(turn.error).toMatch(/not suspended/);
		expect(turn.approval?.deciding ?? false).toBe(false);
	});

	it('ignores a second click while a decision is in flight', async () => {
		const { session, turn } = seed();
		let release!: () => void;
		respond.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));

		const first = session.decide(turn, true);
		await session.decide(turn, true);
		release();
		await first;

		expect(respond).toHaveBeenCalledTimes(1);
	});
});

/**
 * The composer's "deep research" toggle, which was bound to nothing.
 *
 * `/api/research` existed, the workflow existed, and the three panels that draw
 * it existed — and no client code called any of it. Toggling the mode moved a
 * chip and changed nothing else, which is *why* the workflow, graph and trace
 * panels were dead: the pipeline they describe was never run by the application.
 *
 * Every test below fails if `send` stops routing on the mode.
 */
describe('a research turn', () => {
	beforeEach(() => {
		run.mockReset();
		run.mockImplementation(async () => {});
		research.mockReset();
		research.mockImplementation(async () => {});
	});

	const stream = (...events: WorkflowEvent[]) =>
		research.mockImplementationOnce(async ({ onReady, onEvent }: ResearchHandlers) => {
			onReady?.(12, { runId: 'wf-1', workflowId: 'deep-research' });
			for (const event of events) onEvent(event);
		});

	it('gives the question to the pipeline, not to the agent loop', async () => {
		const session = new Session();
		await session.send('what changed in retrieval this year?', 'research');

		expect(research).toHaveBeenCalledWith(
			expect.objectContaining({ question: 'what changed in retrieval this year?' })
		);
		expect(run).not.toHaveBeenCalled();
		expect(session.mode).toBe('research');
	});

	it('still gives an ordinary turn to the agent loop', async () => {
		const session = new Session();
		await session.send('hello');

		expect(run).toHaveBeenCalledTimes(1);
		expect(research).not.toHaveBeenCalled();
		expect(session.mode).toBe('chat');
	});

	it('collects the stage events the pipeline panel folds against the topology', async () => {
		stream(
			{ k: 'step-start', step: 'scope', at: 1000 },
			{ k: 'step-finish', step: 'scope', state: 'done', ms: 900 }
		);
		const session = new Session();
		await session.send('q', 'research');

		expect(session.workflow).toHaveLength(2);
		// And on the shared timeline, so the event log does not sit blank for the
		// whole of a five-minute run.
		expect(session.events.map((e) => e.event.k)).toContain('stage');
	});

	it('makes the answer the turn, and takes the workflow at its word on tokens', async () => {
		stream({
			k: 'workflow-done',
			status: 'success',
			usage: { input: 40_000, output: 3_000, total: 43_000 },
			answer: 'Three papers disagree about reranking.',
			citedIds: ['2401.00001'],
			papersRead: 3
		});
		const session = new Session();
		await session.send('q', 'research');

		const turn = session.turns[session.turns.length - 1];
		expect(turn.text).toBe('Three papers disagree about reranking.');
		expect(turn.usage).toEqual({
			input: 40_000,
			output: 3_000,
			total: 43_000,
			reasoning: 0,
			cached: 0
		});
		expect(session.status).toBe('idle');
	});

	it('says so when the pipeline ends without an answer', async () => {
		stream({
			k: 'workflow-done',
			status: 'failed',
			usage: { input: 0, output: 0, total: 0 },
			error: 'arXiv refused every query'
		});
		const session = new Session();
		await session.send('q', 'research');

		expect(session.turns[session.turns.length - 1].error).toBe('arXiv refused every query');
	});

	it('keeps the trace frames that ride on the same stream out of the pipeline', async () => {
		/*
		 * The failure this test is named after, seen on a real run. `/api/research`
		 * sends the pipeline's stages *and* the trace on one `event` channel — the
		 * right design, a reader should have one stream — but the reducer took
		 * every frame for a stage. A `trace` frame was pushed into `workflow`,
		 * drawn as a sixth nameless stage, and then fell through to the branch
		 * that reads `event.usage.input`, which threw. `consume` caught the throw
		 * and put it on screen in place of the answer:
		 *
		 *     Cannot read properties of undefined (reading 'input')
		 */
		stream(
			{ k: 'trace', configured: true } as never,
			{
				k: 'span',
				span: { id: 'a', name: 'deep-research', kind: 'workflow_run', startedAt: 1 }
			} as never,
			{ k: 'step-start', step: 'scope', at: 1 }
		);
		const session = new Session();
		await session.send('q', 'research');

		const turn = session.turns[session.turns.length - 1];
		expect(turn.error).toBeUndefined();
		expect(session.workflow).toEqual([{ k: 'step-start', step: 'scope', at: 1 }]);
		expect(session.spans).toHaveLength(1);
		expect(session.tracing.configured).toBe(true);
	});

	it('drops a frame kind it does not know rather than reading fields off it', async () => {
		stream({ k: 'something-new' } as never);
		const session = new Session();
		await session.send('q', 'research');

		expect(session.turns[session.turns.length - 1].error).toBeUndefined();
	});

	it('does not carry the last run marks into the next one', async () => {
		stream({ k: 'step-finish', step: 'scope', state: 'done', ms: 10 });
		const session = new Session();
		await session.send('one', 'research');
		stream({ k: 'step-start', step: 'scope', at: 5 });
		await session.send('two', 'research');

		// A `done` mark from the previous question beside this one's `running`
		// mark is a straightforwardly false readout of the pipeline.
		expect(session.workflow).toEqual([{ k: 'step-start', step: 'scope', at: 5 }]);
	});
});

/** The spans the trace panel draws, which arrive on the same channel. */
describe('the trace, as the browser holds it', () => {
	const span = (id: string, endedAt?: number): TraceSpan => ({
		id,
		name: id,
		kind: 'tool_call',
		startedAt: 1000,
		...(endedAt ? { endedAt } : {})
	});

	it('upserts a span rather than filing it twice', async () => {
		run.mockReset();
		run.mockImplementationOnce(async ({ onEvent }: { onEvent: (e: ColophonEvent) => void }) => {
			onEvent({ k: 'span', span: span('a') });
			onEvent({ k: 'span', span: span('a', 2000) });
		});

		const session = new Session();
		await session.send('hi');

		expect(session.spans).toHaveLength(1);
		expect(session.spans[0].endedAt).toBe(2000);
	});

	it('keeps spans off the timeline, which already has a row for that work', async () => {
		run.mockReset();
		run.mockImplementationOnce(async ({ onEvent }: { onEvent: (e: ColophonEvent) => void }) => {
			onEvent({ k: 'trace', configured: true });
			onEvent({ k: 'span', span: span('a') });
		});

		const session = new Session();
		await session.send('hi');

		expect(session.events).toHaveLength(0);
		expect(session.tracing.configured).toBe(true);
	});

	it('starts by assuming nothing is being recorded', () => {
		// The panel used to default the other way and so reported tracing as on
		// and idle when it was not wired at all.
		expect(new Session().tracing.configured).toBe(false);
	});
});
