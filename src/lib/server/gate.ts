import { env } from '$env/dynamic/private';

/**
 * The gate.
 *
 * Colophon is deployed publicly and holds a provider key. Without a gate,
 * anyone who guesses the URL spends real money — so this exists before any
 * feature that would make the app worth finding.
 *
 * ── Why not better-auth, which is already installed ─────────────────────────
 * better-auth is an accounts system: users, sessions, verification, recovery.
 * It needs Postgres. Colophon has exactly one user, who is also the person
 * paying the bill, and the thing being protected is his own vault. A password
 * and a signed cookie is the proportionate mechanism, and — the part that
 * matters today — it needs no database, so the app can be secured now rather
 * than after a provisioning step that needs a human.
 *
 * better-auth stays in the tree unused. If Colophon ever grows real accounts
 * (students with their own vaults, say), that is when it earns its keep.
 *
 * ── Shape of the cookie ─────────────────────────────────────────────────────
 * `<expiry>.<hmac>` — no user id, because there is only one user, and no
 * server-side session table, because there is nowhere to put one. The HMAC is
 * over the expiry, so the cookie cannot be extended by editing it, and the
 * whole thing is verified in constant time.
 *
 * Web Crypto rather than `node:crypto` throughout, so this same file works
 * unchanged if compute moves to Cloudflare Workers.
 */

export const SESSION_COOKIE = 'colophon_session';
const SESSION_DAYS = 30;

function secret(): string {
	const value = env.COLOPHON_SECRET ?? env.BETTER_AUTH_SECRET;
	if (!value) throw new Error('COLOPHON_SECRET is not set; refusing to sign cookies.');
	return value;
}

/**
 * Whether the gate is armed.
 *
 * With no password configured the app is open — which is correct for local
 * development and dangerous anywhere else, so `hooks.server.ts` refuses to
 * serve an ungated production build rather than quietly running open.
 */
export function isGateConfigured(): boolean {
	return Boolean(env.COLOPHON_PASSWORD);
}

async function key(): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret()),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

function toHex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(payload: string): Promise<string> {
	const mac = await crypto.subtle.sign('HMAC', await key(), new TextEncoder().encode(payload));
	return toHex(mac);
}

/**
 * Constant-time comparison.
 *
 * A `===` on the MAC leaks its length and its first differing byte through
 * timing. That is a thin channel, but forging a cookie is the whole ballgame
 * here, and the fix is four lines.
 */
function equal(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Compare an attempt against the configured password, in constant time. */
export function passwordMatches(attempt: string): boolean {
	const expected = env.COLOPHON_PASSWORD;
	if (!expected) return false;
	// Hash both sides first so the comparison length cannot leak the real
	// password's length.
	return equal(attempt.padEnd(128, '\0').slice(0, 128), expected.padEnd(128, '\0').slice(0, 128));
}

export async function issueSession(): Promise<{ value: string; maxAge: number }> {
	const maxAge = SESSION_DAYS * 24 * 60 * 60;
	const expiry = String(Date.now() + maxAge * 1000);
	return { value: `${expiry}.${await sign(expiry)}`, maxAge };
}

export async function sessionIsValid(cookie: string | undefined): Promise<boolean> {
	if (!cookie) return false;
	const [expiry, mac] = cookie.split('.');
	if (!expiry || !mac) return false;
	if (!equal(mac, await sign(expiry))) return false;
	// Checked after the MAC on purpose: an unsigned cookie should not be able to
	// tell the difference between "wrong signature" and "expired".
	return Number(expiry) > Date.now();
}
