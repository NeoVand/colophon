import { db } from '$lib/server/db';
import { documents, type DocumentKind } from '$lib/server/db/documents.schema';
import { and, desc, eq, like, ne, or, sql } from 'drizzle-orm';

/**
 * The research vault, as a document store.
 *
 * `subscriptions.ts` is the reading side of Colophon — what it follows, what it
 * found, what it drafted. This is the writing side. Same shape deliberately:
 * plain async functions over drizzle, no repository class, no ORM session, and
 * every query scoped by nothing because there is one reader. If accounts ever
 * arrive, this file grows a `resourceId` column and the callers do not change.
 *
 * The slug helpers at the top are pure and exported for that reason: they are
 * the only part of this file with behaviour worth pinning down, and they can be
 * tested without a database being anywhere near the test run.
 */

export type Document = typeof documents.$inferSelect;

/**
 * A vault row without its body.
 *
 * The index page lists everything and renders none of it. Selecting `body`
 * there means two hundred documents' full text crossing the wire to produce a
 * list of titles — so the body is replaced by the two facts a list actually
 * shows: how long it is, and how it starts.
 */
export interface DocumentSummary {
	id: string;
	title: string;
	kind: DocumentKind;
	slug: string;
	tags: string[];
	createdAt: Date;
	updatedAt: Date;
	chars: number;
	excerpt: string;
}

