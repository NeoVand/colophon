import { addUsage, type ColophonEvent, type Usage } from '$lib/agent/events';

/**
 * Token arithmetic, and the one fact that makes it arithmetic rather than
 * addition.
 *
 * **The counts overlap.** `cached` is a *part* of `input`, and `reasoning` is a
 * part of `output` — that is how the provider reports them, and it is stated in
 * `events.ts` for the same reason it is stated here: every naive version of
 * this file adds the five numbers as siblings, double-counts two of them, and
 * produces a bill that is wrong in the direction nobody checks. So every
 * function below splits before it prices.
 *
 * Nothing here reads the session, the clock or the network. It is pure over the
 * events the run already published, which is why it can be tested against three
 * literal objects instead of a recorded run.
 */

/** USD per 1,000,000 tokens. */
export interface Rates {
	/** Input tokens the provider had to read fresh. */
	input: number;
	/** Input tokens served from its prompt cache — an order of magnitude less. */
	cachedInput: number;
	/** Output tokens, reasoning included: the provider bills them identically. */
	output: number;
}

/**
 * ⚠ PROVIDER PRICING — REVIEW WHEN OPENAI CHANGES IT ⚠
 *
 * These are published list prices, not something Colophon can measure, so they
 * are the one part of the X-ray that can silently go stale: nothing fails, no
 * test goes red, the spend panel simply starts lying by a constant factor.
 *
 * Last checked against OpenAI's published gpt-5 pricing on the date in
 * `RATES_REVIEWED`. When you change a number here, change that date in the same
 * commit — a stamp that is edited with the table is a stamp worth reading.
 *
 * Only the gpt-5 family is listed because only the gpt-5 family is wired up
 * (`DEFAULT_MODEL` in `src/lib/server/model.ts`). `ratesFor` deliberately
 * returns nothing for anything else rather than guessing: an unknown model
 * priced at gpt-5's rates would read as a plausible number and be a fabricated
 * one, which is the exact failure this app exists to make visible.
 */
export const RATES: Record<string, Rates> = {
	'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
	'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
	'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 }
};

/** The date the table above was last verified. See the warning on `RATES`. */
export const RATES_REVIEWED = '2026-08-19';

/**
 * ⚠ PROVIDER LIMITS — SAME WARNING AS THE RATES ABOVE ⚠
 *
 * How many *input* tokens fit in one request. Published numbers, not something
 * Colophon can measure, so the same rule applies: change a number here and
 * change `RATES_REVIEWED` in the same commit.
 *
 * It is the input window specifically — output is budgeted separately — because
 * the only thing this is used for is the context gauge, which measures what we
 * send. And `windowFor` returns nothing for an unknown model rather than
 * guessing, so the gauge disappears instead of drawing a bar against a number
 * somebody made up. A context panel that overstated the headroom would be
 * exactly the plausible-and-wrong readout this app exists to replace.
 */
export const WINDOWS: Record<string, number> = {
	'gpt-5': 272_000,
	'gpt-5-mini': 272_000,
	'gpt-5-nano': 272_000
};

/** The input window for a model id, or nothing if it is not one we have listed. */
export function windowFor(model: string | undefined): number | undefined {
	if (!model) return undefined;
	const match = Object.keys(WINDOWS)
		.filter((id) => model === id || model.startsWith(`${id}-`))
		.sort((a, b) => b.length - a.length)[0];
	return match ? WINDOWS[match] : undefined;
}

/** What an unqualified price means here. */
export const DEFAULT_RATES: Rates = RATES['gpt-5'];

/**
 * Rates for a model id, or nothing if it is not one we have priced.
 *
 * Tolerates the dated ids the provider also answers to (`gpt-5-2026-03-11`) by
 * taking the longest listed id the argument starts with — longest, so that
 * `gpt-5-mini-…` cannot match the `gpt-5` entry first and be billed at five
 * times its real rate.
 */
