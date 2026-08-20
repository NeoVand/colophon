import { env } from '$env/dynamic/private';
import { blobs } from './blobs';

/**
 * Image generation.
 *
 * This is the one place Colophon talks to a provider without going through the
 * AI SDK, because there is no `gpt-image-2` wrapper to go through. It is a
 * plain REST call, kept behind this module so the rest of the app never has to
 * know that.
 *
 * ── Facts about gpt-image-2 that cost time to learn ─────────────────────────
 * - It returns **`b64_json` only**. There is no URL to fetch; the bytes come
 *   back in the response body, which is why a render is a multi-megabyte JSON
 *   payload rather than a link.
 * - It may require **organisation verification** on the OpenAI account. The
 *   failure is a 403 with a specific message, so it is worth naming rather than
 *   surfacing as a generic error.
 * - Output is billed at image-token rates, which is why every call is gated on
 *   human approval before it happens. See `createImageTools`.
 */

const ENDPOINT = 'https://api.openai.com/v1/images/generations';

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';
export type ImageQuality = 'low' | 'medium' | 'high';

export interface GeneratedImage {
	key: string;
	contentType: string;
	size: ImageSize;
	quality: ImageQuality;
	bytes: number;
	ms: number;
}

export class ImageGenerationFailed extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'ImageGenerationFailed';
	}
}

export async function generateImage({
	prompt,
	key,
	size = '1536x1024',
	quality = 'high',
	fetchImpl = fetch
}: {
	prompt: string;
	key: string;
	size?: ImageSize;
	quality?: ImageQuality;
	fetchImpl?: typeof fetch;
}): Promise<GeneratedImage> {
	if (!env.OPENAI_API_KEY) throw new ImageGenerationFailed('OPENAI_API_KEY is not set.');

	const startedAt = Date.now();
	const response = await fetchImpl(ENDPOINT, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${env.OPENAI_API_KEY}`
		},
		body: JSON.stringify({ model: 'gpt-image-2', prompt, n: 1, size, quality })
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		if (response.status === 403 && /verif/i.test(body)) {
			throw new ImageGenerationFailed(
				'gpt-image-2 requires organisation verification on this OpenAI account.',
				403
			);
		}
		throw new ImageGenerationFailed(
			`Image generation failed (HTTP ${response.status}): ${body.slice(0, 300)}`,
			response.status
		);
	}

	const json = (await response.json()) as {
		data?: { b64_json?: string }[];
	};
	const b64 = json.data?.[0]?.b64_json;
	if (!b64) throw new ImageGenerationFailed('The provider returned no image data.');

	const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
	await blobs.put(key, bytes, 'image/png');

	return {
		key,
		contentType: 'image/png',
		size,
		quality,
		bytes: bytes.byteLength,
		ms: Date.now() - startedAt
	};
}

/**
 * A filesystem-ish key for a generated image.
 *
 * Slugged rather than random so a figure can be referred to by name in prose
 * and found again later — `/figures/sae-composition.png` reads as a path, which
 * is what a document will want to embed.
 */
export function figureKey(slug: string): string {
	const clean = slug
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);
	return `figures/${clean || 'figure'}.png`;
}
