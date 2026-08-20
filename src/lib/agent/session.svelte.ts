import { addUsage, type ColophonEvent, type Usage } from './events';
import { run, respond } from './stream-client';
import { absorb, type KnownPaper } from './library';

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

class Session {
	turns = $state<Turn[]>([]);
	events = $state<LoggedEvent[]>([]);
	status = $state<'idle' | 'running' | 'waiting'>('idle');
	thread = $state('');

	/** Everything retrieved this session, newest first in insertion order. */
	papers = $state<KnownPaper[]>([]);

	/** The current run's id, once the server has told us. */
	runId = $state('');

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

	newThread(): void {
		this.thread = crypto.randomUUID();
		localStorage.setItem('colophon:thread', this.thread);
		this.turns = [];
		this.events = [];
		this.papers = [];
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
		this.#log(event);

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
			case 'error':
				turn.error = event.message;
				break;
		}
	}

	/* ── driving it ─────────────────────────────────────────────────────── */

	async send(prompt: string): Promise<void> {
		if (!prompt.trim() || this.busy) return;

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

	async decide(turn: Turn, approve: boolean): Promise<void> {
		const pending = turn.approval;
		if (!pending || pending.deciding) return;
		pending.deciding = true;
		this.status = 'running';

		await respond({
			runId: pending.runId,
			toolCallId: pending.id,
			approve,
			onEvent: (event) => this.#apply(turn, event),
			onError: (message) => {
				turn.error = message;
			}
		});

		turn.approval = undefined;
		this.status = 'idle';
	}

	stop(): void {
		this.#controller?.abort();
		this.status = 'idle';
	}
}

export type { KnownPaper };

export const session = new Session();
