/**
 * The thread index — the list of conversations you can get back to.
 *
 * `session.svelte.ts` already parks the *current* conversation id in
 * localStorage under `colophon:thread`, and until now that was the whole of
 * history: a reload rejoined the last thread, and every thread before it was
 * unreachable. Pressing "new thread" quietly ended the previous one. The work
 * was not deleted — it is still in the agent's memory, keyed by an id — it was
 * simply no longer addressable, because nothing on the client remembered the
 * id. That is the worst kind of data loss: the sort that leaves no trace of
 * having happened.
 *
 * So this is an index, and deliberately *only* an index: ids, titles,
 * timestamps and turn counts, never messages. The transcript belongs to the
 * agent's memory. Copying it here would put a second version of every
 * conversation into a ~5 MB synchronous store, and the two would disagree the
 * first time one of them failed to write.
 *
 * A pure module rather than a rune store, because it is called from three
 * unrelated places — the send path, the header, the thread list — and none of
 * them should have to be its owner. Callers read after they write.
 */

export interface ThreadEntry {
	id: string;
	title: string;
	/** Last written to or opened, ms since the epoch. */
	at: number;
	/** Questions asked in it, not messages exchanged. */
	turns: number;
}

const KEY = 'colophon:threads';

/** About one line at the size the list renders it. */
const TITLE_MAX = 60;

/** A renamed title is the reader's own words, so it gets more rope — but not
    unbounded rope, since this is a shared origin-wide byte budget. */
const RENAME_MAX = 200;

/**
 * The index is capped, oldest first out.
 *
 * localStorage is a ~5 MB budget for the whole origin and every read of it is
 * synchronous, so an index that grows forever eventually parses a long array on
 * the send path. Two hundred threads is far more history than anyone scrolls,
 * and evicting by age is the only rule that never surprises: what you lose is
 * what you last touched longest ago.
 */
const LIMIT = 200;

/**
 * The store, looked up per call rather than captured.
 *
 * SvelteKit imports this module during SSR, where `localStorage` is not merely
 * empty but absent — a module-level reference would throw at import time and
 * take the whole route down before anything rendered. Per call also means the
 * very first client render, and the tests, can install the global after this
 * module has been evaluated.
 */
function store(): Storage | undefined {
	return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function isEntry(value: unknown): value is ThreadEntry {
	if (!value || typeof value !== 'object') return false;
	const e = value as Partial<ThreadEntry>;
	return (
		typeof e.id === 'string' &&
		e.id !== '' &&
		typeof e.title === 'string' &&
		typeof e.at === 'number' &&
		Number.isFinite(e.at) &&
		typeof e.turns === 'number'
	);
}

function read(): ThreadEntry[] {
	const raw = store()?.getItem(KEY);
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		// Row-by-row rather than all-or-nothing: one malformed entry from an
		// older shape should cost that row, not the reader's whole history.
		return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
	} catch {
		// A truncated or hand-edited value is not worth a throw on the one
		// surface whose entire job is not losing things. The next write replaces it.
		return [];
	}
}

function write(entries: ThreadEntry[]): void {
	const target = store();
	if (!target) return;
	// Sorted before slicing, so the cap always drops the least recent and never
	// whatever happened to be pushed last.
	const ordered = [...entries].sort((a, b) => b.at - a.at).slice(0, LIMIT);
	try {
		target.setItem(KEY, JSON.stringify(ordered));
	} catch {
		// Quota exhausted, or Safari private browsing, where `setItem` throws on
		// every call. Losing an index entry is bad; losing the question the
		// reader just typed because the index could not be updated is worse, and
		// every caller here sits on the send path.
	}
}

/**
 * A title from the opening message.
 *
 * Cut on a word boundary when there is one near the limit: a title that stops
 * mid-word reads as corruption rather than as truncation, and the reader has to
 * look twice to decide which it is.
 */
function titleFor(message: string): string {
	const line = message.replace(/\s+/g, ' ').trim();
	if (!line) return 'Untitled thread';
	if (line.length <= TITLE_MAX) return line;

	const cut = line.slice(0, TITLE_MAX);
	const space = cut.lastIndexOf(' ');
	return `${space > TITLE_MAX * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** Every thread, most recently touched first. */
export function list(): ThreadEntry[] {
	return read().sort((a, b) => b.at - a.at);
}

/**
 * Note a question asked in a thread, creating the entry if this is the first.
 *
 * The title is fixed at the *opening* message and never revised. A thread that
 * retitled itself to whatever you last asked would be unfindable by the one
 * thing you remember about it, which is how it started.
 */
export function record(id: string, firstMessage: string): void {
	if (!id) return;

	const entries = read();
	const existing = entries.find((e) => e.id === id);
	if (existing) {
		existing.turns += 1;
		existing.at = Date.now();
	} else {
		entries.push({ id, title: titleFor(firstMessage), at: Date.now(), turns: 1 });
	}
	write(entries);
}

/**
 * Give a thread a name of your own.
 *
 * Deliberately does not bump `at`. Renaming is not activity, and a list that
 * reordered itself under the cursor while you were editing a title would be
 * unusable.
 */
export function rename(id: string, title: string): void {
	const next = title.replace(/\s+/g, ' ').trim();
	// An empty title leaves a row that cannot be identified, which is worse than
	// the machine-made one it would replace.
	if (!next) return;

	const entries = read();
	const entry = entries.find((e) => e.id === id);
	if (!entry) return;

	entry.title = next.slice(0, RENAME_MAX);
	write(entries);
}

export function remove(id: string): void {
	const entries = read();
	const next = entries.filter((e) => e.id !== id);
	// Nothing matched: leave the stored bytes alone rather than rewriting them
	// identically, so a delete of an unknown id cannot cost a quota failure.
	if (next.length === entries.length) return;
	write(next);
}

/**
 * Mark a thread as visited, so re-opening an old one floats it back up.
 *
 * Creates nothing. A thread with no question in it has no title to give, and an
 * "Untitled thread" row for every time someone pressed new-thread and changed
 * their mind is litter in the one list that should only hold real work.
 */
export function touch(id: string): void {
	const entries = read();
	const entry = entries.find((e) => e.id === id);
	if (!entry) return;

	entry.at = Date.now();
	write(entries);
}

/**
 * Forget every thread.
 *
 * Only the index — the conversations themselves live in Mastra's storage and
 * are still there. This is "stop showing me these", not "destroy the work",
 * and the settings sheet says so rather than implying otherwise.
 */
export function clear(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(KEY);
}
