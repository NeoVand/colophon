import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Spends real money on a render, so it is opt-in:
 *
 *   LIVE=1 npx vitest run src/lib/server/images.live.spec.ts
 *
 * Kept at the smallest, cheapest settings — this proves the pipeline
 * (provider → bytes → blob store → readback), not the art.
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

const { generateImage, figureKey } = await import('./images');
const { blobs } = await import('./blobs');

describe('figureKey', () => {
	it('slugs a name into a path a document can embed', () => {
		expect(figureKey('SAE composition & features!')).toBe('figures/sae-composition-features.png');
		expect(figureKey('')).toBe('figures/figure.png');
	});
});

describe.skipIf(!process.env.LIVE)('generateImage', () => {
	it('renders, stores and reads back', async () => {
		const key = figureKey(`pipeline-probe-${Date.now()}`);
		const image = await generateImage({
			prompt:
				'A minimal chalk-on-blackboard diagram of a single box labelled exactly "READ" ' +
				'with an arrow leaving it labelled exactly "NOTES". No other text, no watermark.',
			key,
			size: '1024x1024',
			quality: 'low'
		});

		console.log('rendered:', image.bytes, 'bytes in', image.ms, 'ms →', image.key);
		expect(image.bytes).toBeGreaterThan(10_000);

		const stored = await blobs.get(key);
		expect(stored?.size).toBe(image.bytes);
		// PNG magic number — proves bytes survived base64 → bytea → base64.
		expect(Array.from(stored!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

		await blobs.delete(key);
		expect(await blobs.get(key)).toBeUndefined();
	}, 180000);
});
