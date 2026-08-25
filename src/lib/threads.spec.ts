import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { list, record, rename, remove, touch } from './threads';

/**
 * The thread index, tested against a stub.
 *
 * These run in the node project, where there is no `localStorage` at all — which
 * is convenient, because absence is one of the two states the module has to
 * survive (the other is a store that throws). Both are pinned below; both are
 * the sort of thing that only shows up on someone else's machine.
 */

function stubStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		key: (i: number) => [...map.keys()][i] ?? null,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => {
			map.set(k, String(v));
		},
		removeItem: (k: string) => {
			map.delete(k);
		},
		clear: () => {
			map.clear();
		}
	};
}

/** Fixed, so `at` is deterministic and ordering can be asserted exactly. */
const T0 = new Date('2026-08-19T10:00:00Z').getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
	vi.stubGlobal('localStorage', stubStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('an empty index', () => {
	it('lists nothing rather than throwing', () => {
		expect(list()).toEqual([]);
	});

	it('ignores a rename, remove or touch of a thread it has never seen', () => {
		rename('ghost', 'Something');
		touch('ghost');
		remove('ghost');
		expect(list()).toEqual([]);
	});
});

describe('record', () => {
	it('titles a thread from its opening message', () => {
		record('a', 'What changed in sparse autoencoder evaluation this year?');

		expect(list()).toEqual([
			{
				id: 'a',
				title: 'What changed in sparse autoencoder evaluation this year?',
				at: T0,
				turns: 1
			}
		]);
	});

	it('collapses whitespace so a pasted multi-line question still fits one row', () => {
		record('a', '  Compare\n\n  these   two papers  ');
		expect(list()[0].title).toBe('Compare these two papers');
	});

	it('cuts a long opening message at a word boundary and marks the cut', () => {
		const long =
			'Read the two most-cited papers on speculative decoding and compare their acceptance-rate claims';
		record('a', long);

		const title = list()[0].title;
		expect(title.endsWith('…')).toBe(true);
		// One over the limit is the ellipsis itself.
		expect(title.length).toBeLessThanOrEqual(61);
		// The bug this catches is a title that stops mid-word, which reads as
		// corruption rather than as truncation.
		expect(long.startsWith(title.slice(0, -1))).toBe(true);
		expect(title.slice(0, -1).endsWith(' ')).toBe(false);
	});

	it('falls back to a placeholder when the opening message is only whitespace', () => {
		record('a', '   \n  ');
		expect(list()[0].title).toBe('Untitled thread');
	});

	it('keeps the opening title on later turns and counts them', () => {
		record('a', 'First question');
		vi.setSystemTime(T0 + 60_000);
		record('a', 'A completely different follow-up');

		const [entry] = list();
		expect(entry).toMatchObject({ id: 'a', title: 'First question', turns: 2, at: T0 + 60_000 });
		expect(list()).toHaveLength(1);
	});

	it('refuses an empty id rather than storing an unreachable row', () => {
		record('', 'Orphan');
		expect(list()).toEqual([]);
	});
});

describe('ordering', () => {
	it('lists the most recently touched thread first', () => {
		record('a', 'Oldest');
		vi.setSystemTime(T0 + 1000);
		record('b', 'Middle');
		vi.setSystemTime(T0 + 2000);
		record('c', 'Newest');

		expect(list().map((e) => e.id)).toEqual(['c', 'b', 'a']);
	});

	it('floats a thread back to the top when it is opened again', () => {
		record('a', 'Oldest');
		vi.setSystemTime(T0 + 1000);
		record('b', 'Newer');

		vi.setSystemTime(T0 + 5000);
		touch('a');

		expect(list().map((e) => e.id)).toEqual(['a', 'b']);
		// Opening a thread is not asking a question in it.
		expect(list()[0].turns).toBe(1);
	});

	it('caps the index and drops the least recent', () => {
		for (let i = 0; i < 205; i++) {
			vi.setSystemTime(T0 + i * 1000);
			record(`t${i}`, `Question ${i}`);
		}

		const ids = list().map((e) => e.id);
		expect(ids).toHaveLength(200);
		expect(ids[0]).toBe('t204');
		expect(ids).not.toContain('t0');
	});
});

describe('rename', () => {
	it('replaces the title', () => {
		record('a', 'Sparse autoencoders');
		rename('a', 'SAE reading list');
		expect(list()[0].title).toBe('SAE reading list');
	});

	it('leaves the order alone, because renaming is not activity', () => {
		record('a', 'First');
		vi.setSystemTime(T0 + 1000);
		record('b', 'Second');

		vi.setSystemTime(T0 + 9000);
		rename('a', 'Renamed');

		// Had rename bumped `at`, the list would reorder under the cursor of
		// whoever was editing the title.
		expect(list().map((e) => e.id)).toEqual(['b', 'a']);
		expect(list().find((e) => e.id === 'a')?.at).toBe(T0);
	});

	it('ignores a blank title rather than leaving an unidentifiable row', () => {
		record('a', 'Sparse autoencoders');
		rename('a', '   ');
		expect(list()[0].title).toBe('Sparse autoencoders');
	});
});

describe('remove', () => {
	it('deletes exactly one thread', () => {
		record('a', 'Keep');
		record('b', 'Drop');
		remove('b');

		expect(list().map((e) => e.id)).toEqual(['a']);
	});
});

describe('a store that misbehaves', () => {
	it('reads a corrupt index as empty', () => {
		localStorage.setItem('colophon:threads', '{not json');
		expect(list()).toEqual([]);
	});

	it('reads a non-array index as empty', () => {
		localStorage.setItem('colophon:threads', '{"id":"a"}');
		expect(list()).toEqual([]);
	});

	it('drops only the malformed rows of an otherwise good index', () => {
		localStorage.setItem(
			'colophon:threads',
			JSON.stringify([{ id: 'a', title: 'Fine', at: T0, turns: 1 }, { id: 'b' }, null, 7])
		);

		expect(list().map((e) => e.id)).toEqual(['a']);
	});

	it('survives a store that refuses to write', () => {
		record('a', 'Written before the quota ran out');
		vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});

		// The failure mode this prevents: a full store throwing out of the send
		// path and losing the question the reader just typed.
		expect(() => record('b', 'Written after')).not.toThrow();
		expect(list().map((e) => e.id)).toEqual(['a']);
	});
});

describe('without localStorage at all', () => {
	beforeEach(() => {
		// SSR: the global is absent, not empty. A module-level reference to it
		// would have thrown at import time and taken the route down.
		vi.stubGlobal('localStorage', undefined);
	});

	it('lists nothing and writes nothing, silently', () => {
		expect(() => {
			record('a', 'Asked while server-rendering');
			rename('a', 'x');
			touch('a');
			remove('a');
		}).not.toThrow();
		expect(list()).toEqual([]);
	});
});
