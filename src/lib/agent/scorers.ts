import { createScorer } from '@mastra/core/evals';
import type { MastraScorers } from '@mastra/core/evals';

/**
 * Measuring the things the delivery gate refuses on.
 *
 * ── A scorer measures. A processor refuses. ─────────────────────────────────
 * This is the point of the file and it is the single most misread thing in
 * Mastra. `scorers: {}` on an agent looks like a quality bar and is not one:
 * it runs *after* the result, asynchronously, records a number, and never
 * stops anything reaching the reader. Mastra's own documentation reads as
 * though it gates; it does not, and that was established here by compiling the
 * docs' snippets against the installed package rather than by reading them.
 *
 * So the two live side by side and do different jobs:
 *
 *   `delivery-gate.ts`   an output processor. Calls `abort()`, raises a
 *                        TripWire, and the digest is not sent. **Refusal.**
 *   this file            three scorers. Attach a number to every draft,
 *                        sent or withheld, and change nothing. **Measurement.**
 *
 * You need both, and for a reason that is easy to miss: the gate is a model
 * judging prose, so its verdicts are the one thing in the system you cannot
 * check by reading the gate's own output. The scorers here are deterministic
 * and cheap — no judge, no model call, pure text arithmetic — so they give the
 * verdicts something external to be plotted against. A week of withheld drafts
 * that all scored well is a gate that has drifted strict; a week of sent
 * drafts scoring badly is a bar set too low. Neither is visible from either
 * mechanism alone.
 *
 * ── Why every step here is a function ───────────────────────────────────────
 * A Mastra scorer step is either a function or a prompt object, and the judge
 * LLM runs only for prompt objects. Every step below is a function, so these
 * scorers need no model, no API key, and no Mastra instance — which is what
 * lets the measurement half of this file be imported and unit-tested directly,
 * and lets the panel run them in the browser on a draft that is still being
 * written.
 *
 * The measurements are heuristics over text and they are honest about it.
 * `countNames` cannot tell a method from a proper noun; `HEDGES` is a word
 * list. They are useful because they are *stable* — the same draft always
 * scores the same — not because they are subtle.
 */

/* ── getting at the prose ───────────────────────────────────────────────── */

/**
 * The assistant's text, pulled out of whatever the scorer was handed.
 *
 * A `type: 'agent'` scorer receives `MastraDBMessage[]`, whose text lives in
 * `content.parts[].text`. Typed as `unknown` and narrowed by hand on purpose:
 * the same function then takes a plain string in a test or from the panel, and
 * a shape change in Mastra's message format degrades to an empty measurement
 * instead of a thrown scorer mid-run.
 */
export function draftText(output: unknown): string {
	if (typeof output === 'string') return output;
	if (!Array.isArray(output)) return '';

	const chunks: string[] = [];
	for (const message of output) {
		if (!message || typeof message !== 'object') continue;
		const { role, content } = message as { role?: unknown; content?: unknown };
		// A user's own message is not a draft. Messages with no role at all are
		// kept, so a bare `[{ content }]` fixture still measures.
		if (role !== undefined && role !== 'assistant') continue;

		if (typeof content === 'string') {
			chunks.push(content);
			continue;
		}
		const parts = (content as { parts?: unknown } | null | undefined)?.parts;
		if (!Array.isArray(parts)) continue;
		for (const part of parts) {
			const { type, text } = (part ?? {}) as { type?: unknown; text?: unknown };
			if (type === 'text' && typeof text === 'string') chunks.push(text);
		}
	}
	return chunks.join('\n\n');
}

/**
 * The draft without its reference list.
 *
 * A bibliography is dense with citations and contains no claims, so leaving it
 * in makes citation density rise as the reference list grows — the metric
 * would reward adding references to a paragraph that cites none of them.
 */
export function bodyOf(text: string): string {
	const heading = /^#{1,6}\s*references\b/im.exec(text);
	return heading ? text.slice(0, heading.index) : text;
}

