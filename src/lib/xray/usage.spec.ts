import { describe, it, expect } from 'vitest';
import type { ColophonEvent, Usage } from '$lib/agent/events';
import {
	RATES,
	RATES_REVIEWED,
	DEFAULT_RATES,
	ratesFor,
	costOf,
	cachedFraction,
	perStep,
	usd,
	windowFor
} from './usage';

/** A usage object with the fields a case cares about, zeroed everywhere else. */
const u = (partial: Partial<Usage>): Usage => ({
	input: 0,
	output: 0,
	total: 0,
	reasoning: 0,
	cached: 0,
	...partial
});

describe('the rate table', () => {
	it('carries a review date that parses, so a stale table is visible', () => {
		expect(Number.isFinite(Date.parse(RATES_REVIEWED))).toBe(true);
	});

	it('prices cached input well below fresh, and output well above both', () => {
		for (const [id, r] of Object.entries(RATES)) {
			expect(r.cachedInput, id).toBeLessThan(r.input);
			expect(r.output, id).toBeGreaterThan(r.input);
		}
	});

	it('defaults to gpt-5, the model the app actually runs', () => {
		expect(DEFAULT_RATES).toBe(RATES['gpt-5']);
	});
});

describe('ratesFor', () => {
	it('matches an exact id', () => {
		expect(ratesFor('gpt-5')).toBe(RATES['gpt-5']);
		expect(ratesFor('gpt-5-mini')).toBe(RATES['gpt-5-mini']);
	});

	it('matches a dated id by its longest prefix, not its first', () => {
		// The bug this pins: `gpt-5-mini-2026-03-11` matching the `gpt-5` entry
		// and being billed at five times its real rate.
		expect(ratesFor('gpt-5-mini-2026-03-11')).toBe(RATES['gpt-5-mini']);
		expect(ratesFor('gpt-5-2026-03-11')).toBe(RATES['gpt-5']);
	});

	it('returns nothing for a model it has never priced', () => {
		expect(ratesFor('gpt-4o')).toBeUndefined();
		expect(ratesFor('')).toBeUndefined();
	});
});

describe('costOf', () => {
	it('prices fresh input, cached input and output on their own rates', () => {
		// 600 fresh @ 1.25 + 400 cached @ 0.125 + 200 out @ 10, per 1M.
		expect(costOf(u({ input: 1000, cached: 400, output: 200 }))).toBeCloseTo(0.0028, 12);
	});

	it('does not charge cached tokens twice — they are part of input, not extra', () => {
		const allCached = costOf(u({ input: 1000, cached: 1000 }));
		expect(allCached).toBeCloseTo(1000 * (0.125 / 1_000_000), 12);
		expect(allCached).toBeLessThan(costOf(u({ input: 1000, cached: 0 })));
	});

	it('does not charge reasoning twice — it is part of output, at the same rate', () => {
		const withThinking = costOf(u({ output: 500, reasoning: 400 }));
		expect(withThinking).toBe(costOf(u({ output: 500, reasoning: 0 })));
	});

	it('ignores total, which is a sum of the others and would triple the bill', () => {
		expect(costOf(u({ input: 1000, output: 200, total: 1200 }))).toBe(
			costOf(u({ input: 1000, output: 200 }))
		);
	});

	it('clamps a cached count larger than input rather than going negative', () => {
		const cost = costOf(u({ input: 100, cached: 500 }));
		expect(cost).toBeGreaterThan(0);
		expect(cost).toBeCloseTo(100 * (0.125 / 1_000_000), 12);
	});

	it('is zero for an empty usage and never NaN for a malformed one', () => {
		expect(costOf(u({}))).toBe(0);
		expect(costOf(u({ input: NaN, output: NaN }))).toBe(0);
		expect(costOf(u({ input: -5000 }))).toBe(0);
	});

	it('holds up at a million tokens, where floating point starts to matter', () => {
		expect(costOf(u({ input: 10_000_000, output: 1_000_000 }))).toBeCloseTo(22.5, 9);
	});

	it('takes another model at its own rates', () => {
		const big = costOf(u({ input: 1000, output: 1000 }), RATES['gpt-5']);
		const small = costOf(u({ input: 1000, output: 1000 }), RATES['gpt-5-nano']);
		expect(small).toBeLessThan(big);
	});
});

