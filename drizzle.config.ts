import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL },

	/**
	 * Drizzle shares this database with Mastra, which owns forty-odd `mastra_*`
	 * tables for threads, messages, working memory and embeddings.
	 *
	 * `drizzle-kit push` syncs the database *to* the schema — meaning it offers
	 * to drop anything it does not recognise. Without this filter it treats every
	 * Mastra table as an orphan and asks whether to delete it, which is one
	 * mistyped keystroke away from destroying all conversation history.
	 *
	 * The filter scopes drizzle to the tables it actually owns. Anything added to
	 * `schema.ts` must be added here too, or push will silently ignore it.
	 */
	tablesFilter: ['subscriptions', 'papers', 'digests'],

	verbose: true,
	strict: true
});
