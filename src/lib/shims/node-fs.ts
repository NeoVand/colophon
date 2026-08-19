/**
 * `node:fs` for the browser.
 *
 * Mastra's workspace and skill loaders can read skills from a real directory.
 * We never use that path — Colophon's skills are defined in code and its
 * documents live in the workspace abstraction — but the bundler still has to
 * resolve the specifier.
 *
 * `existsSync` returns `false` rather than throwing, because it is used as a
 * *probe*: "is there a skills directory here?" is a question with a legitimate
 * negative answer, and answering it honestly lets Mastra take its own
 * not-present branch. Everything that would actually touch a disk throws, with
 * a message that says why, so a wrong turn fails loudly at the call site
 * instead of silently returning empty data.
 */

const message = (name: string) =>
	`fs.${name} was called in the browser build. Colophon's browser (Lab) mode has ` +
	`no filesystem — documents live in the Mastra workspace, not on disk. If you ` +
	`meant to read a file, go through the workspace abstraction instead.`;

const unavailable =
	(name: string) =>
	(...__args: unknown[]): never => {
		throw new Error(message(name));
	};

/** A probe with a legitimate negative answer — see the note above. */
export const existsSync = (): boolean => false;
/** Nothing is a symlink when there is no filesystem. */
export const realpathSync = (path: string): string => path;
/** An empty directory is the truthful answer, and callers handle it. */
export const readdirSync = (): string[] => [];

export const readFileSync = unavailable('readFileSync');
export const writeFileSync = unavailable('writeFileSync');
export const appendFileSync = unavailable('appendFileSync');
export const statSync = unavailable('statSync');
export const lstatSync = unavailable('lstatSync');
export const mkdirSync = unavailable('mkdirSync');
export const renameSync = unavailable('renameSync');
export const rmSync = unavailable('rmSync');
export const unlinkSync = unavailable('unlinkSync');
export const createReadStream = unavailable('createReadStream');
export const createWriteStream = unavailable('createWriteStream');

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };

export const promises = new Proxy({}, { get: (_t, key) => unavailable(`promises.${String(key)}`) });

export default {
	existsSync,
	realpathSync,
	readdirSync,
	readFileSync,
	writeFileSync,
	appendFileSync,
	statSync,
	lstatSync,
	mkdirSync,
	renameSync,
	rmSync,
	unlinkSync,
	createReadStream,
	createWriteStream,
	constants,
	promises
};