export function ratesFor(model: string): Rates | undefined {
	const match = Object.keys(RATES)
		.filter((id) => model === id || model.startsWith(`${id}-`))
		.sort((a, b) => b.length - a.length)[0];
	return match ? RATES[match] : undefined;
}

/** Non-finite in, zero out — one NaN would poison every running total after it. */
function num(n: number | undefined): number {
	return Number.isFinite(n) ? Math.max(0, n as number) : 0;
}

/**
 * What one usage object cost, in USD.
 *
 * `cached` is subtracted from `input` before the fresh tokens are priced,
 * because the provider already counted those tokens once. Charging both bands
 * for the same tokens overstates a well-cached research turn by roughly the
 * cache discount, which is precisely the saving the panel exists to show.
 *
 * `reasoning` is not priced separately for the mirror-image reason: it is
 * already inside `output`, at the same rate.
 *
 * A `cached` larger than `input` is not possible and does arrive anyway when a
 * turn's usages are summed from mismatched sources. It clamps rather than
 * producing a negative fresh-token charge.
 */
export function costOf(usage: Usage, rates: Rates = DEFAULT_RATES): number {
	const input = num(usage?.input);
	const cached = Math.min(num(usage?.cached), input);
	const fresh = input - cached;
	return (
		(fresh * rates.input + cached * rates.cachedInput + num(usage?.output) * rates.output) /
		1_000_000
	);
}

/**
 * How much of the input was served from cache, as 0–1.
 *
 * Zero when there was no input, rather than `NaN`. A fresh session renders this
 * before the first token arrives, and `NaN%` on screen — or a bar of width
 * `NaN` collapsing its flex row — is the bug this guard exists for.
 */
export function cachedFraction(usage: Usage): number {
	const input = num(usage?.input);
	if (input === 0) return 0;
	return Math.min(1, num(usage?.cached) / input);
}

/** One step of the agent loop, priced. */
export interface Step {
	/** 1-based, as a panel labels it: "step 3 of 7". */
	n: number;
	usage: Usage;
	/** Every step up to and including this one. */
	cumulative: Usage;
	usd: number;
	cumulativeUsd: number;
}

/** A raw event, or one wrapped as the session logs it. Both are accepted. */
type Loggable = ColophonEvent | { event: ColophonEvent };

/**
 * The run's steps, in order, each with its own spend and the running total.
 *
 * Takes either shape the app holds — `ColophonEvent[]` off the stream, or
 * `session.events` with its `{ seq, at, turn, event }` wrapper — because those
 * are the only two, and the alternative is a caller who passes `session.events`
 * to a function typed for the unwrapped kind, matches nothing, and gets an
 * empty array that looks exactly like a run with no steps.
 *
 * The `done` event is ignored on purpose. It reports the run total, which
 * supersedes the per-step sum rather than extending it; folding it in as one
 * more row would roughly double the bill and add a final step that never ran.
 */
export function perStep(events: readonly Loggable[], rates: Rates = DEFAULT_RATES): Step[] {
	const steps: Step[] = [];
	let cumulative: Usage = { input: 0, output: 0, total: 0, reasoning: 0, cached: 0 };
	let cumulativeUsd = 0;

	for (const item of events) {
		const e = item && 'event' in item ? item.event : (item as ColophonEvent);
		if (e?.k !== 'step') continue;

		cumulative = addUsage(cumulative, e.usage);
		const usd = costOf(e.usage, rates);
		cumulativeUsd += usd;
		steps.push({ n: steps.length + 1, usage: e.usage, cumulative, usd, cumulativeUsd });
	}

	return steps;
}

/**
 * A price, at the precision the amount deserves — `$0.0032`, `$0.184`.
 *
 * Four decimals under a cent because most single turns land there, and a
 * column of `$0.00` says nothing at all about which turn was expensive.
 */
export function usd(amount: number): string {
	if (!Number.isFinite(amount)) return '—';
	if (amount === 0) return '$0.00';
	return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(3)}`;
}
