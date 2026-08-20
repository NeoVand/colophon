import { describe, it, expect } from 'vitest';

/**
 * Hits the real arXiv. Opt-in, because a test suite that needs the internet
 * fails for reasons that have nothing to do with the code — but this is the
 * only test that would have caught arXiv's feedback modal leaking into the
 * text, so it is kept rather than deleted.
 *
 *   LIVE=1 npx vitest run src/lib/agent/paper.live.spec.ts
 */
import { fetchPaper } from './paper';

describe.skipIf(!process.env.LIVE)('live arXiv HTML edition', () => {
	it('reads a recent paper', async () => {
		// 2404.14082 — "Mechanistic Interpretability for AI Safety -- A Review"
		const paper = await fetchPaper('2404.14082');
		console.log('edition :', paper.edition);
		console.log('chars   :', paper.chars);
		console.log('title   :', paper.title.slice(0, 70));
		console.log('sections:', paper.sections.slice(0, 8).join(' | ').slice(0, 200));
		console.log('opening :', paper.text.slice(0, 180).replace(/\n/g, ' '));
		expect(paper.edition).toBe('html');
		expect(paper.chars).toBeGreaterThan(20000);
	}, 60000);

	it('finds an HTML edition even for a 2017 paper', async () => {
		// arXiv has backfilled LaTeXML further than expected: harnessXray assumed
		// pre-2024 papers were PDF-only, and Attention Is All You Need (2017) now
		// has a full HTML edition. The PDF path matters much less than planned.
		const paper = await fetchPaper('1706.03762', {
			fallbackAbstract: 'The dominant sequence models…'
		});
		console.log('2017 paper edition:', paper.edition, paper.chars, 'chars');
		expect(paper.edition).toBe('html');
		expect(paper.text).not.toContain('Report GitHub Issue');
	}, 60000);
});
