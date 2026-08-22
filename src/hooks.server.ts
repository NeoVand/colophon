import type { Handle, RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
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
 * should be an outage, not a stranger spending your credits.
 *
 * ── The dev bypass ──────────────────────────────────────────────────────────
 * This used to run open in development only when no password was configured,
 * which turned out to be the wrong condition. `.env` has a password in it — it
 * is the same file the deploy reads — so a local server was gated too, and the
 * cost was a password prompt on every fresh cookie jar, for a server whose
 * entire audience is the person who started it.
 *
 * The gate exists to stop strangers spending a provider key over the public
 * internet. A loopback request to a dev server is not that, so it goes
 * straight through.
 *
 * Two things make this safe to state so plainly:
 *
 *   `dev`      comes from `$app/environment` and is a **compile-time**
 *              constant. In any `vite build` it is `false`, and this branch is
 *              removed from the bundle entirely. There is no configuration,
 *              env var or header that can switch it back on in production —
 *              which is the property that makes an auth bypass acceptable at
 *              all.
 *   loopback   `npm run dev -- --host` binds every interface, and without this
 *              check "open in dev" would quietly mean "open to the network you
 *              are sitting on". Only localhost is trusted.
 *
 * `COLOPHON_GATE_IN_DEV=1` forces the gate on locally, which is how the login
 * flow itself gets tested — without it, `/login` is unreachable in dev because
 * nothing ever redirects there.
 */

const PUBLIC_PATHS = new Set(['/login']);

/**
 * Routes that authenticate themselves rather than via the session cookie.
 *
 * `/api/cron/` is called by Vercel's scheduler, which sends no cookie — it
 * carries a bearer token instead, and the route checks it. Letting it past the
 * cookie gate is not a hole: it is a different door with its own lock, and that
 * route refuses outright when its secret is unset.
 */
const SELF_AUTHENTICATING = ['/api/cron/'];

/**
 * Is this request from the machine the server is running on?
 *
 * The hostname the *client* asked for, not the interface we bound: a request
 * that arrived as `http://192.168.1.5:5180` is from somewhere else even though
 * the socket is local. `[::1]` appears bracketed in a URL and bare in a header,
 * so both spellings are listed.
 */
function isLoopback(event: RequestEvent): boolean {
	const host = event.url.hostname;
	return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/** Said once per server, so an open gate is never a surprise. */
let announced = false;

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (dev && env.COLOPHON_GATE_IN_DEV !== '1' && isLoopback(event)) {
		if (!announced) {
			announced = true;
			console.info(
				'[gate] open — dev server, loopback request. Set COLOPHON_GATE_IN_DEV=1 to require the password locally.'
			);
		}
		event.locals.authenticated = true;
		return resolve(event);
	}

	if (!isGateConfigured()) {
		// Production only now: the dev path returned above. A build that reaches
		// here with no password is a misconfigured deployment holding a provider
		// key, and an outage is the right failure.
		error(
			503,
			'COLOPHON_PASSWORD is not set. Refusing to serve an ungated deployment that holds a provider key.'
		);
	}

	const authenticated = await sessionIsValid(event.cookies.get(SESSION_COOKIE));
	event.locals.authenticated = authenticated;

	if (authenticated || PUBLIC_PATHS.has(pathname)) return resolve(event);
	if (SELF_AUTHENTICATING.some((prefix) => pathname.startsWith(prefix))) return resolve(event);

	// An API caller wants a status code, not a login page it cannot render.
	if (pathname.startsWith('/api/')) error(401, 'Not signed in.');

	redirect(303, `/login?next=${encodeURIComponent(pathname)}`);
};
