import { describe, expect, it } from 'vitest';
import { fitTabs } from './tabs';

/**
 * The arithmetic behind a tab strip that admits when it does not fit.
 *
 * It exists because the harness panel's `mcp` and `trace` tabs ran off the
 * right edge of a narrow pane and were unreachable, with nothing on screen
 * saying so — measured at 72px past the header. A tab strip one tab short looks
 * exactly like a tab strip, which is why this is tested rather than eyeballed.
 */

const tabs = ['graph', 'tools', 'crew', 'skills', 'memory', 'mcp', 'trace'];
/** Real numbers, read off the rendered strip in a browser. */
const widths = [44, 44, 37, 51, 51, 30, 44];
const base = { widths, moreWidth: 12, gap: 2, activeIndex: 0 };

describe('fitTabs', () => {
	it('shows everything when everything fits', () => {
		// 301 of type plus six 2px gaps is 313; the strip had 490.
		const fit = fitTabs(tabs, { ...base, available: 490 });
		expect(fit.shown).toEqual(tabs);
		expect(fit.hidden).toEqual([]);
	});

	it('does not charge for a ⋯ it is not going to draw', () => {
		// Exactly 313 available. Reserving the overflow control up front would
		// hide a tab to make room for a control that was not needed.
		const fit = fitTabs(tabs, { ...base, available: 313 });
		expect(fit.hidden).toEqual([]);
	});

	it('hides the tail, and only the tail, when it must', () => {
		const fit = fitTabs(tabs, { ...base, available: 231 });
		expect(fit.shown).toEqual(['graph', 'tools', 'crew', 'skills']);
		expect(fit.hidden).toEqual(['memory', 'mcp', 'trace']);
	});

	it('leaves room for the ⋯ itself', () => {
		// Everything shown must fit inside available − moreWidth − gap, or the
		// control that says "there is more" is itself the thing that overflows.
		const available = 231;
		const fit = fitTabs(tabs, { ...base, available });
		const used =
			fit.shown.reduce((n, t) => n + widths[tabs.indexOf(t)], 0) + 2 * (fit.shown.length - 1);
		expect(used).toBeLessThanOrEqual(available - 12 - 2);
	});

	it('never hides the tab you are looking at', () => {
		// `trace` is last and would be hidden; it trades places with the last tab
		// that fits, so the strip still says which panel is on screen.
		const fit = fitTabs(tabs, { ...base, available: 231, activeIndex: 6 });
		expect(fit.shown).toContain('trace');
		expect(fit.hidden).not.toContain('trace');
		expect(fit.shown[fit.shown.length - 1]).toBe('trace');
	});

	it('trades rather than inserts, so the swap cannot overflow the strip', () => {
		// The swapped-out tab goes into the menu in the swapped-in one's place —
		// counts stay put. Growing `shown` by one is how a fix for a clipped tab
		// becomes a clipped tab.
		const plain = fitTabs(tabs, { ...base, available: 231 });
		const swapped = fitTabs(tabs, { ...base, available: 231, activeIndex: 6 });
		expect(swapped.shown).toHaveLength(plain.shown.length);
		expect(swapped.hidden).toHaveLength(plain.hidden.length);
		expect(swapped.hidden).toContain('skills');
	});

	it('leaves an already-visible active tab where it is', () => {
		const fit = fitTabs(tabs, { ...base, available: 231, activeIndex: 1 });
		expect(fit.shown).toEqual(['graph', 'tools', 'crew', 'skills']);
	});

	it('shows everything until it has been measured', () => {
		// One frame of a too-wide strip corrects itself; one frame of a strip
		// missing tabs is indistinguishable from the bug being fixed here.
		expect(fitTabs(tabs, { ...base, available: 0 }).shown).toEqual(tabs);
		expect(fitTabs(tabs, { ...base, widths: [], available: 231 }).shown).toEqual(tabs);
	});

	it('survives a strip too narrow for even one tab', () => {
		// Everything goes in the menu rather than one tab being drawn over the
		// edge. Ugly, honest, and reachable.
		const fit = fitTabs(tabs, { ...base, available: 20 });
		expect(fit.shown).toEqual([]);
		expect(fit.hidden).toEqual(tabs);
	});

	it('does not mutate what it was given', () => {
		const original = [...tabs];
		fitTabs(tabs, { ...base, available: 231, activeIndex: 6 });
		expect(tabs).toEqual(original);
	});
});
