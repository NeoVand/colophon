import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { isDatabaseConfigured } from '$lib/server/db';

/**
 * Attach the session, when there is somewhere to keep sessions.
 *
 * Before a database is provisioned, Colophon still has to serve the Lab — the
 * browser-only half runs a whole Mastra harness with no server state at all, and
 * it would be absurd for it to 500 because Postgres is missing. So when storage
 * is unconfigured we simply serve every request unauthenticated. Study mode's
 * routes check `locals.user` and will refuse on their own.
 */
const handleBetterAuth: Handle = async ({ event, resolve }) => {
	if (!isDatabaseConfigured()) return resolve(event);

	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
