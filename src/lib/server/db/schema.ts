import {
	pgTable,
	text,
	integer,
	timestamp,
	boolean,
	jsonb,
	index,
	uniqueIndex
} from 'drizzle-orm/pg-core';

/**
 * Colophon's own tables.
 *
 * Mastra owns its forty-odd `mastra_*` tables for threads, messages, working
 * memory and embeddings; these are the domain on top of that — what is being
 * followed, what has been read, and what was written about it.
 *
 * Nothing large lives here. Neon's free tier is 0.5 GB and one paper's full
 * text is 50–200 KB, so `papers` keeps identity and metadata while the text
 * itself goes to blob storage under `blobKey`. The rule, from
 * `src/lib/server/storage.ts`: Postgres stores what you search, R2 stores what
 * you read.
 */

/**
 * A field being followed.
 *
 * `notes` is the most important column and the least obvious: it records *why*
 * this topic is being followed, in the reader's own words, and it goes into the
 * prompt when a sweep runs. "Following diffusion models" and "following
 * diffusion models because I want to know when sampling gets cheap enough for
 * real-time video" produce very different digests, and only the second can
 * decide that a paper is not worth mentioning.
 */
export const subscriptions = pgTable(
	'subscriptions',
	{
		id: text('id').primaryKey(),
		query: text('query').notNull(),
		notes: text('notes'),
		/** Days between sweeps. Vercel Hobby cron fires daily; this throttles further. */
		everyDays: integer('every_days').notNull().default(1),
		active: boolean('active').notNull().default(true),
		/**
		 * The high-water mark. A sweep asks for papers published since this, so a
		 * missed day is caught up rather than skipped — the reason this is a
		 * timestamp and not simply "yesterday".
		 */
		lastSweptAt: timestamp('last_swept_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('subscriptions_active_idx').on(table.active, table.lastSweptAt)]
);

/**
 * The library: every paper Colophon has met, and how well it knows it.
 *
 * `depth` mirrors the in-run source registry — 'listed' means only an abstract
 * was ever seen, 'read' means the full text was fetched. Keeping it here is
 * what lets a later run know it has already read something, and what makes
 * "never review the same paper at you twice" possible.
 */
export const papers = pgTable(
	'papers',
	{
		id: text('id').primaryKey(),
		arxivId: text('arxiv_id'),
		doi: text('doi'),
		title: text('title').notNull(),
		authors: jsonb('authors').$type<string[]>().notNull().default([]),
		year: integer('year'),
		url: text('url').notNull(),
		citedBy: integer('cited_by'),
		abstract: text('abstract'),
		depth: text('depth').$type<'listed' | 'read'>().notNull().default('listed'),
		/** Where the full text lives in blob storage. Null until it is read. */
		blobKey: text('blob_key'),
		chars: integer('chars'),
		firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
		readAt: timestamp('read_at', { withTimezone: true })
	},
	(table) => [
		uniqueIndex('papers_arxiv_idx').on(table.arxivId),
		index('papers_first_seen_idx').on(table.firstSeenAt)
	]
);

/**
 * What a sweep produced, whether or not it was sent.
 *
 * Withheld digests are kept deliberately. The delivery gate's whole purpose is
 * to stay silent on a thin week, and a gate whose rejections vanish is
 * impossible to tune — you cannot tell "nothing happened in the field" from
 * "the gate is too strict" without the rejected drafts and their reasons.
 */
export const digests = pgTable(
	'digests',
	{
		id: text('id').primaryKey(),
		subscriptionId: text('subscription_id').references(() => subscriptions.id, {
			onDelete: 'cascade'
		}),
		title: text('title').notNull(),
		body: text('body').notNull(),
		/** Paper ids consulted, in the order the digest cites them. */
		sources: jsonb('sources').$type<string[]>().notNull().default([]),
		verdict: text('verdict').$type<'sent' | 'withheld' | 'failed'>().notNull(),
		/** Why the gate withheld it, in the gate's own words. */
		reason: text('reason'),
		deliveredAt: timestamp('delivered_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('digests_subscription_idx').on(table.subscriptionId, table.createdAt)]
);

/**
 * better-auth's tables are deliberately not re-exported.
 *
 * The gate (`src/lib/server/gate.ts`) is a password and a signed cookie, so
 * better-auth is installed but unused and its tables would be empty clutter in
 * a 0.5 GB budget. The schema file stays on disk for the day real accounts are
 * wanted; it simply is not part of what gets pushed.
 */
