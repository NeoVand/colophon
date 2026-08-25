import { describe, it, expect } from 'vitest';
import {
	bodyOf,
	citationScorer,
	COLOPHON_SCORERS,
	draftText,
	hedgingScorer,
	measureCitations,
	measureDraft,
	measureHedging,
	measureSpecificity,
	paragraphsOf,
	specificityScorer
} from './scorers';

/**
 * The two drafts below are the two outcomes the delivery gate exists to tell
 * apart: a week with a real finding, and a week padded out to look like one.
 * They are written in the app's own house format — citations as
 * `formatCitation` emits them, references as `renderBibliography` renders them
 * — because a metric tuned on prose the app never produces measures nothing.
 */

const REAL = `Sparse autoencoder evaluation depends on where you measure. Noël et al. (2026)
ablate features at three depths in a ViT-L/14 and find reconstruction fidelity
drops 8.4 points between layer 6 and layer 20, which reverses the ranking of two
methods a layer-6-only benchmark had called equivalent.

That contradicts Lee et al. (2026), who report a 2.1 point gap on SpIn-ViT and
conclude the choice of layer is immaterial. The setups differ in one respect:
Lee holds the dictionary size fixed at 16384 while Noël scales it with width.

The authors are explicit that both runs are single-seed on ImageNet, so the
ranking reversal is not settled. Noël et al. (2026) report no variance estimates
at all.

## References

- Noël et al. (2026), "Where You Measure Decides What You Measure". https://arxiv.org/abs/2608.13337
- Lee et al. (2026), "SpIn-ViT". https://arxiv.org/abs/2608.14922`;

const PADDED = `Interest in sparse autoencoders continues to grow, and several papers appeared
this week that may be of interest to practitioners working in this area.

The results are broadly promising and generally suggest that various approaches
could potentially improve performance somewhat, though it appears to be too
early to say for certain what the implications might be.`;

describe('draftText', () => {
	it('takes the assistant text out of a message list', () => {
		expect(
			draftText([
				{ role: 'user', content: { format: 2, parts: [{ type: 'text', text: 'write it' }] } },
				{
					role: 'assistant',
					content: {
						format: 2,
						parts: [
							{ type: 'text', text: 'one' },
							{ type: 'step-start' },
							{ type: 'text', text: 'two' }
						]
					}
				}
			])
		).toBe('one\n\ntwo');
	});

	it('degrades to an empty string rather than throwing on an unknown shape', () => {
		// A scorer that throws on a message-format change takes the run's whole
		// scoring pass down with it, for a number nobody was going to block on.
		expect(draftText(undefined)).toBe('');
		expect(draftText({ text: 'not a list' })).toBe('');
		expect(draftText([null, 42, { role: 'assistant' }])).toBe('');
	});

	it('passes a plain string through, so the panel can measure a draft directly', () => {
		expect(draftText('already prose')).toBe('already prose');
	});
});

describe('what counts as a paragraph', () => {
	it('stops at the reference list', () => {
		expect(bodyOf(REAL)).not.toContain('arxiv.org');
		expect(paragraphsOf(REAL)).toHaveLength(3);
	});

	it('drops headings and fragments', () => {
		const text =
			'## A heading\n\nshort\n\n' +
			'a sentence with more than twelve words in it, which is the floor for counting';
		expect(paragraphsOf(text)).toHaveLength(1);
	});
});

describe('citation density', () => {
	it('is the share of claim-making paragraphs that carry a citation', () => {
		const measured = measureCitations(REAL);
		expect(measured.paragraphs).toBe(3);
		expect(measured.cited).toBe(3);
		expect(measured.score).toBe(1);
	});

	it('gives an unattributed draft nothing', () => {
		expect(measureCitations(PADDED).score).toBe(0);
	});

	it('is not inflated by the bibliography', () => {
		// The failure this guards: the reference list is denser in citations than
		// any paragraph, so counting it would let a draft that attributes none of
		// its claims score well for having a long list at the bottom.
		const uncited =
			PADDED +
			'\n\n## References\n\n- Noël et al. (2026), "A". https://arxiv.org/abs/2608.13337\n- Lee et al. (2026), "B". https://arxiv.org/abs/2608.14922';
		expect(measureCitations(uncited).score).toBe(0);
	});

	it('counts a paragraph once however many papers it cites', () => {
		const one =
			'A single claim here, attributed to exactly one paper, Noël et al. (2026), and nothing more.';
		const many =
			'A single claim here, attributed to Noël et al. (2026), Lee et al. (2026) and Kim et al. (2025) at once.';
		expect(measureCitations(one).score).toBe(measureCitations(many).score);
		expect(measureCitations(many).marks).toBeGreaterThan(measureCitations(one).marks);
	});
});

