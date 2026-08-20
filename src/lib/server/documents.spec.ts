import { describe, it, expect, vi } from 'vitest';

/**
 * Only the pure half is tested here, and that is the point of the split.
 *
 * Slugging is the part of the vault with behaviour worth pinning down: it
 * decides what a URL says, and it is the one place where two documents can be
 * made to collide. The database half is drizzle calling Postgres — testing it
 * would test drizzle, and would need a database in CI to do it.
 *
 * `$env/dynamic/private` is a SvelteKit virtual module that `$lib/server/db`
 * imports. Mocking it keeps the import graph resolvable; nothing connects,
 * because `db` is a lazy proxy that only dials on first property access.
 */
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { slugify, uniqueSlug } = await import('./documents');

describe('slugify', () => {
	it('lowercases and hyphenates a title', () => {
		expect(slugify('Notes On Attention')).toBe('notes-on-attention');
	});

	it('drops diacritics rather than the letters carrying them', () => {
		// The bug this catches is `g-del`: deleting the composed character
		// instead of decomposing it and deleting only the mark.
		expect(slugify('Gödel, Escher, Bach')).toBe('godel-escher-bach');
		expect(slugify('Naïve Bayes, résumé')).toBe('naive-bayes-resume');
	});

	it('removes apostrophes instead of turning them into separators', () => {
		expect(slugify("Don't Repeat Yourself")).toBe('dont-repeat-yourself');
		// The typographic apostrophe a word processor inserts, too.
		expect(slugify('Gödel’s proof')).toBe('godels-proof');
	});

	it('collapses a run of punctuation into a single hyphen', () => {
		expect(slugify('RLHF: what -- actually -- changed?!')).toBe('rlhf-what-actually-changed');
	});

	it('never begins or ends with a hyphen', () => {
		expect(slugify('  ...draft...  ')).toBe('draft');
	});

	it('caps the length without leaving the cut hyphen behind', () => {
		const long = slugify('a '.repeat(200).trim());
		expect(long.length).toBeLessThanOrEqual(80);
		expect(long.endsWith('-')).toBe(false);
	});

	it('falls back to untitled when nothing survives', () => {
		expect(slugify('')).toBe('untitled');
		expect(slugify('???')).toBe('untitled');
		// A title with no ASCII at all. Reachable by id; numbered by uniqueSlug.
		expect(slugify('注意机制')).toBe('untitled');
	});

	it('is idempotent, which is what lets callers pass either a title or a slug', () => {
		const once = slugify('A Draft: Part II');
		expect(slugify(once)).toBe(once);
	});
});

describe('uniqueSlug', () => {
	it('returns the slug untouched when nothing has claimed it', () => {
		expect(uniqueSlug('Notes On Attention', [])).toBe('notes-on-attention');
	});

	it('slugifies the desired name before comparing', () => {
		expect(uniqueSlug('Notes On Attention', ['notes-on-attention'])).toBe('notes-on-attention-2');
	});

	it('counts from 2, so the pair reads as first and second', () => {
		expect(uniqueSlug('draft', ['draft'])).toBe('draft-2');
		expect(uniqueSlug('draft', ['draft', 'draft-2'])).toBe('draft-3');
	});

	it('skips a number already taken rather than reusing it', () => {
		// Gaps happen: draft-2 was deleted, draft-3 was not. Handing out draft-3
		// again would be the collision this function exists to prevent.
		expect(uniqueSlug('draft', ['draft', 'draft-3'])).toBe('draft-2');
	});

	it('accepts a Set as readily as an array', () => {
		expect(uniqueSlug('draft', new Set(['draft', 'draft-2']))).toBe('draft-3');
	});

	it('leaves a document its own slug when that slug is excluded from the set', () => {
		// The rename case: everything else in the vault is in `taken`, but the
		// document being renamed is not, so it keeps the name it already had.
		const others = ['other-note', 'draft-2'];
		expect(uniqueSlug('draft', others)).toBe('draft');
	});

	it('terminates on a pathological set instead of looping forever', () => {
		const crowded = new Set(['draft', ...Array.from({ length: 1200 }, (_, i) => `draft-${i + 2}`)]);
		const slug = uniqueSlug('draft', crowded);
		expect(crowded.has(slug)).toBe(false);
		expect(slug.startsWith('draft-')).toBe(true);
	});

	it('never produces a slug that could act as a LIKE wildcard', () => {
		// takenSlugs interpolates the slug into a LIKE pattern unescaped, on the
		// strength of this property. If it ever stops holding, that query starts
		// matching more rows than it should.
		expect(uniqueSlug('100% done_now', [])).toMatch(/^[a-z0-9-]+$/);
	});
});
