/**
 * Human formatting, in one place.
 *
 * Every panel prints sizes, counts, durations and timestamps, and every panel
 * that rolls its own ends up disagreeing with its neighbour — 1.5 KB beside
 * 1536 bytes beside "2 kb" is the sort of thing that makes an instrument panel
 * look like three instrument panels. So this module is the single vocabulary,
 * and the components carry none of it.
 *
 * ── Why nothing here invents a number ───────────────────────────────────────
 * Non-finite input renders as an em dash rather than `0`. A readout is a claim
 * about what happened, and `0 B` for a size nobody measured is a quiet lie of
 * exactly the kind the X-ray exists to replace. An em dash says "not known",
 * which is both true and visibly different from zero in a column.
 *
 * Durations are the one exception, and only for negatives: see `ms`.
 */

/** Not measured. U+2014, wide enough to read as a gap in a mono column. */
const UNKNOWN = '—';

/**
 * One decimal, with a bare `.0` dropped.
 *
 * `1.0 KB` and `4.0s` read as noise in a dense column; `1 KB` and `4s` read as
 * numbers. The decimal is kept whenever it carries information.
 */
function oneDp(v: number): string {
	return v.toFixed(1).replace(/\.0$/, '');
}

/**
 * A byte count, in binary units — `820 B`, `1.5 KB`, `2.4 MB`.
 *
 * KB here is 1024 bytes, matching what the browser's own devtools report for
 * the same payload. Negatives keep their sign rather than being clamped: a
 * negative size means a subtraction went wrong upstream, and hiding it makes
 * that harder to find, not easier.
 */
export function bytes(n: number): string {
	if (!Number.isFinite(n)) return UNKNOWN;
	const sign = n < 0 ? '-' : '';
	const v = Math.abs(n);

	// Rounded before the tier is chosen, so 1023.6 does not print as `1024 B`
	// beside a `1 KB` that names the same quantity.
	const whole = Math.round(v);
	if (whole < 1024) return `${sign}${whole} B`;
	if (v < 1024 ** 2) return `${sign}${oneDp(v / 1024)} KB`;
	if (v < 1024 ** 3) return `${sign}${oneDp(v / 1024 ** 2)} MB`;
	return `${sign}${oneDp(v / 1024 ** 3)} GB`;
}

/**
 * A token count, at the precision the magnitude deserves — `847`, `1.2k`,
 * `128k`, `1.4M`.
 *
 * The decimal survives only below ten thousand, where the difference between
 * 1.2k and 1.9k is a difference a reader acts on. Above it, `128k` is the
 * number people actually say about a context window.
 *
 * Lowercase `k`, uppercase `M`, per SI — and because a lowercase `m` beside a
 * duration would read as milli.
 */
export function tokens(n: number): string {
	if (!Number.isFinite(n)) return UNKNOWN;
	const sign = n < 0 ? '-' : '';
	const v = Math.abs(n);
	if (v < 1000) return `${sign}${Math.round(v)}`;

	const k = v / 1000;
	if (k < 10) return `${sign}${oneDp(k)}k`;
	// Checked against the rounded value, so 999,999 becomes `1M` rather than
	// the `1000k` a naive tier test produces.
	if (Math.round(k) < 1000) return `${sign}${Math.round(k)}k`;
	return `${sign}${oneDp(v / 1_000_000)}M`;
}

/**
 * A duration — `820ms`, `4.2s`, `1m 12s`, `2h 5m`.
 *
 * Each tier is rounded *before* the next tier is tested, which is what keeps
 * the seams clean: 999.6ms prints `1s` rather than `1000ms`, and 59.95s prints
 * `1m 0s` rather than `60.0s`.
 *
 * Negatives clamp to zero, and this is deliberate. Durations here are
 * `performance.now()` deltas, and a tab suspended mid-run can produce an end
 * stamp fractionally before its start. `-0.4s` on a tool row is never a fact
 * about the tool; it is a fact about the clock, and it has no business in a
 * readout of the run.
 */