/**
 * The paragraphs that make claims.
 *
 * Blocks separated by blank lines, minus heading lines, minus anything too
 * short to be an argument. The floor is twelve words: a bullet like
 * "- three papers, one dataset" is a fragment of a paragraph, and counting it
 * as one halves every per-paragraph number for documents that use lists.
 */
export function paragraphsOf(text: string): string[] {
	return bodyOf(text)
		.split(/\n\s*\n/)
		.map((block) =>
			block
				.split('\n')
				.filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
				.join('\n')
				.trim()
		)
		.filter((block) => countWords(block) >= 12);
}

function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/* ── citations ──────────────────────────────────────────────────────────── */

/**
 * What a citation looks like in this app.
 *
 * The first pattern is what `formatCitation` in `sources.ts` actually emits,
 * so it is the one that matters; the rest catch references the model wrote in
 * some other house's style before `cite` normalised them. Order is irrelevant
 * — every pattern is counted.
 */
const CITATION: RegExp[] = [
	// `Noël et al. (2026)` and `Noël (2026)` — the house format.
	/\p{Lu}[\p{L}'’-]+(?:\s+et al\.)?\s*\(\d{4}\)/gu,
	// A bare arXiv id, which is how a paper is named before it is formatted.
	/\b\d{4}\.\d{4,5}\b/g,
	// Numbered references: `[3]`, `[3, 7]`, `[3–5]`.
	/\[\d+(?:\s*[,–-]\s*\d+)*\]/g,
	// A DOI pasted inline.
	/\bdoi:\s*10\.\d{4,9}\//gi
];

function countCitations(text: string): number {
	return CITATION.reduce((total, pattern) => total + (text.match(pattern)?.length ?? 0), 0);
}

/** Citations removed, so the text left over is only the author's own words. */
function stripCitations(text: string): string {
	return CITATION.reduce((stripped, pattern) => stripped.replace(pattern, ' '), text);
}

export interface CitationMeasure {
	/** Substantive paragraphs, excluding headings and the reference list. */
	paragraphs: number;
	/** How many of them carry at least one citation. */
	cited: number;
	/** Citation marks in total — several in one paragraph still counts once above. */
	marks: number;
	/** 0–1. Every claim-making paragraph attributable is 1. */
	score: number;
}

/**
 * What share of the claim-making paragraphs are attributable.
 *
 * Presence per paragraph rather than count per paragraph, deliberately. A
 * paragraph citing six papers is not six times better than one citing one; it
 * is often a literature dump. What the delivery gate refuses is the *uncited*
 * paragraph — the confident assertion with nothing behind it — so that is what
 * is counted.
 *
 * There is no free allowance for the lede. A first paragraph stating what
 * changed should say which paper changed it.
 */
export function measureCitations(text: string): CitationMeasure {
	const paragraphs = paragraphsOf(text);
	const marks = paragraphs.reduce((total, p) => total + countCitations(p), 0);
	const cited = paragraphs.filter((p) => countCitations(p) > 0).length;
	return {
		paragraphs: paragraphs.length,
		cited,
		marks,
		score: paragraphs.length ? cited / paragraphs.length : 0
	};
}

/* ── specificity ────────────────────────────────────────────────────────── */

/** Any numeral left standing once citation years and arXiv ids are gone. */
const NUMBER = /\b\d+(?:[.,]\d+)?\s*(?:%|pp|×|x\b)?/g;

/**
 * Tokens that look like the name of a method, model or dataset.
 *
 * An acronym (`SAE`, `BM25`), an internal capital (`ViT`, `LoRA`, `ImageNet`),
 * or a name carrying a number (`GPT-4`, `Llama-3`). Deliberately **not** any
 * capitalised word: sentence-initial words and author surnames would swamp the
 * count and make every paragraph look specific.
 */
const NAMED = /\b(?:[A-Z]{2,}[A-Za-z0-9-]*|[A-Z][a-z0-9]*[A-Z][A-Za-z0-9-]*|[A-Z][a-z]+-?\d+)\b/g;

/** Per substantive paragraph, above which extra detail stops being the issue. */
const SPECIFIC_ENOUGH = 3;

export interface SpecificityMeasure {
	paragraphs: number;
	numbers: number;
	names: number;
	/** Concrete details per substantive paragraph. */
	perParagraph: number;
	/** 0–1, saturating at three details a paragraph. */
	score: number;
}

/**
 * How much of the draft is checkable.
 *
 * "Performance improved substantially" and "accuracy rose 4.1 points on
 * ImageNet" are the same sentence with the checkable parts removed, and the
 * second is the one worth a reader's time. Counting numerals and method names
 * is a crude proxy for that difference and a surprisingly durable one.
 *
 * Citations are stripped before counting: a year inside `Noël et al. (2026)`
 * is not a measurement, and counting it would let a paragraph score well for
 * being well-referenced while saying nothing.
 */
export function measureSpecificity(text: string): SpecificityMeasure {
	const paragraphs = paragraphsOf(text);
	let numbers = 0;
	let names = 0;
	for (const paragraph of paragraphs) {
		const plain = stripCitations(paragraph);
		numbers += plain.match(NUMBER)?.length ?? 0;
		names += plain.match(NAMED)?.length ?? 0;
	}
	const perParagraph = paragraphs.length ? (numbers + names) / paragraphs.length : 0;
	return {
		paragraphs: paragraphs.length,
		numbers,
		names,
		perParagraph,
		score: Math.min(1, perParagraph / SPECIFIC_ENOUGH)
	};
}

/* ── hedging ────────────────────────────────────────────────────────────── */

/**
 * Words that withdraw a claim while appearing to make one.
 *
 * Two kinds, counted together because they fail the reader the same way:
 * hedges proper (`may`, `appears to`) and vague quantifiers (`several`,
 * `various`) that stand where a number belongs.
 *
 * Some of these are legitimate and necessary — a result that genuinely *might*
 * generalise should say so. That is exactly why this is a scorer and not a
 * gate: the number is a reading, not a verdict, and a review of a genuinely
 * uncertain literature should score high here and be sent anyway.
 */
const HEDGES = [
	'may',
	'might',
	'could',
	'appears to',
	'appear to',
	'seems to',
	'seem to',
	'suggests that',
	'potentially',
	'possibly',
	'arguably',
	'presumably',
	'relatively',
	'somewhat',
	'tends to',
	'largely',
	'broadly',
	'generally',
	'perhaps',
	'to some extent',
	'in some cases',
	'a number of',
	'several',
	'various',
	'promising'
];

/** Hedges per hundred words at which a paragraph has stopped asserting. */
const HEDGE_CEILING = 5;

export interface HedgeMeasure {
	words: number;
	hedges: number;
	/** Which ones, and how often — far more actionable than the total. */
	hits: { phrase: string; count: number }[];
	per100Words: number;
	/** 0–1, where 1 is prose that commits to its claims. */
	score: number;
}

/**
 * How much of the draft is written in retreat.
 *
 * Inverted relative to the other two: a high score is *little* hedging, so all
 * three read the same direction on a panel — higher is better — and a single
 * average across them is meaningful.
 */
export function measureHedging(text: string): HedgeMeasure {
	const body = bodyOf(text);
	const words = countWords(body);
	const hits: { phrase: string; count: number }[] = [];
	let hedges = 0;

	for (const phrase of HEDGES) {
		// Word boundaries on both sides, so "may" does not fire inside "maybe"
		// and "several" does not fire inside "severally".
		const pattern = new RegExp(`\\b${phrase.replace(/\s+/g, '\\s+')}\\b`, 'gi');
		const count = body.match(pattern)?.length ?? 0;
		if (count) {
			hits.push({ phrase, count });
			hedges += count;
		}
	}

	const per100Words = words ? (hedges / words) * 100 : 0;
	return {
		words,
		hedges,
		hits: hits.sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase)),
		per100Words,
		score: Math.max(0, Math.min(1, 1 - per100Words / HEDGE_CEILING))
	};
}

