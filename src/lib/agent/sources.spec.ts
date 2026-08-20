import { describe, it, expect } from 'vitest';
import {
	SourceRegistry,
	UnknownSource,
	NotReadYet,
	canonicalId,
	formatCitation,
	formatReferences,
	type Source
} from './sources';

const attention: Source = {
	id: '1706.03762',
	title: 'Attention Is All You Need',
	authors: ['Ashish Vaswani', 'Noam Shazeer'],
	year: 2017,
	url: 'https://arxiv.org/abs/1706.03762',
	arxivId: '1706.03762',
	depth: 'listed',
	via: 'search_papers'
};

describe('refusing to cite what was never retrieved', () => {
	it('refuses anything on an empty registry, and says why', () => {
		const registry = new SourceRegistry();
		expect(() => registry.cite('1706.03762')).toThrow(UnknownSource);
		expect(() => registry.cite('1706.03762')).toThrow(/nothing has been retrieved yet/);
	});

	it('refuses a plausible fabrication even when real sources exist', () => {
		const registry = new SourceRegistry();
		registry.register(attention);
		// The failure mode this whole module exists to prevent: a real-sounding
		// paper that simply never entered the run.
		expect(() => registry.cite('2401.99999')).toThrow(UnknownSource);
		expect(() => registry.cite('2401.99999')).toThrow(/never entered this run/);
	});

	it('lists what *is* citable in the refusal, so the model can correct itself', () => {
		const registry = new SourceRegistry();
		registry.register(attention);
		expect(() => registry.cite('fake')).toThrow(/1706\.03762/);
	});
});

describe('found is not read', () => {
	it('allows a listed source to be cited by default', () => {
		const registry = new SourceRegistry();
		registry.register(attention);
		expect(registry.cite('1706.03762').title).toBe('Attention Is All You Need');
	});

	it('refuses a listed-only source when the claim requires having read it', () => {
		const registry = new SourceRegistry();
		registry.register(attention);
		expect(() => registry.cite('1706.03762', { require: 'read' })).toThrow(NotReadYet);
		expect(() => registry.cite('1706.03762', { require: 'read' })).toThrow(/never opened/);
	});

	it('allows it once the paper has actually been fetched', () => {
		const registry = new SourceRegistry();
		registry.register(attention);
		registry.register({ ...attention, depth: 'read', via: 'fetch_paper' });
		expect(registry.cite('1706.03762', { require: 'read' }).depth).toBe('read');
	});
});

describe('depth and attribution', () => {
	it('never downgrades depth when a read paper reappears in a search', () => {
		const registry = new SourceRegistry();
		registry.register({ ...attention, depth: 'read', via: 'fetch_paper' });
		registry.register(attention); // listed, from a later search
		expect(registry.get('1706.03762')?.depth).toBe('read');
	});

	it('keeps how a source first entered the run, not how it was last touched', () => {
		const registry = new SourceRegistry();
		registry.register(attention); // via search_papers
		registry.register({ ...attention, depth: 'read', via: 'fetch_paper' });
		expect(registry.get('1706.03762')?.via).toBe('search_papers');
	});
});

describe('identifying a paper the model really did retrieve', () => {
	const registry = new SourceRegistry();
	registry.register({ ...attention, doi: '10.48550/arXiv.1706.03762' });

	it.each([
		['a versioned arXiv id', '1706.03762v5'],
		['an arxiv: prefix', 'arXiv:1706.03762'],
		['the abs URL', 'https://arxiv.org/abs/1706.03762'],
		['the DOI', '10.48550/arXiv.1706.03762'],
		['different case', '10.48550/ARXIV.1706.03762']
	])('resolves %s', (_label, reference) => {
		expect(registry.cite(reference).id).toBe('1706.03762');
	});

	it('is generous about identity and strict about existence', () => {
		// Being pedantic here would produce refusals that look like a broken tool,
		// which teaches the model to stop citing rather than to cite honestly.
		expect(() => registry.cite('1706.03763')).toThrow(UnknownSource);
	});
});

describe('registry views', () => {
	it('separates everything seen from everything actually read', () => {
		const registry = new SourceRegistry();
		registry.register(attention);
		registry.register({
			...attention,
			id: '2005.14165',
			arxivId: '2005.14165',
			title: 'Language Models are Few-Shot Learners',
			depth: 'read'
		});
		expect(registry.size).toBe(2);
		expect(registry.all()).toHaveLength(2);
		expect(registry.read()).toHaveLength(1);
		expect(registry.read()[0].id).toBe('2005.14165');
	});
});

