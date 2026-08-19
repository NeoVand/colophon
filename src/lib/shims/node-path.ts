/**
 * `node:path` for the browser.
 *
 * A genuine re-export, not a stub: Mastra does real path arithmetic on
 * workspace and skill paths, so `join`, `resolve`, `dirname` and friends have to
 * actually work. `path-browserify` is the POSIX half of Node's implementation,
 * which is the correct half — a browser has no drive letters.
 *
 * This exists as a file, rather than a bare alias to the package, so that every
 * entry in the shim map resolves to an absolute path we control. That keeps the
 * Vite plugin and the esbuild pre-bundle plugin able to share one table.
 */
import path from 'path-browserify';

export const {
	join,
	resolve,
	dirname,
	basename,
	extname,
	relative,
	normalize,
	isAbsolute,
	sep,
	delimiter,
	parse,
	format
} = path;

export const posix = path;
export const win32 = path;

export default path;