/* ── all three, for a panel or a test ───────────────────────────────────── */

export interface DraftMeasure {
	citations: CitationMeasure;
	specificity: SpecificityMeasure;
	hedging: HedgeMeasure;
	/** The three scores averaged. Higher is better on all of them. */
	overall: number;
}

/** Every measurement in one pass, with no Mastra involved. */
export function measureDraft(text: string): DraftMeasure {
	const citations = measureCitations(text);
	const specificity = measureSpecificity(text);
	const hedging = measureHedging(text);
	return {
		citations,
		specificity,
		hedging,
		overall: (citations.score + specificity.score + hedging.score) / 3
	};
}

/* ── the same measurements, as Mastra scorers ───────────────────────────── */

/**
 * `type: 'agent'` makes `run.output` the assistant's `MastraDBMessage[]`,
 * which is what an agent-attached scorer is handed at the end of a run.
 * `generateScore` is the one step Mastra requires; `generateReason` is
 * optional and is here because a bare 0.4 in a trace tells nobody anything.
 */
export const citationScorer = createScorer({
	id: 'citation-density',
	name: 'Citation density',
	description: 'Share of claim-making paragraphs that carry at least one citation.',
	type: 'agent'
})
	.analyze(({ run }) => measureCitations(draftText(run.output)))
	.generateScore(({ results }) => results.analyzeStepResult.score)
	.generateReason(
		({ results }) =>
			`${results.analyzeStepResult.cited} of ${results.analyzeStepResult.paragraphs} claim-making paragraphs carry a citation.`
	);

