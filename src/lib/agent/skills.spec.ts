import { describe, it, expect } from 'vitest';
import { isInlineSkill, resolveAgentSkills } from '@mastra/core/skills';
import { COLOPHON_SKILLS, SKILL_CARDS, figureBrief, literatureReview, skillCard } from './skills';

/**
 * `createSkill()` validates and throws, so the mere fact this file imports
 * `./skills` without exploding is already a test — an invalid name or an empty
 * description would fail at module load. What is below covers the things it
 * does *not* check: the limits Mastra only warns about, the tool names the
 * instructions depend on, and whether the skills survive the resolver the
 * agent actually puts them through.
 */

/** The same estimate Mastra's own validator uses, so the limits line up. */
const estimate = (text: string) => Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);

describe('the skills themselves', () => {
	it('names are valid slugs and unique', () => {
		const names = COLOPHON_SKILLS.map((s) => s.name);
		for (const name of names) expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		// Two skills sharing a name make `skills.get()` throw at lookup time,
		// which surfaces as a failed `skill` tool call mid-run rather than as
		// anything at startup.
		expect(new Set(names).size).toBe(names.length);
	});

	it('descriptions fit the 1024-character field', () => {
		for (const skill of COLOPHON_SKILLS) {
			expect(skill.description.length).toBeGreaterThan(0);
			expect(skill.description.length).toBeLessThanOrEqual(1024);
		}
	});

	it('instructions stay under the size Mastra warns at', () => {
		// 500 lines / ~5,000 tokens are warnings, not errors — nothing fails if
		// they are crossed, which is exactly why it is asserted here. Past them,
		// content belongs in a reference file the model fetches on demand.
		for (const skill of COLOPHON_SKILLS) {
			expect(skill.instructions.split('\n').length).toBeLessThan(500);
			expect(estimate(skill.instructions)).toBeLessThan(5000);
		}
	});

	it('are inline skills, so no filesystem is involved', () => {
		for (const skill of COLOPHON_SKILLS) expect(isInlineSkill(skill)).toBe(true);
	});
});

describe('the tool names the instructions lean on', () => {
	/**
	 * These are not style assertions. A skill that tells the model to call
	 * `cite` after `cite` has been renamed is worse than no skill: it reads as
	 * authoritative and sends the model to a tool that is not there. Renaming a
	 * tool should break this test and force the prose to be updated with it.
	 */
	it('literature-review names the retrieval and citation tools', () => {
		for (const tool of ['search_papers', 'fetch_paper', 'cite', 'bibliography']) {
			expect(literatureReview.instructions).toContain(tool);
		}
	});

	it('figure-brief names the image tool', () => {
		expect(figureBrief.instructions).toContain('generate_image');
	});
});

describe('references', () => {
	it('are exposed as bare keys on the skill', () => {
		expect(literatureReview.references).toEqual(['skeleton.md']);
		expect(figureBrief.references).toEqual(['examples.md']);
	});

	it('are readable through the resolver the agent uses', async () => {
		const skills = resolveAgentSkills([...COLOPHON_SKILLS]);

		const listed = (await skills.list()).map((s) => s.name).sort();
		expect(listed).toEqual(['figure-brief', 'literature-review']);

		const resolved = await skills.get('literature-review');
		expect(resolved?.instructions).toBe(literatureReview.instructions);

		// The path carries the `references/` prefix — `getReference` joins it
		// onto the skill root, so the bare key that `skill.references` reports is
		// *not* what you pass here. Getting this wrong returns null rather than
		// throwing, which is how it hides.
		expect(await skills.getReference('literature-review', 'references/skeleton.md')).toContain(
			'Review skeleton'
		);
		expect(await skills.getReference('literature-review', 'skeleton.md')).toBeNull();
	});
});

describe('skill cards', () => {
	it('carry the contributes list out of the skill metadata', () => {
		const card = skillCard(literatureReview);
		expect(card.name).toBe('literature-review');
		expect(card.contributes.length).toBeGreaterThan(0);
		expect(card.contributes.some((line) => line.includes('bibliography'))).toBe(true);
	});

	it('cost far less always than on demand — the whole reason for a skill', () => {
		// If a skill's description approached the size of its instructions there
		// would be no saving in deferring it, and the guidance should simply live
		// in the agent's own instructions instead.
		for (const card of SKILL_CARDS) {
			expect(card.always).toBeGreaterThan(0);
			expect(card.onDemand).toBeGreaterThan(card.always * 5);
		}
	});

	it('cover every skill, in registry order', () => {
		expect(SKILL_CARDS.map((c) => c.name)).toEqual(COLOPHON_SKILLS.map((s) => s.name));
	});
});
