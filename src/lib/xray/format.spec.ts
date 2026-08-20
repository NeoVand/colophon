import { describe, it, expect } from 'vitest';
import { bytes, tokens, ms, relative, truncate, initials } from './format';

/**
 * Formatters fail at their seams and at their edges, never in the middle. So
 * these tests are almost entirely tier boundaries, zero, negatives, and the
 * inputs that arrive when something upstream went wrong.
 */

describe('bytes', () => {
	it('prints small counts exactly, in bytes', () => {
		expect(bytes(0)).toBe('0 B');
		expect(bytes(820)).toBe('820 B');
	});

	it('crosses each binary tier at 1024, not 1000', () => {
		expect(bytes(1023)).toBe('1023 B');
		expect(bytes(1024)).toBe('1 KB');
		expect(bytes(1536)).toBe('1.5 KB');
		expect(bytes(1024 ** 2)).toBe('1 MB');
		expect(bytes(5.5 * 1024 ** 3)).toBe('5.5 GB');
	});

	it('rounds before choosing the tier, so no value prints as 1024 B', () => {
		expect(bytes(1023.6)).toBe('1 KB');
	});

	it('keeps the sign on a negative rather than hiding a bad subtraction', () => {
		expect(bytes(-2048)).toBe('-2 KB');
	});

	it('refuses to invent a size it was never given', () => {
		expect(bytes(NaN)).toBe('—');
		expect(bytes(Infinity)).toBe('—');
	});
});

describe('tokens', () => {
	it('prints under a thousand in full', () => {
		expect(tokens(0)).toBe('0');
		expect(tokens(999)).toBe('999');
	});

	it('keeps one decimal below ten thousand, where it changes a decision', () => {
		expect(tokens(1000)).toBe('1k');
		expect(tokens(1234)).toBe('1.2k');
		expect(tokens(9999)).toBe('10k');
	});

	it('drops the decimal above ten thousand', () => {
		expect(tokens(12_345)).toBe('12k');
		expect(tokens(128_000)).toBe('128k');
	});

	it('promotes to M rather than printing 1000k', () => {
		expect(tokens(999_999)).toBe('1M');
		expect(tokens(1_500_000)).toBe('1.5M');
	});

	it('handles a negative delta and a missing number', () => {
		expect(tokens(-1234)).toBe('-1.2k');
		expect(tokens(NaN)).toBe('—');
	});
});

describe('ms', () => {
	it('uses milliseconds under a second and seconds under a minute', () => {
		expect(ms(0)).toBe('0ms');
		expect(ms(820)).toBe('820ms');
		expect(ms(4200)).toBe('4.2s');
	});

	it('rounds each tier before testing the next, leaving no 1000ms or 60.0s', () => {
		expect(ms(999.6)).toBe('1s');
		expect(ms(59_950)).toBe('1m 0s');
	});

	it('splits minutes and hours', () => {
		expect(ms(72_000)).toBe('1m 12s');
		expect(ms(3_600_000)).toBe('1h 0m');
		expect(ms(7_500_000)).toBe('2h 5m');
	});

	it('clamps a negative duration, which is a clock artefact and not a fact', () => {
		expect(ms(-50)).toBe('0ms');
	});

	it('will not print a duration it does not have', () => {
		expect(ms(NaN)).toBe('—');
	});
});

describe('relative', () => {
	const now = Date.parse('2026-08-19T12:00:00Z');
	const DAY = 86_400_000;

	it('says just now for anything inside three quarters of a minute', () => {
		expect(relative(now, now)).toBe('just now');
		expect(relative(now - 44_000, now)).toBe('just now');
	});

	it('singularises one and pluralises the rest', () => {
		expect(relative(now - 60_000, now)).toBe('1 minute ago');
		expect(relative(now - 3 * DAY, now)).toBe('3 days ago');
	});

	it('climbs the units', () => {
		expect(relative(now - 2 * 3_600_000, now)).toBe('2 hours ago');
		expect(relative(now - 45 * DAY, now)).toBe('1 month ago');
		expect(relative(now - 400 * DAY, now)).toBe('1 year ago');
	});

	it('reads a future instant forwards', () => {
		expect(relative(now + 2 * 3_600_000, now)).toBe('in 2 hours');
	});

	it('takes a Date, an epoch number or an ISO string alike', () => {
		expect(relative(new Date(now - 3 * DAY), now)).toBe('3 days ago');
		expect(relative('2026-08-16T12:00:00Z', now)).toBe('3 days ago');
	});

	it('does not pretend an unparseable string is a date', () => {
		expect(relative('sometime last week', now)).toBe('—');
		expect(relative(NaN, now)).toBe('—');
	});
});

describe('truncate', () => {
	it('leaves anything that already fits', () => {
		expect(truncate('hello', 5)).toBe('hello');
		expect(truncate('', 5)).toBe('');
	});

	it('counts the ellipsis inside the budget', () => {
		expect(truncate('hello world', 5)).toBe('hell…');
		expect([...truncate('hello world', 5)]).toHaveLength(5);
	});

	it('trims the space it would otherwise leave before the ellipsis', () => {
		expect(truncate('ab cd', 4)).toBe('ab…');
	});

	it('handles a budget of nothing', () => {
		expect(truncate('abc', 0)).toBe('');
		expect(truncate('abc', -3)).toBe('');
		expect(truncate('abc', 1)).toBe('…');
	});

	it('cuts on code points, never through half an emoji', () => {
		const out = truncate('👍👍👍', 2);
		expect(out).toBe('👍…');
		// A UTF-16 slice would leave a lone surrogate here, which renders as the
		// replacement character rather than as a shorter string.
		expect(out).not.toContain('�');
	});
});

describe('initials', () => {
	it('takes the first and last words, upper-cased', () => {
		expect(initials('Ada Lovelace')).toBe('AL');
		expect(initials('ada lovelace')).toBe('AL');
	});

	it('skips the middle name nobody uses to tell people apart', () => {
		expect(initials('Ada Lovelace King')).toBe('AK');
	});

	it('gives one letter for a single word', () => {
		expect(initials('Ada')).toBe('A');
	});

	it('treats punctuation as a separator', () => {
		expect(initials('Jean-Luc Picard')).toBe('JP');
		expect(initials('ada.lovelace')).toBe('AL');
	});

	it('returns nothing for a name with no letters in it', () => {
		expect(initials('')).toBe('');
		expect(initials('   ')).toBe('');
		expect(initials('🙂')).toBe('');
	});
});
