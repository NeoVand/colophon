import { addUsage, type ColophonEvent, type Usage, type XrayEvent } from './events';
import { run, respond, research } from './stream-client';
import { absorb, absorbPapers, type KnownPaper } from './library';
import type { WorkflowEvent } from './workflow-events';
import type { TraceSpan } from './trace';

/**
 * The run, as the browser holds it.
 *
 * Lifted out of the page component on purpose. The conversation and the X-ray
 * are two readings of one stream, and if the conversation owns the state then
 * every panel has to be handed a copy of it — which is how a "live" panel ends
 * up one render behind the thing it claims to be observing.
 *
 * ── The rule this file exists to keep ───────────────────────────────────────
 * **Nothing is passed into the agent to make the X-ray work.** The library
 * below is reconstructed from the tool results the run already publishes, not
 * from a side channel the agent was asked to fill in. That constraint is
 * inherited from harnessXray and it is the whole pedagogy: a readout of what
 * did happen teaches more than a diagram of what should. It is also the reason
 * every panel keeps working when the agent changes.
 */

export interface ToolRun {
	id: string;
	name: string;
	/** Present when this call was a delegation, holding the subagent's name. */
	subagent?: string;
	args: unknown;
	result?: unknown;
	failed?: boolean;
	done: boolean;
	startedAt: number;
	endedAt?: number;
}

export interface Turn {
	role: 'you' | 'colophon';
	text: string;
	/** Set while the model is reasoning and this turn has no text yet. */
	thinking?: boolean;
	tools: ToolRun[];
	usage?: Usage;
	error?: string;
	/**
	 * A tool call waiting on the reader.
	 *
	 * Held on the turn rather than in a modal: the decision belongs beside the
	 * work that prompted it, and a dialog covering the conversation makes it
	 * harder to judge whether the brief is right.
	 */
	approval?: { runId: string; id: string; name: string; args: unknown; deciding?: boolean };
}

/** Which of the two machines a turn was given to. */
export type Mode = 'chat' | 'research';

/** One event, kept for the timeline with the two facts a timeline needs. */
export interface LoggedEvent {
	seq: number;
	/** Milliseconds since this run began. */
	at: number;
	/** Which turn it belongs to, so a click can scroll to the right place. */
	turn: number;
	event: ColophonEvent;
}

const ZERO: Usage = { input: 0, output: 0, total: 0, reasoning: 0, cached: 0 };

/**
 * Exported for tests only — the app uses the `session` singleton at the bottom.
 * A second live instance would be a second conversation with the same storage.
 */
export class Session {
	turns = $state<Turn[]>([]);
	events = $state<LoggedEvent[]>([]);
	status = $state<'idle' | 'running' | 'waiting'>('idle');
	thread = $state('');

	/** Everything retrieved this session, newest first in insertion order. */
	papers = $state<KnownPaper[]>([]);

	/** The current run's id, once the server has told us. */
	runId = $state('');

	/**
	 * Which machine the run in progress — or the last one — was given to.
	 *
	 * Held here rather than in the composer because half the X-ray depends on it:
	 * the graph draws the agent loop for a chat turn and the pipeline for a
	 * research turn, and the workflow panel is only in flight for the second.
	 * A panel that has to ask the composer what is running is a panel that will
	 * be one render behind it.
	 */
	mode = $state<Mode>('chat');

	/**
	 * The research pipeline's own events, oldest first.
	 *
	 * A separate list rather than a filter over `events`, because these are what
	 * `WorkflowPanel` folds against the topology and it should not have to
	 * re-derive them out of a mixed log. They are *also* logged onto the timeline
	 * as `stage` events — the same facts, in the two places each is read.
	 */
	workflow = $state<WorkflowEvent[]>([]);

	/**
	 * The run's latency, span by span, as the server measured it.
	 *
	 * Upserted by id: a span arrives once when it opens and again when it closes,
	 * so the flame chart can grow a bar while the work is still going. Both
	 * endpoints stamp them from their own clock — see the note on `k: 'span'`.
	 */
	spans = $state<TraceSpan[]>([]);

	/**
	 * Whether the server is recording spans at all.
	 *
	 * Starts `false` rather than `true`. The trace panel used to default the
	 * opposite way and so reported tracing as on and idle when it was simply not
	 * wired — a blank panel that claims to be a working instrument is the exact
	 * failure this X-ray exists to avoid.
	 */
	tracing = $state<{ configured: boolean; reason?: string; truncated?: boolean }>({
		configured: false
	});

	/**
	 * The most recent outgoing request, decomposed.
	 *
	 * One value rather than a history: the question the panel answers is "what
	 * is in the window *now*", and keeping every call's decomposition for a
	 * twelve-call research turn would hold a dozen copies of a growing
	 * conversation in the browser to show one of them.
	 */
	context = $state<Extract<ColophonEvent, { k: 'context' }> | undefined>();

