import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { isDatabaseConfigured } from '$lib/server/db';
import { getDocument, removeDocument, updateDocument } from '$lib/server/documents';
import { DOCUMENT_KINDS, type DocumentKind } from '$lib/server/db/documents.schema';

/**
 * One document: read it, change it, destroy it.
 *
 * ── `[id]` is a lie of convenience ──────────────────────────────────────────
 * The parameter is whatever handle the caller happens to hold. `getDocument`
 * resolves an id or a slug in one query, and the two namespaces cannot overlap
 * because ids carry a `doc_` prefix that `slugify` strips. So a link pasted
 * from a URL bar and a fetch from an editor holding a row id both land here
 * and both work, and no caller has to know which kind of string it has.
 *
 * PUT and DELETE resolve first and then act on `row.id` rather than on the
 * parameter, because `updateDocument` and `removeDocument` key on the real id.
 *
 * ── PUT, not PATCH, and it is still a partial update ────────────────────────
 * Every field is optional and an absent one is left alone — which is PATCH
 * semantics wearing PUT's name. The editor saves title, kind and body together
 * on every debounce, so in practice it does replace the document; naming it
 * PUT keeps the common case honest, and the optionality is what lets a rename
 * from the rail avoid shipping a chapter of body text back to say one word
 * changed.
 */

/**
 * The same two validators as the collection route, restated.
 *
 * They cannot be shared: SvelteKit rejects a `+server.ts` that exports anything
 * but HTTP methods and its few config keys, so this file cannot import them
 * from its sibling, and a `$lib` module for thirty lines of narrowing would be
 * a file nobody opens twice. Restating them is the smaller cost — but the two
 * copies must stay in step, so this comment exists to say the other one is
 * there.
 */
function asKind(value: unknown): DocumentKind | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string' || !(DOCUMENT_KINDS as readonly string[]).includes(value)) {
		error(400, `Unknown document kind. Expected one of: ${DOCUMENT_KINDS.join(', ')}.`);
	}
	return value as DocumentKind;
}

function asTags(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || value.some((t) => typeof t !== 'string')) {
		error(400, 'Tags must be an array of strings.');
	}
	return value as string[];
}

export const GET: RequestHandler = async ({ params }) => {
	if (!isDatabaseConfigured()) error(503, 'No database is configured.');

	const document = await getDocument(params.id);
	if (!document) error(404, 'No such document.');

	return json({ document });
};

export const PUT: RequestHandler = async ({ params, request }) => {
	if (!isDatabaseConfigured()) {
		error(503, 'No database is configured, so there is nowhere to keep this.');
	}

	const patch = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!patch) error(400, 'A save needs a JSON body.');

	const existing = await getDocument(params.id);
	if (!existing) error(404, 'No such document.');

	const document = await updateDocument(existing.id, {
		title: typeof patch.title === 'string' ? patch.title : undefined,
		kind: asKind(patch.kind),
		body: typeof patch.body === 'string' ? patch.body : undefined,
		slug: typeof patch.slug === 'string' ? patch.slug : undefined,
		tags: asTags(patch.tags)
	});

	/*
	 * `updateDocument` returns undefined when the row vanished between the
	 * lookup above and the write — a second tab deleting it mid-save. That is an
	 * ordinary race, not a server fault, so it reads as the 404 it now is.
	 */
	if (!document) error(404, 'That document was deleted while this save was in flight.');

	return json({ document });
};

/**
 * Gone, and gone for good — the vault has no soft delete.
 *
 * 204 rather than the deleted row: a client that just asked for something to
 * stop existing has no use for a copy of it, and returning one invites the
 * caller to keep holding it.
 */
export const DELETE: RequestHandler = async ({ params }) => {
	if (!isDatabaseConfigured()) error(503, 'No database is configured.');

	const existing = await getDocument(params.id);
	// Already absent is the outcome that was asked for. A 404 here would make a
	// double-click on the delete button look like an error.
	if (existing) await removeDocument(existing.id);

	return new Response(null, { status: 204 });
};
