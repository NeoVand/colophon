import { createSkill, type InlineSkill } from '@mastra/core/skills';

/**
 * Colophon's skills.
 *
 * A skill is **a document the model can decide to read**. That is the whole
 * mechanism, and it is worth saying plainly because the word suggests a
 * capability and this is not one: no code runs, no tool is registered, nothing
 * about the agent changes. `createSkill()` returns a name, a description and a
 * body of markdown. Mastra puts the name and description in front of the model
 * always, and holds the body back until the model calls the `skill` tool and
 * asks for it by name.
 *
 * ── Why this is not simply "more instructions" ──────────────────────────────
 * Everything in an agent's `instructions` is paid for on every provider call,
 * for the whole length of the conversation. A skill's description costs about
 * thirty tokens always; its instructions cost several hundred *once*, and only
 * if the job comes up. So the question a skill answers is not "what should the
 * agent know" but "what should it know **only while doing this one job**".
 *
 * Reviewing the literature and briefing a figure are two such jobs, and each
 * one's guidance is dead weight during the other. That is the test both skills
 * below had to pass to exist.
 *
 * ── The tools that appear with them ─────────────────────────────────────────
 * The moment an agent has any skills at all, Mastra registers three tools:
 * `skill` (activate one by name), `skill_read` (fetch one bundled reference
 * file), and `skill_search` (search across skill text). They are stateless —
 * after a context compaction the model has to call `skill` again — which is
 * why a skill's instructions must stand on their own rather than assume the
 * turn that activated them is still in view.
 *
 * `SkillsPanel.svelte` reads activation off the `skill` tool calls in the run
 * itself, so what it shows is what happened rather than what was configured.
 */

/**
 * A rough token count, deliberately the same rough count Mastra uses.
 *
 * @mastra/core's skill validator estimates `words × 1.3` and warns above 5,000.
 * Using a better estimator here would put the panel's numbers and the
 * framework's own warnings on different scales, and the reader would have no
 * way to tell which one was lying.
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

/** What the skills panel shows for one skill. */
export interface SkillCard {
	name: string;
	/** The line the model sees on every call, and decides to activate from. */
	description: string;
	/** What activating it changes about the work, in the reader's language. */
	contributes: string[];
	/** Files `skill_read` can fetch, one at a time, after activation. */
	references: string[];
	/** Approximate tokens the description costs on every single call. */
	always: number;
	/** Approximate tokens the instructions cost, once, if it is activated. */
	onDemand: number;
}

/* ── the skills ─────────────────────────────────────────────────────────── */

const LITERATURE_REVIEW = `# Writing a literature review

A review earns its length by doing what the abstracts cannot: putting papers
next to each other. If a reader would get the same value from reading the
abstracts in sequence, you have written a list.

## Structure

Write these in this order, and drop any section you have nothing for. An empty
heading is worse than a missing one.

1. **The finding.** One paragraph. What is now true that was not true before,
   and for whom that matters. Not "several papers addressed this topic".
2. **What changed.** For each result: what was measured, on what, against what
   baseline, and by how much. Give the numbers, or say you do not have them.
3. **Where they disagree.** Two papers reaching different conclusions is the
   most valuable thing a review can carry, because no single abstract contains
   it. Name both, say what differs in the setup, and say which difference you
   think explains the gap — or say plainly that you cannot tell.
4. **What this does not establish.** Limitations the authors themselves state.
   A review that reports only the good news is an advertisement.
5. **What to do differently.** If nothing, say so. "No one should change
   anything on the basis of this" is a real finding and a useful one.

## Citations — the house rules

Every reference goes through the \`cite\` tool. It refuses any paper that did
not enter this run through \`search_papers\` or \`fetch_paper\`, so a citation
here cannot be invented. Its two refusals mean different things:

- **"never entered this run"** — you are about to invent a reference. Search.
- **"seen in a search but never opened"** — you are describing contents you
  have only read an abstract of. Fetch the paper, or say in the sentence itself
  that the claim comes from the abstract.

What follows from that:

- Use \`requireRead: true\` for any claim about what a paper *found*,
  *measured* or *concluded*. Abstract-level citation is for what a paper is
  *about*, and nothing more.
- Put the citation on the claim, not in a pile at the end of the paragraph. A
  paragraph making four claims and citing once attributes three of them to
  nobody.
- Do not write a References section by hand. Call \`bibliography\` and let it
  render one. Hand-written lists have shipped here *alongside* the tool's
  list — two bibliographies, disagreeing with each other.
- Citations read as \`Author et al. (Year), "Title"\`. Do not restyle them.

## What to cut

- Sentences about how important the field is.
- "Interest in this area continues to grow." True of every field, every week.
- Restated abstracts. If the sentence would survive the paper not being read,
  reading it was not what produced the sentence.
- Padding. A period containing one interesting result is one paragraph long.`;

