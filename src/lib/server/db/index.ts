import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

/**
 * The database connection, built on first use rather than on import.
 *
 * The scaffold connected at module load and threw if `DATABASE_URL` was absent.
 * That is wrong twice over. Locally it means one unset variable takes down every
 * route, including the pages that never touch a database — during M0 it stopped
 * the browser probe from rendering at all. In production it means a cold start
 * pays for a connection the request may never use.
 *
 * A lazy proxy fixes both: nothing happens until someone actually reads a
 * property off `db`, and the failure lands at the query that needed it, naming
 * itself, instead of at import time.
 */

let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Whether storage is configured. Callers use this to degrade honestly. */
export function isDatabaseConfigured(): boolean {
	const url = env.DATABASE_URL;
	return Boolean(url) && !url.includes('user:password@host:port');
}

function connect() {
	if (instance) return instance;
	if (!isDatabaseConfigured()) {
		throw new Error(
			'DATABASE_URL is not set (or is still the scaffold placeholder). ' +
				'Provision a Neon database and put its connection string in .env.'
		);
	}
	instance = drizzle(neon(env.DATABASE_URL), { schema });
	return instance;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
	get: (_target, key) => Reflect.get(connect(), key),
	has: (_target, key) => Reflect.has(connect(), key)
});
