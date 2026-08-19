/**
 * Every other Node builtin Mastra's dependency graph can reach.
 *
 * These are all *reachable but never executed*: process spawning for the local
 * sandbox, DNS and sockets for transports we do not use, module resolution for
 * dynamic tool loading. The bundler must resolve each specifier, so each gets a
 * named export here that throws when called.
 *
 * The rule this file exists to enforce: nothing is silently polyfilled. If a
 * future Mastra version starts genuinely calling one of these at runtime, the
 * app fails immediately with a message naming the function, rather than
 * limping along on a fake implementation that returns plausible nonsense.
 *
 * A handful are *not* throwing, because a truthful cheap answer is better than
 * a crash: see the individual notes.
 */

const message = (name: string) =>
	`${name} was called in the browser build. Colophon's Lab mode runs entirely ` +
	`client-side: there is no filesystem, no process table and no raw socket. ` +
	`This code path belongs in Study mode (the server), not here.`;

const unavailable =
	(name: string) =>
	(...__args: unknown[]): never => {
		throw new Error(message(name));
	};

/* ── child_process ──────────────────────────────────────────────────────── */
export const exec = unavailable('child_process.exec');
export const execFile = unavailable('child_process.execFile');
export const execFileSync = unavailable('child_process.execFileSync');
export const execSync = unavailable('child_process.execSync');
export const spawn = unavailable('child_process.spawn');
export const spawnSync = unavailable('child_process.spawnSync');
export const fork = unavailable('child_process.fork');

/* ── module ─────────────────────────────────────────────────────────────── */
export const createRequire = () => unavailable('require');

/* ── url ────────────────────────────────────────────────────────────────── */
export const pathToFileURL = (path: string): URL => new URL(`file://${path}`);
export const fileURLToPath = (url: string | URL): string =>
	String(url).replace(/^file:\/\//, '');

/* ── os ─────────────────────────────────────────────────────────────────── */
// Truthful cheap answers: these are used to build paths and log lines, never
// to make a decision that matters in the browser.
export const homedir = (): string => '/';
export const tmpdir = (): string => '/tmp';
export const platform = (): string => 'browser';
export const EOL = '\n';
export const cpus = (): unknown[] => [];

/* ── stream ─────────────────────────────────────────────────────────────── */
export class Readable {}
export class Writable {}
export class Duplex {}
export class Transform {}
export class PassThrough {}
export const pipeline = unavailable('stream.pipeline');
export const finished = unavailable('stream.finished');

/* ── string_decoder ─────────────────────────────────────────────────────── */
export class StringDecoder {
	#decoder = new TextDecoder();
	write(bytes: Uint8Array): string {
		return this.#decoder.decode(bytes, { stream: true });
	}
	end(): string {
		return '';
	}
}

/* ── util ───────────────────────────────────────────────────────────────── */
// `inspect` is only ever used to build error messages, so a JSON round-trip is
// an honest substitute. A browserify polyfill would cost ~40 KB for this.
export function inspect(value: unknown): string {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'bigint') return `${value}n`;
	if (value instanceof RegExp || value instanceof Error) return String(value);
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}
export const format = (...args: unknown[]): string =>
	args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ');
export const promisify = <T>(fn: T): T => fn;
export const deprecate = <T>(fn: T): T => fn;

/* ── timers/promises ────────────────────────────────────────────────────── */
export const setTimeout = (ms: number): Promise<void> =>
	new Promise((resolve) => globalThis.setTimeout(resolve, ms));
export const setImmediate = (): Promise<void> => Promise.resolve();

/* ── fs/promises, dns, net, http, https, tls, v8, tty, zlib, … ──────────── */
export const readFile = unavailable('fs.promises.readFile');
export const writeFile = unavailable('fs.promises.writeFile');
export const mkdir = unavailable('fs.promises.mkdir');
export const mkdtemp = unavailable('fs.promises.mkdtemp');
export const rm = unavailable('fs.promises.rm');
export const stat = unavailable('fs.promises.stat');
export const readdir = unavailable('fs.promises.readdir');
export const access = unavailable('fs.promises.access');
export const lookup = unavailable('dns.lookup');

/**
 * Anything not named above. Reaching this means a dependency asked for
 * something we have not seen before — which is exactly when we want a loud,
 * specific failure rather than `undefined`.
 */
export default new Proxy(
	{},
	{ get: (_t, key) => unavailable(String(key)) }
);