export function ms(n: number): string {
	if (!Number.isFinite(n)) return UNKNOWN;
	const v = Math.max(0, n);

	const whole = Math.round(v);
	if (whole < 1000) return `${whole}ms`;

	const s = whole / 1000;
	const tenths = Math.round(s * 10) / 10;
	if (tenths < 60) return `${oneDp(tenths)}s`;

	const totalSec = Math.round(s);
	const mins = Math.floor(totalSec / 60);
	if (mins < 60) return `${mins}m ${totalSec % 60}s`;
	return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago — `just now`, `3 days ago`, `in 2 hours`.
 *
 * `now` is a parameter rather than a call to `Date.now()` inside, because a
 * function that reads the clock cannot be tested without freezing it, and a
 * frozen clock in a test suite is a source of flakes that only appear at
 * midnight. Callers pass nothing; tests pass a fixed instant.
 *
 * Accepts what the app actually holds: a `Date`, an epoch milliseconds number,
 * or an ISO string off the wire. An unparseable string is not a date and does
 * not pretend to be one.
 */
export function relative(when: Date | number | string, now: number = Date.now()): string {
	const t =
		when instanceof Date ? when.getTime() : typeof when === 'number' ? when : Date.parse(when);
	if (!Number.isFinite(t)) return UNKNOWN;

	const delta = (now - t) / 1000;
	const past = delta >= 0;
	const s = Math.abs(delta);

	// Below three quarters of a minute nobody is counting, and "44 seconds ago"
	// is a precision the reader cannot use.
	if (s < 45) return 'just now';

	let count: number;
	let unit: string;
	if (s < 45 * MINUTE) {
		count = Math.round(s / MINUTE);
		unit = 'minute';
	} else if (s < 22 * HOUR) {
		count = Math.round(s / HOUR);
		unit = 'hour';
	} else if (s < 26 * DAY) {
		count = Math.round(s / DAY);
		unit = 'day';
	} else if (s < 320 * DAY) {
		// 30.44 days, the mean Gregorian month — a flat 30 drifts a whole month
		// out over a year, which is visible on anything kept for a season.
		count = Math.round(s / (30.44 * DAY));
		unit = 'month';
	} else {
		count = Math.round(s / (365.25 * DAY));
		unit = 'year';
	}

	const phrase = `${count} ${unit}${count === 1 ? '' : 's'}`;
	return past ? `${phrase} ago` : `in ${phrase}`;
}

/**
 * Shorten to `n` characters *including* the ellipsis, so the result never
 * exceeds the width it was given.
 *
 * A real `…` (U+2026), not three periods: three periods are three characters
 * of a budget that is usually about twenty, and they kern badly in mono.
 *
 * Counted in code points, not UTF-16 units. `s.slice()` will happily cut an
 * emoji or an astral CJK glyph in half, and the lone surrogate that falls out
 * renders as a replacement character — a corrupted title is a worse outcome
 * than a title one glyph shorter.
 */
export function truncate(s: string, n: number): string {
	if (n <= 0) return '';
	const chars = [...s];
	if (chars.length <= n) return s;
	// Trailing space trimmed so the cut reads as `two words…`, not `two words …`.
	const kept = chars
		.slice(0, n - 1)
		.join('')
		.trimEnd();
	return `${kept}…`;
}

/**
 * Up to two initials, for an avatar with no picture behind it.
 *
 * First letter of the first word and of the last, so `Ada Lovelace King`
 * gives `AK` — the middle name is the part nobody uses to tell two people
 * apart. Split on anything that is not a letter or a digit, which handles
 * `jean-luc picard`, `ada.lovelace` and stray punctuation without a case each.
 */
export function initials(name: string): string {
	const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
	if (!words.length) return '';
	// Spread rather than [0], so a name starting with an astral glyph yields
	// that glyph instead of half of it.
	const first = [...words[0]][0];
	const last = words.length > 1 ? [...words[words.length - 1]][0] : '';
	return (first + last).toUpperCase();
}
