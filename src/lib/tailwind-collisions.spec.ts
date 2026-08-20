import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No component may name one of its own classes after a Tailwind utility.
 *
 * This exists because of a bug that took an hour to find by reading and ten
 * seconds to find by measuring. `ContextRing` called its wrapper `.ring`, which
 * is also a Tailwind utility, and Tailwind v4 emits a utility for any candidate
 * it finds in the source — including a class we wrote for ourselves. So the
 * cockpit's largest instrument shipped inside a hard 1px rectangle that appears
 * nowhere in its stylesheet, and the user's report was, reasonably, "this really
 * weird thing, which I don't know what that is".
 *
 * The mechanism is worth stating exactly, because the obvious defence does not
 * work. Utilities live in `@layer utilities`; a Svelte component's scoped rules
 * are unlayered, and unlayered always beats layered. So the component wins every
 * property it *declares* — and silently inherits the utility for every property
 * it does not. `.ring` set `display`, `gap` and `overflow`; it never mentioned
 * `box-shadow`; Tailwind's `box-shadow: 0 0 0 1px` went straight through. A
 * collision therefore does not announce itself by breaking the layout. It adds
 * something.
 *
 * ── Why the check is shaped this way ────────────────────────────────────────
 * The test flags a name only when the component **defines a rule for it in its
 * own `<style>` block**. That distinction is doing real work: `src/routes/login`
 * writes `class="flex gap-3"` and means Tailwind's `.flex`, which is fine and
 * needs no exemption. What is never fine is writing `.ring { … }` and meaning
 * only your own. Keying on the stylesheet rather than the markup means the rule
 * needs no allowlist of files, and cannot rot into one.
 */

/**
 * Tailwind v4's valueless utilities — the ones spelled as a bare word, which
 * are the only ones a person would plausibly reach for as a semantic name.
 * `text-sm` and `gap-3` are not collision risks; `table`, `filter` and `shadow`
 * very much are.
 */
const UTILITIES = new Set([
	// display
	'block',
	'inline-block',
	'inline',
	'flex',
	'inline-flex',
	'table',
	'inline-table',
	'table-caption',
	'table-cell',
	'table-row',
	'flow-root',
	'grid',
	'inline-grid',
	'contents',
	'list-item',
	'hidden',
	// position
	'static',
	'fixed',
	'absolute',
	'relative',
	'sticky',
	'isolate',
	// visibility
	'visible',
	'invisible',
	'collapse',
	'sr-only',
	'not-sr-only',
	// flex
	'grow',
	'shrink',
	// typography
	'italic',
	'not-italic',
	'underline',
	'overline',
	'line-through',
	'no-underline',
	'uppercase',
	'lowercase',
	'capitalize',
	'normal-case',
	'truncate',
	'antialiased',
	'subpixel-antialiased',
	'ordinal',
	'slashed-zero',
	'tabular-nums',
	'lining-nums',
	'oldstyle-nums',
	'proportional-nums',
	'prose',
	// decoration — the ones with a bare default, which is exactly the trap
	'border',
	'divide',
	'ring',
	'shadow',
	'rounded',
	'outline',
	// filters & transforms
	'filter',
	'backdrop-filter',
	'blur',
	'invert',
	'grayscale',
	'sepia',
	'drop-shadow',
	'transform',
	'transform-gpu',
	'transition',
	// misc
	'container',
	'resize',
	'appearance-none'
]);

function svelteFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) svelteFiles(path, found);
		else if (entry.endsWith('.svelte')) found.push(path);
	}
	return found;
}

/**
 * Class names this file writes a rule for.
 *
 * Deliberately crude — a regex over the `<style>` block, not a CSS parser. It
 * only has to find `.name` in a selector, and a parser here would be a
 * dependency and a second thing to be wrong. It over-reports at worst, and a
 * false positive costs one rename.
 */
function definedClasses(source: string): string[] {
	const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
		.map((m) => m[1])
		.join('\n');
	if (!styles) return [];
	// Strip comments and declaration bodies so `.5rem` and `url(.foo)` cannot match.
	const selectors = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, '{}');
	return [...selectors.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
}

describe('component class names', () => {
	it('never shadow a Tailwind utility', () => {
		const offenders: string[] = [];
		for (const file of svelteFiles('src')) {
			const source = readFileSync(file, 'utf8');
			for (const name of new Set(definedClasses(source))) {
				if (UTILITIES.has(name)) offenders.push(`${file} defines .${name}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
