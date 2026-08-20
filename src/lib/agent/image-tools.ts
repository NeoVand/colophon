import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateImage, figureKey, type ImageSize, type ImageQuality } from '$lib/server/images';

/**
 * The image tool, and the gate in front of it.
 *
 * `requireApproval: true` is the whole point. Every other tool here reads
 * something; this one *spends* — gpt-image-2 bills at image-token rates, and a
 * loop that decides it needs eight illustrations costs real money before anyone
 * notices. So the harness pauses and shows the human the brief the model
 * actually wrote, immediately before it is sent.
 *
 * That is a stronger guarantee than asking the model to check first: the model
 * cannot route around a pause it does not control, and what gets approved is
 * the literal prompt rather than a description of one.
 *
 * ── The briefing doctrine ───────────────────────────────────────────────────
 * The tool description carries it deliberately, because it is the only place
 * the model reliably reads. Specify content, never technique: an over-specified
 * prompt comes back as clip-art, and the model is a better designer than a
 * checklist. Quoted strings render reliably; invented text does not. See
 * docs/BOOK.md — the book's plates are the documented exception, where a house
 * style *is* dictated.
 */
export function createImageTools() {
	const generate_image = createTool({
		id: 'generate_image',
		description:
			'Generate an illustration or infographic. PAUSES for human approval before spending. ' +
			'Write the brief as content, not technique: state the deliverable, audience and purpose ' +
			'in one sentence; give every piece of lettering as an EXACT quoted string, short, in ' +
			'order; end with what must NOT appear ("no other text, no watermark"). Name the ' +
			'standard ("the quality of a Quanta Magazine explainer") rather than dictating ' +
			'palettes, stroke widths or backgrounds — an over-specified prompt comes back as ' +
			'clip-art. One figure, one idea; two ideas means two figures. Do not use this for ' +
			'quantities — write the numbers in a table instead.',
		requireApproval: true,
		inputSchema: z.object({
			prompt: z.string().min(20).describe('The full brief. Every label as an exact quoted string.'),
			slug: z.string().describe('Short name for the file, e.g. "sae-composition".'),
			size: z
				.enum(['1024x1024', '1536x1024', '1024x1536'])
				.default('1536x1024')
				.describe('Landscape for flows and posters; square for inline figures.'),
			quality: z.enum(['low', 'medium', 'high']).default('high')
		}),
		execute: async ({ prompt, slug, size, quality }) => {
			const image = await generateImage({
				prompt,
				key: figureKey(slug),
				size: size as ImageSize,
				quality: quality as ImageQuality
			});
			return {
				path: `/${image.key}`,
				bytes: image.bytes,
				size: image.size,
				quality: image.quality,
				ms: image.ms,
				// Markdown the writer can paste straight into a document; the caption
				// carries attribution, which never belongs inside the artwork.
				markdown: `![](${`/${image.key}`})`
			};
		}
	});

	return { tools: { generate_image } };
}