const REVIEW_SKELETON = `# Review skeleton

Fill this in; delete what stays empty. It is a shape to write against, not a
form to complete.

## <the finding, as a claim>

<One paragraph. What changed and who should care. No preamble about the field.>

## What changed

- <result> — measured <what> on <dataset/setting>, against <baseline>,
  <delta>. <citation>
- <result> — …

## Where they disagree

<Paper A> reports <x>; <Paper B> reports <y>. They differ in <setup detail>.
<Which difference plausibly explains it — or "the papers do not report enough
to tell".>

## What this does not establish

<Limitations in the authors' own terms. Sample sizes, single-seed runs,
one-domain evaluation, results reported only on the tuning split.>

## What to do differently

<A concrete change in practice, or the sentence "nothing yet, and here is what
would have to be true first: …".>

## References

<Do not write this. Call \`bibliography\`.>`;

/**
 * How to write a review, and the citation rules that go with it.
 *
 * The citation half is here rather than in the agent's instructions because it
 * is only ever needed while writing something with references in it — which is
 * a minority of turns. The `cite` tool enforces provenance on its own; this
 * explains what the enforcement *means*, which the tool's error message cannot
 * do at the length required.
 */
export const literatureReview: InlineSkill = createSkill({
	name: 'literature-review',
	description:
		'Use when writing a review, digest or comparison covering more than one paper. Gives the section structure a review needs to be worth reading, and Colophon’s citation rules — which the cite tool enforces and which cannot be talked around.',
	instructions: LITERATURE_REVIEW,
	references: { 'skeleton.md': REVIEW_SKELETON },
	// Hyphenated, so it has to be quoted in TypeScript. Left explicit rather
	// than defaulted: a reader can ask for the review shape directly.
	'user-invocable': true,
	metadata: {
		contributes: [
			'A five-section shape: finding, what changed, disagreement, limits, what to do.',
			'The two meanings of a cite refusal, and what each obliges you to do next.',
			'requireRead for claims about contents; abstract-level citation for topics.',
			'Never hand-write a References section — bibliography renders it.'
		]
	}
});

const FIGURE_BRIEF = `# Briefing a figure

A figure is worth its cost when it carries one claim that prose carries badly:
a process, a comparison, a structure. Not a quantity — quantities go in a
table, where they can be read exactly.

## The one-sentence test

Before writing anything, state the figure's claim in one sentence. If you
cannot, the document does not need a figure; you want a decoration, and a
decoration in a research digest makes it look less serious rather than more.

## Specify content. Never technique.

This is the rule the skill exists for, and it runs against instinct.

**Say what must be in the picture.** The objects. Their arrangement. What is
larger than what, what flows into what, what is being compared with what, and
every piece of text that has to appear.

**Do not say how it should be drawn.** No palette, no stroke weights, no "flat
vector", no "minimal", no background colour, no icon style. An over-specified
brief comes back as clip-art: the model spends its attention satisfying the
checklist instead of composing a picture, and it is a better designer than the
checklist is.

There is one exception and it is narrow: when the reader has asked for a
particular look, that look *is* content. A house style held constant across a
book's plates is exactly such a request.

## Lettering

- **Quote every string that must appear.** Quoted text renders reliably; text
  the model has to invent for itself does not.
- Keep labels short. Three words beats a clause.
- A misspelled label is repaired by editing the image you just made and naming
  the correct spelling — not by re-rolling the render and hoping.

## One figure, one idea

Two ideas means two figures. A single plate carrying two claims teaches
neither, and that is the most common reason one has to be made twice.

## Cost

\`generate_image\` pauses for the reader's approval before it spends. Calling
it *is* the asking — never ask in prose first, and never wait for a go-ahead
before calling.`;