export const specificityScorer = createScorer({
	id: 'specificity',
	name: 'Specificity',
	description: 'Numbers and named methods per paragraph — how much of the draft is checkable.',
	type: 'agent'
})
	.analyze(({ run }) => measureSpecificity(draftText(run.output)))
	.generateScore(({ results }) => results.analyzeStepResult.score)
	.generateReason(
		({ results }) =>
			`${results.analyzeStepResult.numbers} numbers and ${results.analyzeStepResult.names} named methods across ${results.analyzeStepResult.paragraphs} paragraphs.`
	);

export const hedgingScorer = createScorer({
	id: 'hedging',
	name: 'Hedging',
	description:
		'How often the draft withdraws a claim while appearing to make one. 1 is committed prose.',
	type: 'agent'
})
	.analyze(({ run }) => measureHedging(draftText(run.output)))
	.generateScore(({ results }) => results.analyzeStepResult.score)
	.generateReason(({ results }) => {
		const worst = results.analyzeStepResult.hits[0];
		return worst
			? `${results.analyzeStepResult.hedges} hedges in ${results.analyzeStepResult.words} words; most often “${worst.phrase}” (${worst.count}).`
			: `No hedging found in ${results.analyzeStepResult.words} words.`;
	});

/**
 * Ready to hand to an agent: `new Agent({ …, scorers: COLOPHON_SCORERS })`.
 *
 * `sampling` is `{ type: 'ratio', rate }` and not `probability` — tracing
 * sampling uses `probability` for the same idea, and mixing them up produces a
 * config that type-checks against neither. Rate 1 because these cost nothing
 * to run: no judge means no model call, so there is nothing to sample away.
 *
 * Attaching these changes nothing about what the reader receives. That is not
 * a limitation to work around; it is the division of labour this file exists
 * to demonstrate.
 */
export const COLOPHON_SCORERS: MastraScorers = {
	citationDensity: { scorer: citationScorer, sampling: { type: 'ratio', rate: 1 } },
	specificity: { scorer: specificityScorer, sampling: { type: 'ratio', rate: 1 } },
	hedging: { scorer: hedgingScorer, sampling: { type: 'ratio', rate: 1 } }
};
