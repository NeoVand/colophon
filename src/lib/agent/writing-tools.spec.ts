import { describe, it, expect, vi } from 'vitest';
import type { z } from 'zod';

/**
 * `writing-tools` imports the image module, which reads the environment and
 * talks to OpenAI. Both are replaced before the import so these tests exercise
 * the tool's own logic — the schemas, and what it hands back — rather than a
 * network call nobody wants in a unit run.
 */
const generateImage = vi.fn(async ({ key }: { key: string }) => ({
	key,
	contentType: 'image/png',
	size: '1536x1024' as const,
	quality: 'high' as const,
	bytes: 1_234_567,
	ms: 9_000
}));

vi.mock('$lib/server/images', () => ({
	generateImage,
	figureKey: (slug: string) => `figures/${slug}.png`
}));

const { createWritingTools, REDRAW_BRIEF } = await import('./writing-tools');

/** Reach past Mastra's wrapper to the tool's own pieces. */
type Executable = { execute: (input: unknown, ctx?: unknown) => Promise<unknown> };
type Schemad = { inputSchema: z.ZodType };
const run = (tool: unknown, input: unknown) => (tool as unknown as Executable).execute(input, {});
const schema = (tool: unknown) => (tool as unknown as Schemad).inputSchema;

const OUTLINE = {
	title: 'What sparse autoencoders can and cannot show',
	sections: [
		{ heading: 'The claim', covers: 'What interpretability promises a reader.' },
		{ heading: 'The evidence', covers: 'What the probing results actually establish.' }
	]
};

describe('present_outline', () => {
	const { tools } = createWritingTools();

	it('pauses before it runs', () => {
		// The gate is the tool. If this flag is ever dropped, the run drafts a
		// whole document against a structure nobody agreed to.
		expect((tools.present_outline as { requireApproval?: boolean }).requireApproval).toBe(true);
	});

	it('wants between two and ten sections', () => {
		const one = { ...OUTLINE, sections: OUTLINE.sections.slice(0, 1) };
		expect(schema(tools.present_outline).safeParse(one).success).toBe(false);

		const eleven = {
			...OUTLINE,
			sections: Array.from({ length: 11 }, (_, i) => ({
				heading: `Section ${i}`,
				covers: 'Something.'
			}))
		};
		expect(schema(tools.present_outline).safeParse(eleven).success).toBe(false);
		expect(schema(tools.present_outline).safeParse(OUTLINE).success).toBe(true);
	});

	it('rejects a section with a heading but nothing it covers', () => {
		const vague = { ...OUTLINE, sections: [{ heading: 'Intro', covers: '' }, OUTLINE.sections[1]] };
		expect(schema(tools.present_outline).safeParse(vague).success).toBe(false);
	});

	it('echoes the outline it was given back to the model', async () => {
		const result = (await run(tools.present_outline, OUTLINE)) as {
			approved: boolean;
			title: string;
			outline: string;
		};
		expect(result.approved).toBe(true);
		expect(result.title).toBe(OUTLINE.title);
		expect(result.outline).toBe(
			'1. The claim — What interpretability promises a reader.\n' +
				'2. The evidence — What the probing results actually establish.'
		);
	});

	it('echoes the EDITED outline over the proposed one', async () => {
		// The whole reason the echo exists. Mastra resumes a parked call with the
		// arguments the MODEL wrote, so the reader's edits arrive by the factory's
		// side door; what comes back must still be the reader's version, or the
		// model drafts from its own proposal and the card's promise was a lie.
		const edited = {
			title: 'What sparse autoencoders cannot show',
			sections: [
				{ heading: 'The claim', covers: 'What interpretability promises a reader.' },
				{ heading: 'What is missing', covers: 'The controls no paper here ran.' }
			]
		};
		const resumed = createWritingTools({ editedOutline: edited });

		// Called with what the model proposed — exactly as the resume will do it.
		const result = (await run(resumed.tools.present_outline, OUTLINE)) as {
			title: string;
			outline: string;
		};
		expect(result.title).toBe('What sparse autoencoders cannot show');
		expect(result.outline).toContain('2. What is missing — The controls no paper here ran.');
		expect(result.outline).not.toContain('The evidence');
	});
});

describe('stylize_figure', () => {
	const { tools } = createWritingTools();

	const FIGURE = {
		arxivId: '2404.14082',
		figure:
			'A line chart. X axis "Training tokens (B)", Y axis "Loss". Three curves labelled ' +
			'"7B", "13B", "70B", each falling and flattening.',
		slug: 'scaling-curve',
		quality: 'high' as const
	};

	it('pauses before it spends', () => {
		expect((tools.stylize_figure as { requireApproval?: boolean }).requireApproval).toBe(true);
	});

	it('will not redraw without a paper to credit', () => {
		const { arxivId: _drop, ...anonymous } = FIGURE;
		expect(schema(tools.stylize_figure).safeParse(anonymous).success).toBe(false);
	});

	it('refuses a description too thin to redraw from', () => {
		expect(schema(tools.stylize_figure).safeParse({ ...FIGURE, figure: 'a chart' }).success).toBe(
			false
		);
	});

	it('sends the house style itself, with the figure appended', async () => {
		await run(tools.stylize_figure, FIGURE);
		const prompt = generateImage.mock.calls.at(-1)?.[0] as unknown as { prompt: string };
		expect(prompt.prompt.startsWith(REDRAW_BRIEF)).toBe(true);
		expect(prompt.prompt).toContain('Training tokens (B)');
	});

	it('credits the paper, not the file path', async () => {
		const result = (await run(tools.stylize_figure, {
			...FIGURE,
			// The `arxiv:` prefix is what a model reaches for; it must not end up
			// doubled in the caption.
			arxivId: 'arXiv:2404.14082'
		})) as { credit: string; markdown: string; path: string };

		expect(result.credit).toBe('Redrawn after arXiv:2404.14082');
		expect(result.markdown).toBe('![Redrawn after arXiv:2404.14082](/figures/scaling-curve.png)');
		expect(result.path).toBe('/figures/scaling-curve.png');
	});
});
