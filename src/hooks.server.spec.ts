import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * The dev bypass, tested — because "skip authentication" is exactly the code
 * that must not drift.
 *
 * The bypass is safe on one load-bearing claim: `dev` is a compile-time
 * constant, so in a production build the branch is not merely false but absent.
 * A test cannot observe dead-code elimination, so it does the next best thing
 * and pins the *condition*: with `dev` false, a request that would sail through
 * locally must be challenged. If someone ever swaps `dev` for a runtime check —
 * an env var, a header, a hostname — these fail.
 *
 * `dev` and `$env/dynamic/private` are SvelteKit virtual modules; both are
 * mocked through mutable objects so each test can set the world it needs.
 */
const flags = { dev: true };
vi.mock('$app/environment', () => ({
	get dev() {
		return flags.dev;
	}
}));

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { handle } = await import('./hooks.server');

/** Enough of a `RequestEvent` for the gate; it reads a url, cookies and locals. */
function request(url: string, cookie?: string) {
	return {
		url: new URL(url),
		locals: {} as { authenticated?: boolean },
		cookies: { get: () => cookie }
	} as unknown as RequestEvent;
}

const resolve = vi.fn(async () => new Response('ok'));

/** Run the gate and report what happened, without letting a throw escape. */
async function through(event: RequestEvent) {
	try {
		await handle({ event, resolve } as Parameters<typeof handle>[0]);
		return { passed: true, status: 200 };
	} catch (thrown) {
		const e = thrown as { status?: number };
		return { passed: false, status: e.status ?? 500 };
	}
}

beforeEach(() => {
	flags.dev = true;
	env.COLOPHON_PASSWORD = 'correct-horse-battery-staple';
	env.COLOPHON_SECRET = 'a-secret-of-sufficient-length-for-hmac';
	env.COLOPHON_GATE_IN_DEV = undefined;
	resolve.mockClear();
});

describe('the dev bypass', () => {
	it('lets a loopback request through with a password configured', async () => {
		// The actual complaint: `.env` carries the deploy's password, so a local
		// server was gated too and every fresh cookie jar meant going to find it.
		const event = request('http://localhost:5180/');
		expect((await through(event)).passed).toBe(true);
		expect(event.locals.authenticated).toBe(true);
	});

	it('accepts every spelling of the loopback host', async () => {
		for (const host of ['localhost', '127.0.0.1', '[::1]']) {
			const event = request(`http://${host}:5180/`);
			expect((await through(event)).passed).toBe(true);
		}
	});

	it('challenges a request that arrived over the network', async () => {
		// `npm run dev -- --host` binds every interface. Without this, "open in
		// dev" quietly means "open to the café wifi".
		const event = request('http://192.168.1.5:5180/api/tools');
		expect(await through(event)).toEqual({ passed: false, status: 401 });
	});

	it('can be turned off to test the login flow itself', async () => {
		env.COLOPHON_GATE_IN_DEV = '1';
		const event = request('http://localhost:5180/api/tools');
		expect(await through(event)).toEqual({ passed: false, status: 401 });
	});
});

describe('production is unaffected', () => {
	beforeEach(() => {
		flags.dev = false;
	});

	it('challenges a loopback request', async () => {
		// The one that matters. A production build has no bypass at all — this
		// pins the condition that makes that true.
		const event = request('http://localhost:5180/api/tools');
		expect(await through(event)).toEqual({ passed: false, status: 401 });
	});

	it('refuses to serve at all when no password is set', async () => {
		env.COLOPHON_PASSWORD = undefined;
		expect(await through(request('http://colophon.example/'))).toEqual({
			passed: false,
			status: 503
		});
	});

	it('still lets the cron route authenticate itself', async () => {
		const event = request('http://colophon.example/api/cron/sweep');
		expect((await through(event)).passed).toBe(true);
	});
});
