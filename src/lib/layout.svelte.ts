import { browser } from '$app/environment';

/**
 * Where the furniture is.
 *
 * The flank used to be a hard 22rem, which is a decision about someone else's
 * monitor. This holds the things a reader is allowed to move — how wide the
 * flank is, which instruments are in it, and in what order — and remembers
 * them.
 *
 * Two keys rather than one, on purpose. The width is written *during a drag*,
 * by `Split.svelte`, hundreds of times a minute; the shape changes when someone
 * reorders or hides something, which is rare. Keeping them apart means a drag
 * never has to serialise the whole layout, and a corrupt shape blob cannot cost
 * you your column width.
 *
 * Everything here is guarded by `browser`. On the server this module is shared
 * between requests, so it must stay at its defaults there — no read, and more
 * importantly no write.
 */

/** The width key. `Split` writes it; this store reads it. One number, no JSON. */
export const FLANK_KEY = 'colophon:layout:flank';
const SHAPE_KEY = 'colophon:layout';
/** Kept separate from the shape so shutting the flank cannot lose the order. */
const OPEN_KEY = 'colophon:layout:open';

const DEFAULT_FLANK = 26;

/**
 * The flank stops being an instrument panel below about a sixth of the window,
 * and stops being a flank above about half. Both ends are clamps rather than
 * disabled drags: the pointer keeps moving, the column simply does not.
 */
const MIN_FLANK = 16;
const MAX_FLANK = 52;

export const clampFlank = (n: number): number => Math.min(MAX_FLANK, Math.max(MIN_FLANK, n));

interface Shape {
	order: string[];
	hidden: string[];
	collapsed: string[];
}

/**
 * Strings only, and each one once.
 *
 * The de-duplication is the load-bearing half. `order` is used as the key of an
 * `{#each}`; a repeated id there throws, and the throw *aborts the render* —
 * you get the previous frame's DOM frozen on screen rather than a misdrawn
 * list. localStorage is user-writable and survives every refactor that ever
 * renamed a panel, so it is treated as hostile input.
 */
function ids(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	return value
		.filter((v): v is string => typeof v === 'string')
		.filter((v, i, all) => all.indexOf(v) === i);
}

const same = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The saved order, reconciled with the panels that actually exist.
 *
 * Pure, and exported, because two things need this answer: the store, which
 * persists it, and the flank, which has to render *something* on the very first
 * frame — before anything has had a chance to seed the store.
 *
 * Saved ids that no longer exist are dropped; new ones land at the bottom,
 * which is the only honest place for them. A panel added in a release has no
 * claim on a position someone else chose.
 */
export function mergeOrder(saved: readonly string[], available: readonly string[]): string[] {
	return [
		...saved.filter((id) => available.includes(id)),
		...available.filter((id) => !saved.includes(id))
	];
}

class LayoutState {
	/** The flank's share of the window, in percent. */
	flank = $state(DEFAULT_FLANK);
	/** Panel ids, top to bottom. Seeded by `ensure()` from whatever is mounted. */
	order = $state<string[]>([]);
	/** Panels taken out of the flank entirely. */
	hidden = $state<string[]>([]);
	/** Panels folded down to their label. */
	collapsed = $state<string[]>([]);
	/**
	 * Whether the flank is on screen at all.
	 *
	 * Someone who wants a research companion and not an instrument panel should
	 * be able to shut the whole thing, and still find their panel arrangement
	 * untouched when they open it again.
	 */
	showFlank = $state(false);

	constructor() {
		// At construction rather than from `onMount`: this module is imported
		// before the first paint, so the saved order is in place for the first
		// frame instead of shuffling into position once it arrives.
		this.start();
	}

	/** Idempotent — safe to call again from `onMount` alongside the other stores. */
	start(): void {
		if (!browser) return;

		this.showFlank = localStorage.getItem(OPEN_KEY) === '1';

		const width = Number(localStorage.getItem(FLANK_KEY));
		if (Number.isFinite(width) && width > 0) this.flank = clampFlank(width);

		const raw = localStorage.getItem(SHAPE_KEY);
		if (!raw) return;
		try {
			const saved = JSON.parse(raw) as Partial<Shape>;
			this.order = ids(saved.order) ?? this.order;
			this.hidden = ids(saved.hidden) ?? this.hidden;
			this.collapsed = ids(saved.collapsed) ?? this.collapsed;
		} catch {
			// A half-written or hand-edited blob costs you your arrangement, not
			// your session. Falling through leaves the defaults standing.
		}
	}

	/**
	 * Write down the reconciled order — see `mergeOrder`.
	 *
	 * Writes nothing when nothing changed, so calling it repeatedly is free and
	 * it cannot feed an effect that reads `order`.
	 */
	ensure(available: readonly string[]): void {
		const next = mergeOrder(this.order, available);
		if (same(next, this.order)) return;
		this.order = next;
		this.#save();
	}

	setFlank(percent: number): void {
		const next = clampFlank(percent);
		if (next === this.flank) return;
		this.flank = next;
		if (!browser) return;
		try {
			localStorage.setItem(FLANK_KEY, String(Math.round(next * 100) / 100));
		} catch {
			// Private browsing, or a full quota. Not worth a broken layout.
		}
	}

	/** Move `id` so that it sits at `index`, clamped to the ends. */
	move(id: string, index: number): void {
		const from = this.order.indexOf(id);
		if (from === -1) return;
		const rest = this.order.filter((x) => x !== id);
		const to = Math.min(rest.length, Math.max(0, index));
		this.order = [...rest.slice(0, to), id, ...rest.slice(to)];
		this.#save();
	}

	/** Keyboard reordering: one step up or down. */
	nudge(id: string, delta: number): void {
		const from = this.order.indexOf(id);
		if (from === -1) return;
		this.move(id, from + delta);
	}

	isVisible = (id: string): boolean => !this.hidden.includes(id);

	toggleVisible(id: string): void {
		this.hidden = this.hidden.includes(id)
			? this.hidden.filter((x) => x !== id)
			: [...this.hidden, id];
		this.#save();
	}

	isCollapsed = (id: string): boolean => this.collapsed.includes(id);

	toggleCollapsed(id: string): void {
		this.collapsed = this.collapsed.includes(id)
			? this.collapsed.filter((x) => x !== id)
			: [...this.collapsed, id];
		this.#save();
	}

	/** Back to the shipped arrangement, width included. */
	toggleFlank(): void {
		this.showFlank = !this.showFlank;
		if (browser) localStorage.setItem(OPEN_KEY, this.showFlank ? '1' : '0');
	}

	reset(): void {
		this.hidden = [];
		this.collapsed = [];
		this.order = [];
		this.setFlank(DEFAULT_FLANK);
		this.#save();
	}

	#save(): void {
		if (!browser) return;
		const shape: Shape = {
			// `$state.snapshot` because these are proxies, and what goes to
			// localStorage should be plain data.
			order: $state.snapshot(this.order),
			hidden: $state.snapshot(this.hidden),
			collapsed: $state.snapshot(this.collapsed)
		};
		try {
			localStorage.setItem(SHAPE_KEY, JSON.stringify(shape));
		} catch {
			// See `setFlank`.
		}
	}
}

export const layout = new LayoutState();
