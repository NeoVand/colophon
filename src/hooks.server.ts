import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, isGateConfigured, sessionIsValid } from '$lib/server/gate';

/**
 * Nothing gets past here without the password.
 *
 * Colophon is deployed publicly and carries a provider key, so an open route is
 * an open wallet. The allowlist below is deliberately tiny: the login page, and
 * the assets the login page needs to render.
 *
 * If the gate is unconfigured we fail *closed* in production rather than
 * serving an open app — the failure mode of a forgotten environment variable
 * should be an outage, not a stranger spending your credits. In development
 * there is no key worth stealing and a password prompt on every reload is a
 * tax, so it runs open and says so.
 */

const PUBLIC_PATHS = new Set(['/login']);

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (!isGateConfigured()) {
		if (!dev) {
			error(
				503,
				'COLOPHON_PASSWORD is not set. Refusing to serve an ungated deployment that holds a provider key.'
			);
		}
		event.locals.authenticated = true;
		return resolve(event);
	}

	const authenticated = await sessionIsValid(event.cookies.get(SESSION_COOKIE));
	event.locals.authenticated = authenticated;

	if (authenticated || PUBLIC_PATHS.has(pathname)) return resolve(event);

	// An API caller wants a status code, not a login page it cannot render.
	if (pathname.startsWith('/api/')) error(401, 'Not signed in.');

	redirect(303, `/login?next=${encodeURIComponent(pathname)}`);
};
