import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';

/**
 * Auth, constructed on first use — for the same reason `db` is. Building it at
 * import time drags the database connection in with it, so an unconfigured
 * database would break every page rather than just the signed-in ones.
 */

let instance: ReturnType<typeof betterAuth> | undefined;

function build() {
	if (!instance) {
		instance = betterAuth({
			baseURL: env.ORIGIN,
			secret: env.BETTER_AUTH_SECRET,
			database: drizzleAdapter(db, { provider: 'pg' }),
			emailAndPassword: { enabled: true },
			plugins: [
				sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
			]
		});
	}
	return instance;
}

export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
	get: (_target, key) => Reflect.get(build(), key)
});
