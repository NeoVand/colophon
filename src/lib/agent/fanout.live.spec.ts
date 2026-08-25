import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Does a memory-backed parent stall when its subagents fan out?
 *
 *   LIVE=1 npx vitest run src/lib/agent/fanout.live.spec.ts
 *
 * ── What this is settling ───────────────────────────────────────────────────
 * Two real runs stalled identically: several `paper_reader` calls with live
 * timers, nothing returned after four minutes, the process at 0% CPU, and one
 * open socket to the provider — the parent's own stream. Six in-flight model
 * calls would be six sockets, so the subagents had not started.
 *
 * `paper-reader.live.spec.ts` then showed the reader itself is fine: one
 * finishes, and three at once finish together. So the fault is not in the
 * reader and not in the network. It is in the parent.
 *
 * The parent differs from that probe in exactly one respect that could
 * serialise anything: it has `memory` attached, backed by Postgres, and the
 * stream route passes `{ memory: { thread, resource } }` on every turn. This
 * runs the same parent twice — once remembering, once not — with a prompt that
 * forces a fan-out, and times both.
 *
 * A pass on `without` and a timeout on `with` names the culprit. A pass on both
 * says memory is innocent and the next suspect is the step budget or the chunk
 * consumer. Either answer is worth what it costs, which is two research turns.
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
	OPENAI_API_KEY: readEnv('OPENAI_API_KEY', '.env'),
	DATABASE_URL: readEnv('DATABASE_URL', '.env.local')
};
vi.mock('$env/dynamic/private', () => ({ env }));

const { createColophon } = await import('./colophon');

const live = process.env.LIVE === '1';

/**
 * Names four papers outright so the turn is a fan-out and nothing else — no
 * search step, no judgement about what is worth reading. The variable under
 * test is concurrency, so everything else is held still.
 */
const PROMPT = [
	'Read these four papers with the paper-reader subagent, all of them, and then',
	'give me one short paragraph comparing them.',
	'',
	'arXiv:2404.14082',
	'arXiv:2408.05147',
	'arXiv:2503.01234',
	'arXiv:2406.04093'
].join('\n');

/** Run one turn to completion, draining the stream exactly as the route does. */
async function turn(remembers: boolean): Promise<{ ms: number; steps: number; text: string }> {
	const thread = remembers ? `fanout-probe-${remembers}` : undefined;
	const { agent } = await createColophon({ thread });
	const began = Date.now();

	const result = await agent.stream(PROMPT, {
		maxSteps: 24,
		...(remembers ? { memory: { thread: thread!, resource: 'fanout-probe' } } : {})
	});

	let steps = 0;
	let text = '';
	for await (const chunk of result.fullStream) {
		if (chunk.type === 'step-finish') steps++;
		if (chunk.type === 'text-delta')
			text += (chunk as { payload?: { text?: string } }).payload?.text ?? '';
	}
	return { ms: Date.now() - began, steps, text };
}

describe.skipIf(!live)('subagent fan-out, live', () => {
	it(
		'completes without memory',
		async () => {
			const r = await turn(false);
			console.log(`[no memory] ${r.ms}ms, ${r.steps} steps, ${r.text.length} chars`);
			expect(r.text.length).toBeGreaterThan(40);
		},
		6 * 60_000
	);

	it(
		'completes with memory',
		async () => {
			const r = await turn(true);
			console.log(`[memory] ${r.ms}ms, ${r.steps} steps, ${r.text.length} chars`);
			expect(r.text.length).toBeGreaterThan(40);
		},
		6 * 60_000
	);
});
