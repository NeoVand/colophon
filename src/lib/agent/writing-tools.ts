import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateImage, figureKey, type ImageQuality } from '$lib/server/images';

/**
 * The two tools that pause a run before it commits to something.
 *
 * They have nothing in common except that: `present_outline` spends the
 * reader's *time* — a draft written against the wrong structure is a whole
 * document thrown away — and `stylize_figure` spends money at image-token
 * rates. Both are `requireApproval: true`, for the reason set out at length in
 * `image-tools.ts`: a pause the model does not control is a stronger guarantee
 * than an instruction telling it to ask first.
 */

/**
 * The brief every redraw is sent, composed here rather than by the model.
 *
 * One paragraph and deliberately not a checklist. docs/BOOK.md is emphatic
 * that palettes and stroke widths come back as clip-art while a named quality
 * bar comes back as design — so the only thing dictated here is *fidelity*,
 * which is a truth constraint rather than a style one. A redraw that quietly
 * rounds a number or adds a trend line the paper never claimed is worse than
 * no figure at all, because it looks like evidence.
 *
 * It lives in one constant so every stylised figure in a document matches
 * every other one. That consistency is the entire point of a house style; a
 * per-call adjective would not survive three calls.
 */
export const REDRAW_BRIEF =
	'Redraw this figure as ORIGINAL artwork of the quality of a Quanta or Nature explainer: ' +
	'the same structure, the same quantities, the same relationships, drawn afresh rather ' +
	'than reproduced. Keep every axis label, data label and legend entry exactly as spelled ' +
	'below. Do not invent data points, do not change any value, and do not add decoration ' +
	'that asserts something the original does not. No caption, no attribution line and no ' +
	'watermark inside the image.';

export interface OutlineSection {
	heading: string;
	covers: string;
}
export interface Outline {
	title: string;
	sections: OutlineSection[];
}

export interface WritingToolOptions {
	/**
	 * The outline as the reader edited it, when resuming an approval.
	 *
	 * The seam exists because Mastra's `approveToolCall({ runId, toolCallId })`
	 * takes no argument override: a parked call resumes with the arguments the
	 * model wrote, so without this the reader's edits would be shown, accepted,
	 * and then silently dropped — the worst of the three possible outcomes,
	 * because the card would have promised otherwise.
	 *
	 * One slot rather than a map keyed by tool-call id, because one approve
	 * request resumes exactly one parked call, and the route that handles it
	 * builds the agent it resumes. If that ever stops being true, this becomes
	 * a map and the reason will be obvious.
	 */
	editedOutline?: Outline;
}

export function createWritingTools({ editedOutline }: WritingToolOptions = {}) {
	const present_outline = createTool({
		id: 'present_outline',
		description:
			'Propose the structure of a document for approval BEFORE drafting it. PAUSES the run: ' +
			'the reader can approve as proposed, edit the headings and coverage inline, or decline. ' +
			'Call it once the searches have told you what the literature actually contains — one ' +
			'approved outline is worth ten rounds of rewriting. What comes back is the APPROVED ' +
			'outline, which may differ from what you proposed; write against that.',
		requireApproval: true,
		inputSchema: z.object({
			title: z.string().min(4).describe('Working title of the document.'),
			sections: z
				.array(
					z.object({
						heading: z.string().min(2).describe('Section heading.'),
						covers: z.string().min(4).describe('One sentence: what this section argues.')
					})
				)
				.min(2)
				.max(10)
				.describe('Two to ten sections, in order.')
		}),
		execute: async (proposed: Outline) => {
			// The reader's version wins over the model's whenever there is one.
			const { title, sections } = editedOutline ?? proposed;
			/*
			 * The echo is the point of this tool.
			 *
			 * Reaching this body at all means a human approved — the interrupt
			 * happens before execution, never after. But approval here is not a
			 * yes/no: the card lets the reader retitle the document and reword any
			 * section. So the result deliberately restates the structure back to
			 * the model rather than returning `{ ok: true }`.
			 *
			 * Without that echo the model drafts from the outline it *proposed*,
			 * which is still sitting in its context a few hundred tokens up, and
			 * every edit the reader made is silently discarded — the failure looks
			 * exactly like the model ignoring the human, and is indistinguishable
			 * from it in the transcript. Restating costs a hundred tokens and makes
			 * the approved version the most recent thing the model read.
			 */
			return {
				approved: true,
				title,
				outline: sections.map((s, i) => `${i + 1}. ${s.heading} — ${s.covers}`).join('\n'),
				note:
					'This is the outline as approved, including any edits the reader made — it may ' +
					'differ from what you proposed. Follow it. Deviate only if asked.'
			};
		}
	});

	const stylize_figure = createTool({
		id: 'stylize_figure',
		description:
			"Redraw a figure taken from a paper as original artwork in the document's house style, " +
			'preserving its structure, labels and quantities. PAUSES for human approval before ' +
			'spending. Use it when a paper figure should appear in something being published: the ' +
			'redrawing carries the same information without reproducing copyrighted artwork. The ' +
			'result is an ILLUSTRATION, not evidence — the original from extract_figures is the ' +
			'evidence, so the caption must credit the paper, and a claim about what a paper ' +
			'actually reported should point at the original rather than at this.',
		requireApproval: true,
		inputSchema: z.object({
			arxivId: z
				.string()
				.describe('The paper the figure comes from. Required: the credit is not optional.'),
			figure: z
				.string()
				.min(20)
				.describe(
					'What the original figure shows: its structure, its quantities, and every ' +
						'label spelled exactly as it appears — read them off the figure ' +
						'extract_figures returned. Describe the content only: the house style is ' +
						'already sent, and restating a style produces clip-art.'
				),
			slug: z.string().describe('Short name for the file, e.g. "scaling-curve".'),
			quality: z.enum(['low', 'medium', 'high']).default('high')
		}),
		execute: async ({ arxivId, figure, slug, quality }) => {
			const id = arxivId.trim().replace(/^arxiv:/i, '');
			const image = await generateImage({
				prompt: `${REDRAW_BRIEF}\n\nThe figure to redraw:\n${figure}`,
				key: figureKey(slug),
				size: '1536x1024',
				quality: quality as ImageQuality
			});

			const path = `/${image.key}`;
			// Attribution is composed here, off the argument, rather than left to
			// the model. The reference implementation learned this the hard way:
			// asked to caption its own redraw, a model wrote "Redrawn after
			// /figures/fig1.png", which credits nobody.
			const caption = `Redrawn after arXiv:${id}`;
			return {
				path,
				bytes: image.bytes,
				ms: image.ms,
				credit: caption,
				markdown: `![${caption}](${path})`,
				note:
					'Original artwork based on the paper’s figure, which is what makes it ' +
					'publishable and also what makes it unusable as evidence. Cite the paper for ' +
					'the claim; use this for the picture.'
			};
		}
	});

	return { tools: { present_outline, stylize_figure } };
}