	/**
	 * The input tokens billed for the request `context` describes — not the
	 * turn's running total.
	 *
	 * These are different numbers and using the wrong one is a quiet lie. A turn
	 * makes many provider calls; `turn.usage.input` is their *sum*, while
	 * `context` is one call's request. Apportioning a cumulative total across a
	 * single request's bands inflates every row, and the panel showed exactly
	 * that before this existed.
	 *
	 * The pairing is exact because of the order the endpoint emits in: the
	 * context for call N is sent when call N's first chunk arrives, and call N's
	 * `step-finish` follows before call N+1 begins. So the next `step` after a
	 * `context` is always that context's own call.
	 */
	contextTokens = $state(0);

	#seq = 0;
	#startedAt = 0;
	#controller: AbortController | undefined;

	/** Total spend across every turn in this conversation. */
	get usage(): Usage {
		return this.turns.reduce((sum, t) => (t.usage ? addUsage(sum, t.usage) : sum), ZERO);
	}

	get busy(): boolean {
		return this.status !== 'idle';
	}

	/**
	 * Restore or mint the conversation id.
	 *
	 * localStorage rather than component state so a reload rejoins the same
	 * conversation instead of silently starting a new one — losing a thread to a
	 * refresh is a worse surprise than any amount of tidiness.
	 */
	restore(): void {
		const existing = localStorage.getItem('colophon:thread');
		this.thread = existing ?? crypto.randomUUID();
		if (!existing) localStorage.setItem('colophon:thread', this.thread);
	}

	/**
	 * Switch to a conversation that already exists.
	 *
	 * The turns are deliberately **not** replayed into the view. Mastra holds
	 * the thread's messages server-side and the agent will have them on the next
	 * send, so the conversation continues correctly — but re-rendering the
	 * history here would mean re-deriving the library, the events and the spend
	 * from turns that were streamed hours ago and are no longer in this store.
	 * Showing a stale X-ray beside a live conversation is worse than showing an
	 * empty one, so the panels reset and say nothing rather than something wrong.
	 *
	 * That is a real limitation and it is written down rather than hidden: a
	 * transcript view is a separate feature, and it belongs in the vault.
	 */
	open(id: string): void {
		if (!id || id === this.thread) return;
		this.thread = id;
		localStorage.setItem('colophon:thread', id);
		this.turns = [];
		this.events = [];
		this.papers = [];
		this.workflow = [];
		this.spans = [];
		this.context = undefined;
		this.contextTokens = 0;
		this.#seq = 0;
	}

	newThread(): void {
		this.thread = crypto.randomUUID();
		localStorage.setItem('colophon:thread', this.thread);
		this.turns = [];
		this.events = [];
		this.papers = [];
		this.workflow = [];
		this.spans = [];
		this.context = undefined;
		this.contextTokens = 0;
		this.#seq = 0;
	}

	/* ── reading the stream ─────────────────────────────────────────────── */

