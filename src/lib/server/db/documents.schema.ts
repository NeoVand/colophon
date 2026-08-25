import { pgTable, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * The vault's other half: what the reader writes.
 *
 * `schema.ts` holds what the sweep *produces* — subscriptions, the papers it
 * met, the digests it drafted. All of it arrives. This table holds what
 * arrives at nobody: notes, blog drafts, review chapters, eventually papers.
 * A digest is something you received and can delete without loss; a document
 * is the thing the received material was for.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 * Writing and sweeping fail independently, and they should be able to. The
 * sweep can be off for a month, or its tables re-cut entirely, and none of that
 * should be able to touch a draft. Keeping the two schemas apart is what makes
 * "the vault still opens" true while the agent side is being changed.
 *
 * The cost is one line of configuration, and it is a silent one, so it is
 * written here as well as there: `drizzle.config.ts` names a single `schema`
 * file and a `tablesFilter`. Both need this file and the string 'documents'
 * added, or `drizzle-kit push` ignores the table completely and reports success.
 */

/**
 * How a document is *rendered*, never what it is about.
 *
 * Four, because four are the formats scientific writing actually leaves the
 * building in. `markdown` is the default and covers notes and blogs; `typst`
 * and `latex` are what a paper is set in; `html` is what a pasted or exported
 * page arrives as.
 *
 * A text column with a TypeScript union rather than a Postgres enum: adding a
 * fifth kind to an enum is a migration and a lock, here it is a type change and
 * a renderer branch. Nothing in the database ever compares kinds or orders
 * them, so the enum buys only a constraint the application already enforces.
 */
export const DOCUMENT_KINDS = ['markdown', 'typst', 'latex', 'html'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const documents = pgTable(
	'documents',
	{
		id: text('id').primaryKey(),

		/**
		 * Never null, and never empty — `createDocument` writes 'Untitled' rather
		 * than leaving this blank. Every list, every tab and every search result
		 * prints this, and a nullable title means each of them grows its own
		 * fallback, which is how three different words for "no title" end up on
		 * one screen.
		 */
		title: text('title').notNull(),

		kind: text('kind').$type<DocumentKind>().notNull().default('markdown'),

		/**
		 * The source, in Postgres — deliberately breaking the rule `papers`
		 * follows.
		 *
		 * `storage.ts` says Postgres stores what you search and R2 stores what you
		 * read, and for a paper's full text that is right: 50–200 KB, fetched once,
		 * never edited. A document is the opposite on every count. It is edited
		 * constantly, and editing a blob is read-modify-write across two systems
		 * with no transaction between them — the failure mode is a save that
		 * half-lands and a draft that is now neither version.
		 *
		 * The size argument agrees. A long blog post is 10–20 KB; a chapter is
		 * perhaps 60 KB. A thousand of them is 20 MB against Neon's 0.5 GB, and
		 * the day that stops being true is the day this column grows a `blobKey`
		 * beside it — not before.
		 */
		body: text('body').notNull().default(''),

		/**
		 * The name a link uses.
		 *
		 * `id` is what the database joins on and what an editor holds; `slug` is
		 * what a URL says out loud, and the two are separate so that neither
		 * constrains the other. Unique, because a slug that is not unique is a
		 * link that resolves to whichever row the planner reached first.
		 *
		 * It does **not** follow the title. Renaming a draft is a normal act;
		 * silently breaking every link that pointed at it is not.
		 */
		slug: text('slug').notNull(),

		/**
		 * The writer's own filing, not a taxonomy.
		 *
		 * jsonb rather than a join table because these are read exactly once, with
		 * the document, and never counted, joined or ranked across the corpus. A
		 * `document_tags` table would be a migration and a second query to return
		 * what one column already returns. If tags ever need to be faceted — "show
		 * me everything tagged mechinterp, newest first" — that is the query that
		 * earns the join table, and it does not exist yet.
		 */
		tags: jsonb('tags').$type<string[]>().notNull().default([]),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

		/**
		 * Two timestamps because they answer different questions: `createdAt` is
		 * "when did I start this", `updatedAt` is "is this still warm". A vault
		 * ordered by creation buries the chapter edited an hour ago under the
		 * note started last spring, which is the wrong answer to the only question
		 * an index page is asked.
		 */
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('documents_slug_idx').on(table.slug),
		/**
		 * The vault's default order, and the reason the list page is one index
		 * scan. Not declared descending: Postgres reads a b-tree in either
		 * direction at the same cost, so the ascending index serves
		 * `order by updated_at desc` unchanged.
		 */
		index('documents_updated_idx').on(table.updatedAt)
	]
);
