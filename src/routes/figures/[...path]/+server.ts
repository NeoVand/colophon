import type { RequestHandler } from './$types';
import { blobs } from '$lib/server/blobs';
import { error } from '@sveltejs/kit';

/**
 * Serve a generated figure.
 *
 * The path mirrors the key the tool returns (`/figures/<slug>.png`), so a
 * markdown image reference written by the agent resolves without translation —
 * the document says `![](/figures/x.png)` and that is exactly where it lives.
 *
 * Behind the password gate like everything else: these are the reader's own
 * research figures, and the repo is public while the vault is not.
 */
export const GET: RequestHandler = async ({ params, setHeaders }) => {
	const blob = await blobs.get(`figures/${params.path}`);
	if (!blob) error(404, 'No such figure.');

	setHeaders({
		'content-type': blob.contentType,
		// Content-addressed by name and never rewritten in place, so this is safe
		// and saves re-reading megabytes on every view of a document.
		'cache-control': 'private, max-age=31536000, immutable'
	});
	return new Response(blob.bytes as BodyInit);
};
