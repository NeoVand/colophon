import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '$lib/server/db';
import { blobs } from '$lib/server/blobs';

/**
 * What figures exist, without any of the bytes.
 *
 * Colophon has generated images since M3 and there has never been a door onto
 * them: the tool returns a path, the path serves a PNG, and unless you had
 * pasted that path into a document you could not find out what you owned. This
 * is the index.
 *
 * ── The `bytes` column is deliberately not in the select ─────────────────────
 * A figure is 1.5–2 MB and the store holds up to sixty-four of those. Selecting
 * `bytes` to build a listing would encode the entire gallery as base64 and send
 * ninety megabytes to draw forty captions — and it would do it again on every
 * refresh. The listing carries names and numbers; the pictures are fetched one
 * at a time by `/figures/[...path]`, which serves them `immutable` so a second
 * look costs nothing.
 *
 * Scoped to the `figures/` prefix rather than listing the store whole. The blob
 * store is general — it is the shape of an object store on purpose, so the R2
 * swap is a transcription — but this route is about figures, and a listing that
 * quietly grew to include some future kind of blob would be a surprise.
 */

interface Row {
	key: string;
	content_type: string;
	size: number;
	created_at: string | Date;
}

/**
 * Accept either result shape.
 *
 * drizzle's neon-http driver returns a pg-style `{ rows, fields, … }` object
 * rather than a bare array. `blobs.ts` learned this the expensive way: treating
 * the result as an array reads as "nothing there", which is a silent miss
 * rather than an error — the write succeeded, the read came back empty, and
 * nothing complained.
 */
function rowsOf<T>(result: { rows?: T[] } | T[]): T[] {
	if (Array.isArray(result)) return result;
	return result.rows ?? [];
}

/**
 * Normalise a timestamp the client can parse.
 *
 * The neon driver hands `timestamptz` back in Postgres' own text form
 * (`2026-08-19 09:14:22+00`), not ISO 8601. Parsing it is right in every case
 * seen so far; when it is not, the raw string is still a date a human can read,
 * which beats shipping `Invalid Date` to the gallery.
 */
function iso(at: string | Date): string {
	const date = at instanceof Date ? at : new Date(at);
	return Number.isNaN(date.getTime()) ? String(at) : date.toISOString();
}

export const GET: RequestHandler = async () => {
	// Degrade honestly rather than throwing. Without a database there are no
	// figures — that is a true and boring fact, not a failure, and the gallery
	// says so in one line instead of showing an error page.
	if (!isDatabaseConfigured()) {
		return json({ configured: false, usedBytes: 0, figures: [] });
	}

	try {
		// Asked first, and the order matters. `totalBytes()` goes through the
		// store, which creates the table on first use — the table is not in the
		// schema because it is not permanent. Without that call, a vault that has
		// never generated anything would fail the select below with `relation
		// "blobs" does not exist`, so the emptiest possible gallery would be the
		// one case that 500s.
		const usedBytes = await blobs.totalBytes();

		const result = (await db.execute(sql`
			select key, content_type, size, created_at
			from blobs
			where key like 'figures/%'
			order by created_at desc
		`)) as unknown as { rows?: Row[] } | Row[];

		return json({
			configured: true,
			/** Every blob, not only the figures: it is the number the cap counts. */
			usedBytes,
			figures: rowsOf<Row>(result).map((row) => ({
				key: row.key,
				// `size` is bytes here. In the tool's own result `size` is the pixel
				// dimensions and `bytes` is the byte count — the two words swap
				// meaning across that boundary, which is worth saying out loud.
				size: Number(row.size),
				contentType: row.content_type,
				createdAt: iso(row.created_at)
			}))
		});
	} catch (cause) {
		// A listing that fails must not take down the page that displays it, and
		// must not look like an empty gallery either: "you have no figures" and
		// "I could not find out" are different claims.
		return json({
			configured: true,
			usedBytes: 0,
			figures: [],
			error: cause instanceof Error ? cause.message : String(cause)
		});
	}
};