	#log(event: ColophonEvent): void {
		this.events.push({
			seq: this.#seq++,
			at: this.#startedAt ? performance.now() - this.#startedAt : 0,
			turn: this.turns.length - 1,
			event
		});
	}

	#apply(turn: Turn, event: ColophonEvent): void {
		/*
		 * Spans are not timeline rows.
		 *
		 * They describe the same work the rows already describe — a tool call is
		 * one row and one span — so logging them would double the length of every
		 * timeline with entries that draw nothing, and burn a `seq` per entry.
		 * The trace panel reads `spans`; this log is for the things a reader
		 * scrolls.
		 */
		if (event.k !== 'span' && event.k !== 'trace') this.#log(event);

		switch (event.k) {
			case 'start':
				this.runId = event.runId;
				break;
			case 'text':
				turn.thinking = false;
				turn.text += event.text;
				break;
			case 'reasoning':
				// Only claim to be thinking before any text has arrived; afterwards
				// the visible answer is the better signal that work is happening.
				turn.thinking = event.state === 'start' && turn.text === '';
				break;
			case 'tool-call':
				turn.tools.push({
					id: event.id,
					// A delegation is shown by the subagent's name, not by the
					// `agent-paperReader` tool id — what happened is "a paper was read
					// in its own context window", not "a tool was called".
					name: event.subagent ?? event.name,
					subagent: event.subagent,
					args: event.args,
					done: false,
					startedAt: performance.now()
				});
				break;
			case 'tool-result': {
				const tool = turn.tools.find((t) => t.id === event.id);
				if (tool) {
					tool.done = true;
					tool.failed = event.failed;
					tool.result = event.result;
					tool.endedAt = performance.now();
				}
				if (!event.failed) absorb(this.papers, event.name ?? tool?.name, event.result);
				break;
			}
			case 'context':
				this.context = event;
				// Cleared, not carried over: showing the previous call's tokens
				// against this call's bands is the bug this pairing exists to avoid.
				this.contextTokens = 0;
				break;
			case 'step':
				turn.usage = addUsage(turn.usage ?? ZERO, event.usage);
				this.contextTokens = event.usage.input;
				break;
			case 'done':
				turn.thinking = false;
				// `done` reports the run total, which supersedes the per-step sum.
				if (event.usage.total) turn.usage = event.usage;
				break;
			case 'tripwire':
				turn.error = `Blocked by ${event.processor ?? 'a guardrail'}: ${event.reason}`;
				break;
			case 'approval':
				turn.thinking = false;
				this.status = 'waiting';
				turn.approval = {
					runId: event.runId,
					id: event.id,
					name: event.name,
					args: event.args
				};
				break;
			case 'span': {
				// Upsert: the same span arrives when it opens and again when it
				// closes, and the second one is the one with an end on it.
				const at = this.spans.findIndex((s) => s.id === event.span.id);
				if (at >= 0) this.spans[at] = event.span;
				else this.spans.push(event.span);
				break;
			}
			case 'trace':
				this.tracing = {
					configured: event.configured,
					...(event.reason ? { reason: event.reason } : {}),
					...(event.truncated ? { truncated: true } : {})
				};
				break;
			case 'error':
				turn.error = event.message;
				break;
		}
	}

	/**
	 * A workflow chunk, applied to the turn and to the timeline.
	 *
	 * Two writes on purpose. `workflow` is what the pipeline panel folds against
	 * the topology; the `stage` event put on the shared log is what keeps the
	 * event timeline from going blank for the whole of a five-minute run, which
	 * is exactly the window in which someone wants to know what is happening.
	 */
	#applyWorkflow(turn: Turn, event: WorkflowEvent | XrayEvent): void {
		/*
		 * The trace rides on this stream too, and must not be mistaken for a
		 * stage.
		 *
		 * This is where a real run died. `trace` and `span` frames were being
		 * pushed into `workflow` — where the pipeline panel drew one of them as a
		 * sixth, nameless stage — and then fell through to the terminal branch,
		 * which reads `event.usage.input` and threw on an event that has no usage.
		 * `consume` caught the throw and reported it in place of the answer:
		 *
		 *     Cannot read properties of undefined (reading 'input')
		 *
		 * Routed first, before anything touches `workflow`.
		 */
		if (event.k === 'span' || event.k === 'trace') {
			this.#apply(turn, event);
			return;
		}

		this.workflow.push(event);

		if (event.k === 'step-start') {
			this.#apply(turn, { k: 'stage', step: event.step, state: 'start' });
			return;
		}

		if (event.k === 'step-finish') {
			// The pipeline's retrieval happens inside a step rather than as a tool
			// call the model made, so this is the only place its papers surface.
			// Without it the library panel sat empty through a run that read three.
			if (event.papers) absorbPapers(this.papers, event.papers);
			this.#apply(turn, {
				k: 'stage',
				step: event.step,
				state: event.state,
				ms: event.ms,
				...(event.error ? { error: event.error } : {})
			});
			return;
		}

		/*
		 * Anything left that is not the terminal frame is a kind this build does
		 * not know — a Mastra upgrade, or a projector that learned a new event.
		 * Dropped rather than read: the branch below assumes fields that only
		 * `workflow-done` carries, and assuming them is precisely how the trace
		 * frame took a run down.
		 */
		if (event.k !== 'workflow-done') return;

		/*
		 * The pipeline's answer *is* the turn's text.
		 *
		 * A workflow publishes no token deltas — the writing happens inside a step
		 * and only the finished string crosses the boundary — so unlike a chat
		 * turn this arrives all at once at the end. That is a real difference in
		 * how the two modes feel and it is not worth faking a typewriter over.
		 */
		turn.thinking = false;
		if (event.answer) turn.text = event.answer;
		if (event.error) turn.error = event.error;
		else if (event.status !== 'success' && !event.answer) {
			turn.error = `The pipeline ended ${event.status} without an answer.`;
		}
		// Three numbers, not the agent's five: a workflow reports no reasoning or
		// cached split, and inventing zeros for them would be a claim.
		turn.usage = {
			input: event.usage.input,
			output: event.usage.output,
			total: event.usage.total,
			reasoning: 0,
			cached: 0
		};
		this.#apply(turn, { k: 'done', usage: turn.usage });
	}

	/* ── driving it ─────────────────────────────────────────────────────── */

	async send(prompt: string, mode: Mode = 'chat'): Promise<void> {
		if (!prompt.trim() || this.busy) return;
		if (mode === 'research') return this.#research(prompt.trim());

		this.mode = 'chat';
		this.#startedAt = performance.now();
		this.status = 'running';
		this.turns.push({ role: 'you', text: prompt.trim(), tools: [] });
		this.turns.push({ role: 'colophon', text: '', thinking: true, tools: [] });
		const turn = this.turns[this.turns.length - 1];

		this.#controller = new AbortController();
		await run({
			prompt: prompt.trim(),
			thread: this.thread,
			signal: this.#controller.signal,
			onEvent: (event) => this.#apply(turn, event),
			onError: (message) => {
				turn.thinking = false;
				turn.error = message;
			}
		});

		// An approval leaves the run suspended rather than finished; going idle
		// here would re-enable the composer on top of a decision still pending.
		if (!turn.approval) this.status = 'idle';
		this.#controller = undefined;
	}

	/**
	 * The same question, given to the pipeline instead of the loop.
	 *
	 * This is what the composer's "deep research" toggle was bound to for a
	 * while: nothing. `/api/research` existed, the workflow existed, the panels
	 * that draw it existed, and no client code called any of it — so the toggle
	 * moved a chip and three instruments stayed dead by construction.
	 *
	 * The differences from `send` are real rather than incidental, and each is a
	 * property of what a workflow *is*:
	 *
	 *   - **No thread.** The pipeline has no memory; it answers from the question
	 *     alone, every time. It is also not appended to the conversation Mastra
	 *     holds server-side, so a later chat turn will not see it — said out loud
	 *     because "it forgot what I just asked" would otherwise look like a bug.
	 *   - **No approval.** No step in this pipeline suspends yet, so there is no
	 *     `waiting` state to fall into and no card to render.
	 *   - **The answer arrives whole**, not as deltas. See `#applyWorkflow`.
	 */
	async #research(question: string): Promise<void> {
		this.mode = 'research';
		this.#startedAt = performance.now();
		this.status = 'running';
		// Cleared per run rather than accumulated: the pipeline panel folds these
		// against a fixed five-row topology, and last run's `done` marks beside
		// this run's `running` one would be a straightforwardly false readout.
		this.workflow = [];
		this.spans = [];
		this.turns.push({ role: 'you', text: question, tools: [] });
		this.turns.push({ role: 'colophon', text: '', thinking: true, tools: [] });
		const turn = this.turns[this.turns.length - 1];

		this.#controller = new AbortController();
		await research({
			question,
			signal: this.#controller.signal,
			onReady: (_ms, data) => {
				// The workflow run exists before it is started, so unlike a chat turn
				// the id is known before any money is spent.
				const runId = (data as { runId?: string } | undefined)?.runId;
				if (runId) {
					this.runId = runId;
					this.#apply(turn, { k: 'start', runId });
				}
			},
			onEvent: (event) => this.#applyWorkflow(turn, event),
			onError: (message) => {
				turn.thinking = false;
				turn.error = message;
			}
		});

		this.status = 'idle';
		this.#controller = undefined;
	}

	/**
	 * Approve or decline a paused tool call.
	 *
	 * `edited` exists for `present_outline`, where the reader may rewrite the
	 * structure before approving. It has to travel all the way to the server
	 * because `approveToolCall()` takes no argument override — a resumed call
	 * runs with the arguments the *model* wrote. Without this the outline card
	 * would offer an edit and then discard it, which is worse than not offering.
	 */
	async decide(turn: Turn, approve: boolean, edited?: unknown): Promise<void> {
		const pending = turn.approval;
		if (!pending || pending.deciding) return;
		pending.deciding = true;
		this.status = 'running';

		await respond({
			runId: pending.runId,
			toolCallId: pending.id,
			approve,
			edited,
			onEvent: (event) => this.#apply(turn, event),
			onError: (message) => {
				turn.error = message;
				// Without this the card's buttons stay disabled for good and the
				// only way out of a failed decision is a reload. A decision that
				// did not go through has not been made.
				pending.deciding = false;
			}
		});

		/*
		 * Clear the slot only if it still holds the decision we just made.
		 *
		 * A resumed run can suspend *again* before its stream ends — ask for two
		 * infographics and the second `generate_image` is requested and suspended
		 * while this very `respond()` is still reading. `#apply` puts that second
		 * approval in `turn.approval`, and the unconditional `= undefined` that
		 * used to sit here threw it away: the card vanished, the composer
		 * re-enabled, and the run was left suspended on the server with nothing on
		 * screen able to release it. Approving from the stale card that was still
		 * in the DOM then sent the *first* call's id back, which is where
		 *
		 *     resumeStream() cannot resume tool call "call_…" because it is not
		 *     suspended
		 *
		 * came from — the id was real, it had simply already been resumed.
		 */
		if (turn.approval === pending) turn.approval = undefined;
		this.status = turn.approval ? 'waiting' : 'idle';
	}

	stop(): void {
		this.#controller?.abort();
		this.status = 'idle';
	}
}

export type { KnownPaper };

export const session = new Session();
