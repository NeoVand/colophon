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

/**
 * The type is inferred from our own builder rather than written as
 * `ReturnType<typeof betterAuth>`. better-auth returns an `Auth` parameterised
 * by the exact options object it was given, so the generic default is a
 * *different, incompatible* type — annotating with it forces a cast that TS
 * rightly rejects.
 */
function construct() {
	return betterAuth({
		baseURL: env.ORIGIN,
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, { provider: 'pg' }),
		emailAndPassword: { enabled: true },
		plugins: [
			sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
		]
	});
}

type Auth = ReturnType<typeof construct>;

let instance: Auth | undefined;

function build(): Auth {
	instance ??= construct();
	return instance;
}

export const auth = new Proxy({} as Auth, {
	get: (_target, key) => Reflect.get(build() as object, key)
});
