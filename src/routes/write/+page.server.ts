import type { PageServerLoad } from './$types';
import { isDatabaseConfigured } from '$lib/server/db';
import { getDocument, listDocuments } from '$lib/server/documents';

/**
 * The writing surface, opened on something.
 *
 * The rail and the first document are loaded here rather than fetched on mount,
 * for one reason worth the extra query: an editor that paints empty and then
 * fills in is an editor you cannot start typing into for a beat, and the beat
 * is exactly when you knew what you wanted to say. Everything after this — the
 * saves, the switches, the deletes — goes through `/api/documents`, which
 * leaves the caret alone.
 *
 * ── Why it opens the most recent document by default ────────────────────────
 * `updatedAt` order means "the thing you were last working on", which is the
 * right answer to the unasked question almost every time someone opens a
 * writing app. An explicit `?doc=` wins, and takes an id or a slug because
 * `getDocument` resolves either.
 *
 * A `?doc=` that names nothing falls back to the most recent rather than 404ing.
 * The handle in that link was real once — a deleted draft, a renamed slug — and
 * dropping the reader into their vault is a better answer than an error page
 * about a document that is definitionally not coming back.
 */
export const load: PageServerLoad = async ({ url }) => {
	if (!isDatabaseConfigured()) {
		return { configured: false, documents: [], open: null };
	}

	const documents = await listDocuments();

	// The listing deliberately carries no bodies, so the open document is a
	// second read. One extra query beats sending every draft's full text to
	// draw a list of titles.
	const wanted = url.searchParams.get('doc');
	const open =
		(wanted ? await getDocument(wanted) : undefined) ??
		(documents.length ? await getDocument(documents[0].id) : undefined);

	return { configured: true, documents, open: open ?? null };
};