describe('specificity', () => {
	it('separates a measured claim from a vague one', () => {
		expect(measureSpecificity(REAL).score).toBe(1);
		expect(measureSpecificity(PADDED).score).toBe(0);
	});

	it('does not count a citation year as a measurement', () => {
		// Otherwise every well-referenced paragraph reads as specific, which is
		// the exact confusion the two scorers exist to keep apart.
		const cited =
			'Noël et al. (2026) report that accuracy rose on a benchmark and nothing else is said here.';
		expect(measureSpecificity(cited).numbers).toBe(0);
	});

	it('counts method names that look like names, not every capitalised word', () => {
		const named =
			'The evaluation runs on ImageNet with a ViT-L backbone and a BM25 baseline for retrieval comparison.';
		expect(measureSpecificity(named).names).toBe(3);

		const sentenceCase =
			'The evaluation runs on a standard benchmark. Results were reported for every configuration tested.';
		expect(measureSpecificity(sentenceCase).names).toBe(0);
	});
});

describe('hedging', () => {
	it('reads high for prose that commits and low for prose that retreats', () => {
		expect(measureHedging(REAL).score).toBe(1);
		expect(measureHedging(PADDED).score).toBe(0);
	});

	it('respects word boundaries', () => {
		const measured = measureHedging(
			'Maybe is one word and maybes are another; severally is a third, and none of them hedge.'
		);
		expect(measured.hedges).toBe(0);
	});

	it('names the worst offender, which is the actionable part', () => {
		const measured = measureHedging(
			'This may be true and that may be true and the other may be true, though it could also generally hold.'
		);
		expect(measured.hits[0]).toEqual({ phrase: 'may', count: 3 });
	});
});

describe('the three together', () => {
	it('agree about which draft is worth sending', () => {
		expect(measureDraft(REAL).overall).toBeGreaterThan(0.9);
		expect(measureDraft(PADDED).overall).toBeLessThan(0.1);
	});
});

/**
 * The wiring, run for real.
 *
 * `scorer.run()` needs no Mastra instance and no model here because every step
 * is a function rather than a prompt object — which is the property that makes
 * these cheap enough to attach at `rate: 1`.
 */
describe('the Mastra scorers', () => {
	const asMessages = (text: string) => [
		{
			id: 'm1',
			role: 'assistant' as const,
			createdAt: new Date(),
			content: { format: 2 as const, parts: [{ type: 'text' as const, text }] }
		}
	];

	it('report the same number the pure function does', async () => {
		const result = await citationScorer.run({ output: asMessages(REAL) });
		expect(result.score).toBe(measureCitations(REAL).score);
		expect(result.reason).toContain('3 of 3');
	});

	it('score the padded draft down on all three axes', async () => {
		const output = asMessages(PADDED);
		const [citations, specificity, hedging] = await Promise.all([
			citationScorer.run({ output }),
			specificityScorer.run({ output }),
			hedgingScorer.run({ output })
		]);
		expect(citations.score).toBe(0);
		expect(specificity.score).toBe(0);
		expect(hedging.score).toBe(0);
	});

	it('measure without refusing — the draft comes back untouched', async () => {
		// The load-bearing assertion of the whole module. A scorer returns a
		// number *about* the output; it has no way to stop, edit or withhold it.
		// Blocking is `delivery-gate.ts`, an output processor calling abort().
		const output = asMessages(PADDED);
		const result = await hedgingScorer.run({ output });
		expect(result.score).toBe(0);
		expect(result.output).toBe(output);
	});

	it('are registered under sampling Mastra will accept', () => {
		// `rate`, not `probability` — tracing sampling uses the other key for the
		// same idea, and the wrong one type-checks against neither.
		for (const entry of Object.values(COLOPHON_SCORERS)) {
			expect(entry.sampling).toEqual({ type: 'ratio', rate: 1 });
		}
	});
});
