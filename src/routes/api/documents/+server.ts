import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { isDatabaseConfigured } from '$lib/server/db';
import { createDocument, listDocuments } from '$lib/server/documents';
import { DOCUMENT_KINDS, type DocumentKind } from '$lib/server/db/documents.schema';

/**
 * The vault's writing side, as a door.
 *
 * `documents.ts` has had every operation an editor needs since it was written,
 * and no route ever pointed at it — the table was reachable only from a SQL
 * client. This is the index and the create.
 *
 * ── Why JSON routes and not form actions ────────────────────────────────────
 * The vault page uses form actions because its writes are punctuation: follow a
 * topic, pause it, delete it. Each one is a whole navigation and that is fine
 * at one write a minute. An editor writes on a debounce — a save every second
 * or two, mid-keystroke — and a form action re-runs `load` and re-renders the
 * page for each of them, which would fight the caret. `fetch` against a JSON
 * route touches nothing the editor is holding.
 *
 * Both doors lead to the same functions, so neither can drift from the other.
 *
 * Authentication is `hooks.server.ts`'s job: everything under `/api/` that is
 * not `/api/cron/` is behind the session cookie, and an unauthenticated call
 * here is a 401 before this module runs.
 */

/** The list carries no bodies — see `DocumentSummary` for why. */
export const GET: RequestHandler = async () => {
	// A missing database is a true and boring fact, not a failure. The rail says
	// so in one line rather than showing an error page over an empty vault.
	if (!isDatabaseConfigured()) return json({ configured: false, documents: [] });

	return json({ configured: true, documents: await listDocuments() });
};

/**
 * Narrow an untrusted string to a kind, or refuse.
 *
 * `kind` selects a renderer, and an unknown one would reach `DocumentViewer`
 * and fall through to the source view — a document that silently renders as
 * the wrong thing forever, with nothing on screen to say why. A 400 at the
 * door is the only place this is cheap to notice.
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

/**
 * A new document, which is allowed to be completely empty.
 *
 * No required field, deliberately. "New" in an editor means a blank page you
 * start typing into; demanding a title first puts a dialog between the impulse
 * and the writing. `createDocument` titles it 'Untitled' and slugs it
 * accordingly, and the first save that carries a real title replaces the one
 * without touching the slug — which is the whole reason the slug does not
 * follow the title.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isDatabaseConfigured()) {
		error(503, 'No database is configured, so there is nowhere to keep this.');
	}

	// An empty body is a legitimate "give me a blank page", so a parse failure
	// is treated as one rather than as an error.
	const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;

	const document = await createDocument({
		title: typeof input.title === 'string' ? input.title : undefined,
		kind: asKind(input.kind),
		body: typeof input.body === 'string' ? input.body : undefined,
		slug: typeof input.slug === 'string' ? input.slug : undefined,
		tags: asTags(input.tags)
	});

	return json({ document }, { status: 201 });
};
