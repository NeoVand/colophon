import { db } from '$lib/server/db';
import { subscriptions, digests, papers } from '$lib/server/db/schema';
import { and, eq, isNull, lte, or, sql, desc } from 'drizzle-orm';

/**
 * What Colophon is following, and what it has produced.
 *
 * Every query here is scoped by `active` and `lastSweptAt` rather than by user,
 * because there is one reader. If accounts ever arrive, this is the file that
 * grows a `resourceId` column and nothing else needs to change.
 */

export type Subscription = typeof subscriptions.$inferSelect;
export type Digest = typeof digests.$inferSelect;

function newId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export async function listSubscriptions(): Promise<Subscription[]> {
	return db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
}

export async function createSubscription(input: {
	query: string;
	notes?: string;
	everyDays?: number;
}): Promise<Subscription> {
	const [row] = await db
		.insert(subscriptions)
		.values({
			id: newId('sub'),
			query: input.query.trim(),
			notes: input.notes?.trim() || null,
			everyDays: input.everyDays ?? 1
		})
		.returning();
	return row;
}

export async function setSubscriptionActive(id: string, active: boolean): Promise<void> {
	await db.update(subscriptions).set({ active }).where(eq(subscriptions.id, id));
}

export async function deleteSubscription(id: string): Promise<void> {
	await db.delete(subscriptions).where(eq(subscriptions.id, id));
}

/**
 * Subscriptions that are due.
 *
 * A subscription is due if it has never been swept, or if its interval has
 * elapsed. The comparison is against `lastSweptAt` rather than against a
 * calendar day, so a missed cron run is caught up on the next one instead of
 * being skipped — Vercel Hobby's cron is only accurate to the hour, and a
 * deploy or an outage should not silently lose a day of the literature.
 */
export async function dueSubscriptions(now = new Date()): Promise<Subscription[]> {
	return db
		.select()
		.from(subscriptions)
		.where(
			and(
				eq(subscriptions.active, true),
				or(
					isNull(subscriptions.lastSweptAt),
					lte(
						subscriptions.lastSweptAt,
						sql`${now.toISOString()}::timestamptz - (${subscriptions.everyDays} || ' days')::interval`
					)
				)
			)
		);
}

/**
 * The window a sweep should ask about.
 *
 * Never wider than 30 days: a subscription paused for six months should resume
 * with what is current, not attempt to review half a year at once and produce
 * something nobody will read.
 */
export function sweepSince(subscription: Subscription, now = new Date()): Date {
	const last = subscription.lastSweptAt?.getTime();
	const thirtyDays = 30 * 24 * 60 * 60 * 1000;
	const floor = now.getTime() - thirtyDays;
	if (!last) return new Date(now.getTime() - subscription.everyDays * 24 * 60 * 60 * 1000);
	return new Date(Math.max(last, floor));
}

export async function markSwept(id: string, at = new Date()): Promise<void> {
	await db.update(subscriptions).set({ lastSweptAt: at }).where(eq(subscriptions.id, id));
}

/* ── digests ─────────────────────────────────────────────────────────────── */

export async function recordDigest(input: {
	subscriptionId: string;
	title: string;
	body: string;
	sources: string[];
	verdict: 'sent' | 'withheld' | 'failed';
	reason?: string;
}): Promise<Digest> {
	const [row] = await db
		.insert(digests)
		.values({
			id: newId('dig'),
			subscriptionId: input.subscriptionId,
			title: input.title,
			body: input.body,
			sources: input.sources,
			verdict: input.verdict,
			reason: input.reason ?? null,
			deliveredAt: input.verdict === 'sent' ? new Date() : null
		})
		.returning();
	return row;
}

export async function listDigests(limit = 50): Promise<Digest[]> {
	return db.select().from(digests).orderBy(desc(digests.createdAt)).limit(limit);
}

/* ── the library ─────────────────────────────────────────────────────────── */

/**
 * Remember a paper, without ever forgetting that it was read.
 *
 * The upsert deliberately does not overwrite `depth` or `blobKey` downward: a
 * paper met again in a search must not lose the fact that its full text was
 * fetched last month. That single property is what makes "you have already read
 * this" possible, and it is the difference between a library and a log.
 */
export async function rememberPaper(input: {
	id: string;
	arxivId?: string;
	doi?: string;
	title: string;
	authors: string[];
	year?: number;
	url: string;
	citedBy?: number;
	abstract?: string;
	depth: 'listed' | 'read';
	blobKey?: string;
	chars?: number;
}): Promise<void> {
	await db
		.insert(papers)
		.values({
			id: input.id,
			arxivId: input.arxivId ?? null,
			doi: input.doi ?? null,
			title: input.title,
			authors: input.authors,
			year: input.year ?? null,
			url: input.url,
			citedBy: input.citedBy ?? null,
			abstract: input.abstract ?? null,
			depth: input.depth,
			blobKey: input.blobKey ?? null,
			chars: input.chars ?? null,
			readAt: input.depth === 'read' ? new Date() : null
		})
		.onConflictDoUpdate({
			target: papers.id,
			set: {
				title: sql`excluded.title`,
				citedBy: sql`coalesce(excluded.cited_by, ${papers.citedBy})`,
				abstract: sql`coalesce(excluded.abstract, ${papers.abstract})`,
				// Depth ratchets one way only.
				depth: sql`case when ${papers.depth} = 'read' then 'read' else excluded.depth end`,
				blobKey: sql`coalesce(excluded.blob_key, ${papers.blobKey})`,
				chars: sql`coalesce(excluded.chars, ${papers.chars})`,
				readAt: sql`coalesce(${papers.readAt}, excluded.read_at)`
			}
		});
}

/** Papers already met, so a sweep can skip what has been reviewed before. */
export async function knownPaperIds(ids: string[]): Promise<Set<string>> {
	if (!ids.length) return new Set();
	const rows = await db
		.select({ id: papers.id })
		.from(papers)
		.where(sql`${papers.id} = any(${ids})`);
	return new Set(rows.map((r) => r.id));
}