const FIGURE_EXAMPLES = `# Briefs, before and after

## Over-specified — comes back as clip-art

> A clean, modern, flat-vector diagram on a white background showing the
> retrieval pipeline. Use a blue and orange palette, thin 2px strokes, rounded
> corners, and minimalist line icons.

Everything here is technique. Nothing says what the picture must *show*, so the
model has one degree of freedom left — style — and spends the whole render on
it.

## Specified by content — the same figure, briefed properly

> A figure showing that a paper can be cited only after it has been retrieved.
> Three stages left to right, connected by arrows: a wide fan of search results
> labelled "listed", a much smaller group of opened papers labelled "read", and
> a single one labelled "cited". Between "listed" and "cited" there is a
> blocked path with a barrier across it, labelled "refused". The narrowing from
> stage to stage should be visible at a glance.

Every noun is a thing that must be in the picture; every quoted string is a
label that must be lettered. How it looks is left to the model.

## The one-sentence claim, for each

- Clip-art brief: none stated — which is why it produced a decoration.
- Content brief: "a citation has to pass through retrieval, and most candidates
  do not."`;

/**
 * How to brief an image, which is mostly a list of things not to say.
 *
 * `docs/BOOK.md` carries the doctrine; this is the operational half of it. It
 * lives in a skill because it is needed on the handful of turns that draw
 * something and is pure noise on the rest — and because the instinct it
 * corrects is strong enough that a one-line reminder in the system prompt does
 * not survive contact with a real figure.
 */
export const figureBrief: InlineSkill = createSkill({
	name: 'figure-brief',
	description:
		'Use before calling generate_image. How to write a brief that fixes what the figure must show and leaves how it looks to the model — an over-specified brief comes back as clip-art.',
	instructions: FIGURE_BRIEF,
	references: { 'examples.md': FIGURE_EXAMPLES },
	'user-invocable': true,
	metadata: {
		contributes: [
			'The one-sentence test: no statable claim, no figure.',
			'Specify content — objects, arrangement, quoted labels. Never technique.',
			'Quoted strings letter reliably; invented text does not.',
			'A quantity is a table, not a picture.'
		]
	}
});

/* ── the registry ───────────────────────────────────────────────────────── */

/**
 * Every skill Colophon can offer, in the order they are worth reading about.
 *
 * Pass straight to an agent: `new Agent({ …, skills: [...COLOPHON_SKILLS] })`.
 * Names must stay unique — Mastra throws at lookup time on a duplicate name
 * with the same source type, which surfaces as a failed `skill` tool call in
 * the middle of a run rather than as a startup error.
 */
export const COLOPHON_SKILLS: InlineSkill[] = [literatureReview, figureBrief];

/** One skill, as the panel needs it. */
export function skillCard(skill: InlineSkill): SkillCard {
	// `contributes` rides in the skill's own `metadata`, so the panel copy and
	// the thing it describes cannot drift apart into two files.
	const contributes = skill.metadata?.contributes;
	return {
		name: skill.name,
		description: skill.description,
		contributes: Array.isArray(contributes) ? contributes.map(String) : [],
		references: skill.references,
		always: estimateTokens(`${skill.name} ${skill.description}`),
		onDemand: estimateTokens(skill.instructions)
	};
}

export const SKILL_CARDS: SkillCard[] = COLOPHON_SKILLS.map(skillCard);
