/**
 * Deciding which tabs fit, and which go behind the `⋯`.
 *
 * Extracted from `PanelFrame` because it is the only part of that component
 * with arithmetic in it, and the arithmetic has three ways to be quietly wrong:
 * hiding a tab that would have fitted, forgetting that the `⋯` itself takes
 * room, and hiding the tab you are currently looking at. None of those three
 * announces itself — a tab strip that is one tab short looks exactly like a tab
 * strip.
 *
 * ── The bug this exists to have fixed ───────────────────────────────────────
 * The harness panel carries seven tabs. On a pane dragged narrow, `mcp` and
 * `trace` ran off the right edge of the header and were unreachable, with
 * nothing on screen saying so. Measured at a 900px window before the fix: the
 * last tab's right edge sat 72px past the header's.
 *
 * The widths are measured by the caller rather than counted in characters. The
 * labels are text in a variable font and the pane is a drag handle away from
 * any width at all, so a character-count guess is wrong at every zoom level and
 * in every locale.
 */

export interface Fit<T> {
	/** In order, and always ending with the active tab if one had to be swapped in. */
	shown: T[];
	/** What goes in the overflow menu. Empty when everything fits. */
	hidden: T[];
}

export interface FitOptions {
	/** Natural width of each tab, in the same order as `tabs`. */
	widths: number[];
	/** How much room the strip actually has. */
	available: number;
	/** What the `⋯` costs, since it only exists when something is hidden. */
	moreWidth: number;
	/** The strip's own `gap`, in px. */
	gap: number;
	/** Index of the tab currently selected, or -1. */
	activeIndex: number;
}

/**
 * Show what fits; put the rest behind one `⋯`.
 *
 * Two rules beyond fitting, and both matter:
 *
 * **Nothing is hidden unless something must be.** The `⋯` is only charged
 * against the budget once we know the strip overflows — charging it up front
 * would hide a tab to make room for a control that was not needed.
 *
 * **The active tab is never the one hidden.** If it would be, it trades places
 * with the last tab that fits, so the strip always shows where you are and the
 * menu never contains the answer to "which panel am I looking at". The swap is
 * a trade rather than an insertion because the two have different widths and
 * inserting could overflow the strip again — which is how a fix for a clipped
 * tab becomes a clipped tab.
 *
 * Degrades to showing everything when it has not been measured yet: one frame
 * of a too-wide strip is better than one frame of a strip missing tabs, because
 * the first corrects itself and the second is indistinguishable from the bug.
 */
export function fitTabs<T>(tabs: readonly T[], options: FitOptions): Fit<T> {
	const { widths, available, moreWidth, gap, activeIndex } = options;

	const all = () => ({ shown: [...tabs], hidden: [] as T[] });
	if (!available || widths.length !== tabs.length) return all();

	const total = widths.reduce((n, w) => n + w, 0) + gap * Math.max(0, tabs.length - 1);
	if (total <= available) return all();

	const budget = available - moreWidth - gap;
	let used = 0;
	let count = 0;
	for (let i = 0; i < tabs.length; i++) {
		const next = used + widths[i] + (count ? gap : 0);
		if (next > budget) break;
		used = next;
		count++;
	}

	const shown = tabs.slice(0, count);
	const hidden = tabs.slice(count);

	const activeHidden = activeIndex >= count ? activeIndex - count : -1;
	if (activeHidden >= 0 && shown.length) {
		const last = shown.length - 1;
		const swapped = shown[last];
		shown[last] = hidden[activeHidden];
		hidden[activeHidden] = swapped;
	}

	return { shown, hidden };
}