function newId(): string {
	return `doc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/* ── slugs ───────────────────────────────────────────────────────────────── */

/**
 * A title, reduced to something a URL can carry.
 *
 * Decomposing to NFKD and dropping the combining marks is what turns "Gödel"
 * into `godel` rather than `g-del`: the diacritic becomes its own code point
 * and is deleted, leaving the base letter behind. Apostrophes are deleted
 * outright rather than collapsed with the other punctuation, because "don't"
 * should be `dont` and not `don-t`.
 *
 * The 80-character cap is trimmed *after* slicing, since a cut that lands
 * mid-word leaves the hyphen that separated it dangling on the end.
 *
 * A title with no ASCII letters at all — a purely CJK heading, or one made of
 * symbols — reduces to nothing, and gets `untitled`. That is not a failure to
 * paper over: `uniqueSlug` then numbers them, and `getDocument` resolves an id
 * as readily as a slug, so such a document is fully reachable. Transliterating
 * scripts we cannot round-trip would produce a name its author does not
 * recognise, which is worse than an honest one.
 */
export function slugify(title: string): string {
	const slug = title
		.normalize('NFKD')
		// The combining-mark block, written as escapes: the literal characters are
		// invisible in an editor and do not survive a careless copy-paste.
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/['\u2018\u2019]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/g, '');
	return slug || 'untitled';
}

/**
 * The same slug, made distinct from the ones already taken.
 *
 * Counting starts at 2 because that is what the words mean: `notes-on-attention`
 * and `notes-on-attention-2` read as the first and the second. Starting at 1
 * implies the original was zero, and produces the mildly insulting result that
 * the first document you ever wrote is `-1`.
 *
 * `desired` is slugified here rather than by the caller, so it does not matter
 * whether it arrives as a raw title or an already-clean slug — `slugify` is
 * idempotent, and callers do not have to know which they are holding.
 *
 * The escape hatch at 1000 is not defensive theatre: without it a caller who
 * passes an unbounded `taken` set gets an infinite loop inside a request
 * handler. A timestamp suffix cannot collide and ends the search.
 */
export function uniqueSlug(desired: string, taken: Iterable<string>): string {
	const base = slugify(desired);
	const used = taken instanceof Set ? taken : new Set(taken);
	if (!used.has(base)) return base;

	for (let n = 2; n < 1000; n++) {
		const candidate = `${base}-${n}`;
		if (!used.has(candidate)) return candidate;
	}
	return `${base}-${Date.now().toString(36)}`;
}

/**
 * Every slug that could collide with this one, and no others.
 *
 * The `like` pattern is safe unescaped for a reason worth stating rather than
 * trusting: `slugify` emits only `[a-z0-9-]`, so neither `%` nor `_` — LIKE's
 * two metacharacters — can survive into `base`. If `slugify`'s character class
 * is ever widened, this is the call that quietly starts matching too much.
 *
 * `exceptId` exists for renames: a document keeping its own slug must not be
 * told that slug is taken by itself.
 */
async function takenSlugs(base: string, exceptId?: string): Promise<string[]> {
	const collision = or(eq(documents.slug, base), like(documents.slug, `${base}-%`));
	const rows = await db
		.select({ slug: documents.slug })
		.from(documents)
		.where(exceptId ? and(collision, ne(documents.id, exceptId)) : collision);
	return rows.map((r) => r.slug);
}

/* ── reading ─────────────────────────────────────────────────────────────── */

/**
 * The vault, most recently touched first.
 *
 * `mapWith(Number)` on the length: `length()` is an int4 and the neon driver
 * returns it as a number today, but a computed column's type is the driver's
 * business and not something a list page should be exposed to.
 */
export async function listDocuments(limit = 200): Promise<DocumentSummary[]> {
	return db
		.select({
			id: documents.id,
			title: documents.title,
			kind: documents.kind,
			slug: documents.slug,
			tags: documents.tags,
			createdAt: documents.createdAt,
			updatedAt: documents.updatedAt,
			chars: sql<number>`length(${documents.body})`.mapWith(Number),
			excerpt: sql<string>`left(${documents.body}, 280)`
		})
		.from(documents)
		.orderBy(desc(documents.updatedAt))
		.limit(limit);
}

/**
 * One document, by whichever name the caller happens to hold.
 *
 * A route addresses a document by slug, an editor holds its id, and a link
 * pasted from either has to work. One lookup serving both means no caller has
 * to decide which kind of string it has — and since ids carry a `doc_` prefix
 * and slugs cannot (slugify strips the underscore), the two namespaces cannot
 * overlap.
 */
export async function getDocument(idOrSlug: string): Promise<Document | undefined> {
	const [row] = await db
		.select()
		.from(documents)
		.where(or(eq(documents.id, idOrSlug), eq(documents.slug, idOrSlug)))
		.limit(1);
	return row;
}

/* ── writing ─────────────────────────────────────────────────────────────── */

export async function createDocument(input: {
	title?: string;
	kind?: DocumentKind;
	body?: string;
	tags?: string[];
	/** Override the slug the title would produce. De-duplicated either way. */
	slug?: string;
}): Promise<Document> {
	const title = input.title?.trim() || 'Untitled';
	const base = slugify(input.slug || title);
	const slug = uniqueSlug(base, await takenSlugs(base));

	const [row] = await db
		.insert(documents)
		.values({
			id: newId(),
			title,
			kind: input.kind ?? 'markdown',
			body: input.body ?? '',
			slug,
			tags: input.tags ?? []
		})
		.returning();
	return row;
}

/**
 * Change what a document says, and record that it changed.
 *
 * ── The title is not the slug ───────────────────────────────────────────────
 * Renaming does not re-slug. It is tempting — the URL then matches the title —
 * but it means every rename silently breaks every link that ever pointed at the
 * document, including the ones in other documents in this same vault. A slug
 * changes only when a caller passes one explicitly, which is a deliberate act
 * with a visible consequence.
 *
 * `updatedAt` is written here rather than by a column-level `$onUpdate`. The
 * one place it must be right is this function, and stating it in the `set`
 * means the fact is visible where the write is, instead of in a schema file
 * nobody reads while debugging a stale ordering.
 *
 * Returns undefined for an id that is not there, rather than throwing: a stale
 * tab saving into a deleted document is an ordinary event, not an exception.
 */
export async function updateDocument(
	id: string,
	patch: { title?: string; kind?: DocumentKind; body?: string; tags?: string[]; slug?: string }
): Promise<Document | undefined> {
	const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };

	if (patch.title !== undefined) set.title = patch.title.trim() || 'Untitled';
	if (patch.kind !== undefined) set.kind = patch.kind;
	if (patch.body !== undefined) set.body = patch.body;
	if (patch.tags !== undefined) set.tags = patch.tags;
	if (patch.slug !== undefined) {
		const base = slugify(patch.slug);
		set.slug = uniqueSlug(base, await takenSlugs(base, id));
	}

	const [row] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
	return row;
}

/**
 * Gone, and gone for good.
 *
 * No soft delete, and that is a decision rather than an omission. A `deletedAt`
 * column means every query in this file grows a predicate, and the one that
 * forgets it shows a deleted draft in a list — which is a worse failure than
 * not having the draft. The vault's undo is version control on the exported
 * files, not a flag in a row.
 */
export async function removeDocument(id: string): Promise<void> {
	await db.delete(documents).where(eq(documents.id, id));
}