describe('canonicalId', () => {
	it('prefers arXiv, then DOI, then URL', () => {
		expect(canonicalId({ arxivId: '1706.03762v3', doi: '10.1/x', url: 'u' })).toBe('1706.03762');
		expect(canonicalId({ doi: 'https://doi.org/10.1/X', url: 'u' })).toBe('10.1/x');
		expect(canonicalId({ url: 'https://example.org/p' })).toBe('https://example.org/p');
	});
});

describe('formatCitation', () => {
	it('uses surname, et al. and year', () => {
		expect(formatCitation(attention)).toBe('Vaswani et al. (2017), "Attention Is All You Need"');
	});

	it('copes with a single author and a missing year', () => {
		expect(formatCitation({ ...attention, authors: ['Ada Lovelace'], year: undefined })).toBe(
			'Lovelace, "Attention Is All You Need"'
		);
	});
});

describe('formatReferences', () => {
	const spin: Source = {
		id: '2608.14922',
		title: 'SpIn-ViT',
		authors: ['Jae Lee', 'Ada Kim'],
		year: 2026,
		url: 'https://arxiv.org/abs/2608.14922',
		arxivId: '2608.14922',
		depth: 'read',
		via: 'fetch_paper'
	};

	it('writes a heading and one entry per source, with the URL', () => {
		const text = formatReferences([attention, spin]);
		expect(text).toContain('## References');
		expect(text).toContain(
			'- Vaswani et al. (2017), "Attention Is All You Need". https://arxiv.org/abs/1706.03762'
		);
		expect(text).toContain('https://arxiv.org/abs/2608.14922');
	});

	/**
	 * The whole reason this function exists: the model's own attempt leaked the
	 * registry's bookkeeping into the reader's email as "(read) via search_papers".
	 */
	it('never leaks retrieval bookkeeping into the reader-facing text', () => {
		const text = formatReferences([attention, spin]);
		expect(text).not.toMatch(/\bvia\b|search_papers|fetch_paper|\(read\)|\(listed\)/);
	});

	it('returns nothing at all for an empty list, rather than a lonely heading', () => {
		expect(formatReferences([])).toBe('');
	});
});

describe('what was cited, as distinct from what was read', () => {
	const spin: Source = {
		id: '2608.14922',
		title: 'SpIn-ViT',
		authors: ['Jae Lee', 'Ada Kim'],
		year: 2026,
		url: 'https://arxiv.org/abs/2608.14922',
		arxivId: '2608.14922',
		depth: 'listed',
		via: 'search_papers'
	};

	it('records nothing until something is actually cited', () => {
		const registry = new SourceRegistry();
		registry.register(attention);
		expect(registry.cited()).toEqual([]);
	});

	it('keeps citations in the order they were first made, without repeats', () => {
		const registry = new SourceRegistry();
		registry.register({ ...attention, depth: 'read' });
		registry.register(spin);

		registry.cite(spin.id);
		registry.cite(attention.id);
		registry.cite(spin.id);

		expect(registry.cited().map((s) => s.id)).toEqual(['2608.14922', '1706.03762']);
	});

	/**
	 * The bug this whole method exists for: a digest attributed a finding to a
	 * paper it had only seen the abstract of — which `cite` permits — and the
	 * reference list, built from `read()`, silently left that paper out.
	 */
	it('includes a paper cited from its abstract, which read() would have dropped', () => {
		const registry = new SourceRegistry();
		registry.register(spin);
		registry.cite(spin.id, { require: 'listed' });

		expect(registry.read()).toEqual([]);
		expect(registry.cited().map((s) => s.id)).toEqual(['2608.14922']);
		expect(formatReferences(registry.cited())).toContain('SpIn-ViT');
	});

	it('does not record a citation that was refused', () => {
		const registry = new SourceRegistry();
		registry.register(spin);

		expect(() => registry.cite(spin.id, { require: 'read' })).toThrow(NotReadYet);
		expect(() => registry.cite('9999.99999')).toThrow(UnknownSource);
		expect(registry.cited()).toEqual([]);
	});
});
