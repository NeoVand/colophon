import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Does a paper-reader subagent actually finish — alone, and in parallel?
 *
 *   LIVE=1 npx vitest run src/lib/agent/paper-reader.live.spec.ts
 *
 * Written to settle one question with evidence rather than by reading Mastra.
 * Two real runs of the app stalled identically: six or seven `paper_reader`
 * calls with live timers, nothing returned after four minutes, the server
 * process at 0% CPU, and — the fact that matters — exactly ONE open socket to
 * the provider, which is the parent's own stream. Six in-flight model calls
 * would be six sockets. So the subagents were not slow; they had not started.
 *
 * That could be the reader itself, or it could be something about running
 * several at once. This asks each separately, outside the agent loop, the
 * stream route and the browser, so whichever it is has nowhere to hide.
 *
 * Spends real money — roughly one cheap turn per paper — so it is opt-in and
 * uses papers small enough to read quickly.
 */

const readEnv = (k: string, f: string) => {
	const line = readFileSync(f, 'utf8')
		.split('\n')
		.find((l) => l.startsWith(`${k}=`));
	return line
		?.slice(k.length + 1)
		.replace(/^"|"$/g, '')
		.trim();
};

const env: Record<string, string | undefined> = {
	OPENAI_API_KEY: readEnv('OPENAI_API_KEY', '.env')
};
vi.mock('$env/dynamic/private', () => ({ env }));

const { createPaperReader } = await import('./paper-reader');
const { SourceRegistry } = await import('./sources');

const live = process.env.LIVE === '1';
const IDS = ['2404.14082', '2408.05147', '2503.01234'];

/** Ask the reader for one paper and report how long it took. */
async function read(id: string): Promise<{ id: string; ms: number; words: number; text: string }> {
	const reader = createPaperReader(new SourceRegistry());
	const began = Date.now();
	const result = await reader.generate(`Read arXiv:${id} and report back.`);
	const text = result.text ?? '';
	return { id, ms: Date.now() - began, words: text.split(/\s+/).filter(Boolean).length, text };
}

describe.skipIf(!live)('paper reader, live', () => {
	it(
		'finishes one paper on its own',
		async () => {
			const one = await read(IDS[0]);
			console.log(`[alone] ${one.id} — ${one.ms}ms, ${one.words} words`);
			expect(one.text.length).toBeGreaterThan(80);
		},
		5 * 60_000
	);

	it(
		'finishes three at once',
		async () => {
			const began = Date.now();
			const all = await Promise.all(IDS.map(read));
			const wall = Date.now() - began;
			for (const r of all) console.log(`[parallel] ${r.id} — ${r.ms}ms, ${r.words} words`);
			console.log(`[parallel] wall ${wall}ms`);

			// The claim under test. If three concurrent readers take about as long
			// as the slowest one, they really ran concurrently; if the wall clock is
			// close to the sum, they were queued behind each other, which is the
			// stall the app showed at six.
			const slowest = Math.max(...all.map((r) => r.ms));
			const sum = all.reduce((n, r) => n + r.ms, 0);
			console.log(`[parallel] slowest ${slowest}ms, sum ${sum}ms`);

			for (const r of all) expect(r.text.length).toBeGreaterThan(80);
		},
		8 * 60_000
	);
});
