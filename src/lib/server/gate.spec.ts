import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The gate is the only thing between a public URL and a provider key, so its
 * failure modes get tests rather than trust.
 *
 * `$env/dynamic/private` is a SvelteKit virtual module and has to be mocked;
 * the mutable object lets each test set the environment it needs.
 */
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { SESSION_COOKIE, isGateConfigured, passwordMatches, issueSession, sessionIsValid } =
	await import('./gate');

beforeEach(() => {
	env.COLOPHON_PASSWORD = 'correct-horse-battery-staple';
	env.COLOPHON_SECRET = 'a-secret-of-sufficient-length-for-hmac';
});

describe('configuration', () => {
	it('reports the gate as armed only when a password is set', () => {
		expect(isGateConfigured()).toBe(true);
		env.COLOPHON_PASSWORD = undefined;
		expect(isGateConfigured()).toBe(false);
	});

	it('names the cookie stably — changing it would sign everyone out', () => {
		expect(SESSION_COOKIE).toBe('colophon_session');
	});
});

describe('passwordMatches', () => {
	it('accepts the configured password', () => {
		expect(passwordMatches('correct-horse-battery-staple')).toBe(true);
	});

	it('rejects a wrong password, including near misses', () => {
		expect(passwordMatches('correct-horse-battery-stapl')).toBe(false);
		expect(passwordMatches('correct-horse-battery-staple ')).toBe(false);
		expect(passwordMatches('')).toBe(false);
	});

	it('refuses everything when no password is configured', () => {
		// An unset password must not mean "anything works".
		env.COLOPHON_PASSWORD = undefined;
		expect(passwordMatches('')).toBe(false);
		expect(passwordMatches('anything')).toBe(false);
	});
});

describe('sessions', () => {
	it('issues a session that validates', async () => {
		const session = await issueSession();
		expect(await sessionIsValid(session.value)).toBe(true);
	});

	it('rejects nonsense', async () => {
		expect(await sessionIsValid(undefined)).toBe(false);
		expect(await sessionIsValid('')).toBe(false);
		expect(await sessionIsValid('nodot')).toBe(false);
		expect(await sessionIsValid('123.')).toBe(false);
	});

	it('rejects a cookie whose expiry was extended but whose MAC was not', async () => {
		// The attack the HMAC exists to stop: take a real cookie, push the expiry
		// far into the future, keep the signature.
		const session = await issueSession();
		const mac = session.value.split('.')[1];
		expect(await sessionIsValid(`99999999999999.${mac}`)).toBe(false);
	});

	it('rejects a cookie signed with a different secret', async () => {
		const session = await issueSession();
		env.COLOPHON_SECRET = 'a-completely-different-secret-value';
		expect(await sessionIsValid(session.value)).toBe(false);
	});

	it('rejects a genuinely signed cookie once it has expired', async () => {
		// The signature stays valid forever, so expiry has to be enforced
		// separately. Move the clock rather than forge anything: this is the same
		// cookie the module issued, just old.
		const session = await issueSession();
		expect(await sessionIsValid(session.value)).toBe(true);

		vi.useFakeTimers();
		try {
			vi.setSystemTime(Date.now() + (session.maxAge + 60) * 1000);
			expect(await sessionIsValid(session.value)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('refuses to sign at all when no secret is configured', async () => {
		env.COLOPHON_SECRET = undefined;
		env.BETTER_AUTH_SECRET = undefined;
		await expect(issueSession()).rejects.toThrow(/COLOPHON_SECRET/);
	});
});
