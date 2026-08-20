import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sweepAllDue } from '$lib/agent/sweep';
import { isStorageConfigured } from '$lib/server/storage';
import { error, json } from '@sveltejs/kit';

/**
 * The daily sweep, fired by platform cron.
 *
 * Mastra's own scheduler is a setInterval tick loop that assumes a long-lived
 * host; its docs say plainly it does not work on Vercel. So the cadence comes
 * from outside: `vercel.json` names this route, Vercel calls it, and it runs
 * whatever is due.
 *
 * ── Why this route is exempt from the password gate ─────────────────────────
 * Vercel's cron sends no cookie, so the gate would refuse it. Instead it
 * carries `Authorization: Bearer $CRON_SECRET`, which Vercel injects
 * automatically for cron invocations of the project's own routes. That is the
 * documented mechanism, and it is why `hooks.server.ts` lets `/api/cron/`
 * through: this route does its own, different authentication.
 *
 * It fails closed exactly as the gate does — with no CRON_SECRET configured it
 * refuses every request rather than running research on demand for anyone who
 * finds the URL.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) {
		error(503, 'CRON_SECRET is not set; refusing to run an unauthenticated sweep.');
	}
	if (request.headers.get('authorization') !== `Bearer ${secret}`) {
		error(401, 'Not a cron invocation.');
	}
	if (!isStorageConfigured()) {
		error(503, 'No database configured; there is nowhere to keep a digest.');
	}

	const startedAt = Date.now();
	const results = await sweepAllDue();

	return json({
		swept: results.length,
		ms: Date.now() - startedAt,
		results: results.map((r) => ({
			query: r.query,
			verdict: r.verdict,
			title: r.title,
			reason: r.reason,
			papersRead: r.sources.length,
			ms: r.ms
		}))
	});
};

/** Vercel cron issues GET; accept both so the route can also be poked by hand. */
export const GET: RequestHandler = (event) => (POST as RequestHandler)(event);