describe('cachedFraction', () => {
	it('is the share of input the provider had already seen', () => {
		expect(cachedFraction(u({ input: 1000, cached: 250 }))).toBe(0.25);
	});

	it('is zero, not NaN, before any input exists', () => {
		expect(cachedFraction(u({}))).toBe(0);
		expect(cachedFraction(u({ cached: 400 }))).toBe(0);
	});

	it('never exceeds one, however bad the numbers are', () => {
		expect(cachedFraction(u({ input: 100, cached: 900 }))).toBe(1);
		expect(cachedFraction(u({ input: NaN, cached: 900 }))).toBe(0);
	});
});

describe('perStep', () => {
	const events: ColophonEvent[] = [
		{ k: 'start', runId: 'r1' },
		{ k: 'step', usage: u({ input: 1000, cached: 0, output: 100, total: 1100 }) },
		{ k: 'text', text: 'hello' },
		{ k: 'step', usage: u({ input: 2000, cached: 800, output: 300, total: 2300 }) },
		{ k: 'done', usage: u({ input: 3000, cached: 800, output: 400, total: 3400 }) }
	];

	it('numbers the steps from one and keeps them in stream order', () => {
		expect(perStep(events).map((s) => s.n)).toEqual([1, 2]);
	});

	it('accumulates the running total across steps', () => {
		const steps = perStep(events);
		expect(steps[1].cumulative.input).toBe(3000);
		expect(steps[1].cumulative.output).toBe(400);
		expect(steps[1].cumulativeUsd).toBeCloseTo(steps[0].usd + steps[1].usd, 12);
	});

	it('ignores the done event, which restates the run total rather than adding to it', () => {
		// Folding `done` in would report three steps and roughly double the bill.
		expect(perStep(events)).toHaveLength(2);
	});

	it('reads the wrapped shape the session logs, not only the raw stream', () => {
		const logged = events.map((event, seq) => ({ seq, at: seq * 10, turn: 0, event }));
		expect(perStep(logged).map((s) => s.usage.input)).toEqual([1000, 2000]);
	});

	it('is empty for no events and for a run that never reached a step', () => {
		expect(perStep([])).toEqual([]);
		expect(perStep([{ k: 'text', text: 'hi' }])).toEqual([]);
	});
});

describe('usd', () => {
	it('keeps four decimals under a cent, where most single turns land', () => {
		expect(usd(0.00321)).toBe('$0.0032');
	});

	it('keeps three above it', () => {
		expect(usd(0.1844)).toBe('$0.184');
	});

	it('prints an exact zero plainly and refuses a number it does not have', () => {
		expect(usd(0)).toBe('$0.00');
		expect(usd(NaN)).toBe('—');
	});
});

/**
 * The input window, which the context gauge draws against.
 *
 * Same discipline as the rates above and for the same reason: it is a published
 * number Colophon cannot measure, so an unknown model must produce *no gauge*
 * rather than a bar drawn against a plausible invention. A context panel that
 * overstated the headroom would be exactly the readout this app exists to
 * replace.
 */
describe('windowFor', () => {
	it('knows the family that is wired up', () => {
		expect(windowFor('gpt-5')).toBe(272_000);
		expect(windowFor('gpt-5-mini')).toBe(272_000);
	});

	it('tolerates the dated ids the provider also answers to', () => {
		expect(windowFor('gpt-5-2026-03-11')).toBe(272_000);
	});

	it('says nothing about a model it has not been told about', () => {
		expect(windowFor('some-other-model')).toBeUndefined();
		expect(windowFor(undefined)).toBeUndefined();
		expect(windowFor('')).toBeUndefined();
	});
});
