import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColophonEvent } from './events';

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
const { respond } = vi.hoisted(() => ({ respond: vi.fn() }));
vi.mock('./stream-client', () => ({ run: vi.fn(), respond }));

const { Session } = await import('./session.svelte');

type Handlers = { onEvent: (e: ColophonEvent) => void; onError: (m: string) => void };

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
