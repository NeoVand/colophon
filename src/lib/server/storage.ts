import { env } from '$env/dynamic/private';
import { PostgresStore } from '@mastra/pg';
import { Memory } from '@mastra/memory';

/**
 * Where Colophon keeps things.
 *
 * One module, because the plan's escape hatch depends on it: the natural
 * upgrade from Vercel Hobby is *sideways* to Cloudflare Workers at $5, not up
 * to Vercel Pro at $20, and that move is only cheap if every storage call goes
 * through one door. Swapping `PostgresStore` for `D1Store` should be an edit
 * here and nowhere else.
 *
 * ── What goes where ─────────────────────────────────────────────────────────
 * Neon's free tier is **0.5 GB**, and a single arXiv paper's full text is
 * 50–200 KB. A few thousand papers would fill it, and a research vault that
 * stops accepting papers is not a research vault. So:
 *
 *   Postgres  — threads, messages, working memory, embeddings, and *metadata*
 *               about sources: identity, authors, citation counts.
 *   R2        — full text, PDFs, generated figures. 10 GB free, and zero egress
 *               fees, which matters because the lab re-reads what it stored.
 *
 * The rule to hold onto: Postgres stores what you *search*, R2 stores what you
 * *read*. Anything big enough to be worth measuring belongs in R2.
 */

/**
 * Neon hands out two connection strings. The pooled one (`DATABASE_URL`) goes
 * through PgBouncer and is right for serverless, where every invocation is a
 * new client and connection slots are the scarce resource. The unpooled one is
 * kept for migrations, which need a session that survives more than a
 * statement.
 */
export function connectionString(): string {
	const url = env.DATABASE_URL;
	if (!url || url.includes('user:password@host:port')) {
		throw new Error(
			'DATABASE_URL is not set (or is still the scaffold placeholder). ' +
				'Run `vercel env pull .env.local` after connecting a database.'
		);
	}
	return url;
}

export function migrationConnectionString(): string {
	return env.DATABASE_URL_UNPOOLED ?? connectionString();
}

export function isStorageConfigured(): boolean {
	const url = env.DATABASE_URL;
	return Boolean(url) && !url.includes('user:password@host:port');
}

/**
 * Built once per process and reused.
 *
 * A Vercel function is warm across requests, so rebuilding the store per
 * request would open a new pool every time and exhaust Neon's connection
 * budget under any real load. Module scope is the right lifetime here — but it
 * is created lazily, so a page that touches no storage still costs nothing.
 */
let store: PostgresStore | undefined;

export function storage(): PostgresStore {
	// `id` is required and undocumented: without it the constructor throws
	// MASTRA_STORAGE_PG_INITIALIZATION_FAILED with "id must be provided and
	// cannot be empty". It namespaces the store within a Mastra instance.
	store ??= new PostgresStore({ id: 'colophon', connectionString: connectionString() });
	return store;
}

let memory: Memory | undefined;

/**
 * The agent's memory.
 *
 * Working memory is **resource-scoped** rather than thread-scoped, which is the
 * whole point of the feature here: what Colophon learns about what you care
 * about should survive the end of a conversation. A thread is one sitting; the
 * interest profile is the thing that accumulates across all of them, and it is
 * what makes "what changed since I last looked at this" answerable at all.
 */
export function agentMemory(): Memory {
	memory ??= new Memory({
		storage: storage(),
		options: {
			workingMemory: {
				enabled: true,
				scope: 'resource',
				template: `# Reader profile

## Fields followed
<!-- topics, with why they matter and how closely to track them -->

## Background
<!-- what can be assumed known, so reviews pitch at the right level -->

## Preferences
<!-- desired length, tone, formality; whether to include figures -->

## Standing questions
<!-- open threads to watch for answers to -->
`
			}
		}
	});
	return memory;
}

/** The single resource id: Colophon has one reader. */
export const READER = 'neo';
