import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';

/**
 * Somewhere to put bytes.
 *
 * ── This implementation is deliberately temporary ───────────────────────────
 * Images live in Postgres today, and that is the wrong home for them. Neon's
 * free tier is 0.5 GB and one 1536×1024 render is 1.5–2 MB, so roughly 250
 * pictures would fill the entire database — including the threads, the memory
 * and the library that actually need to be there.
 *
 * The right home is **R2**: 10 GB free and, more importantly, zero egress, which
 * matters because a book re-reads its own plates on every view. That needs a
 * Cloudflare account, so it is one of the few things that cannot be done
 * without Neo. Until then this exists behind an interface so the swap is one
 * file, and a hard cap keeps a runaway loop from eating the database.
 *
 * The interface is deliberately the shape of an object store — put/get/delete
 * by key, content type alongside — rather than the shape of a table, so the R2
 * implementation is a transcription rather than a redesign.
 */

export interface Blob {
	key: string;
	contentType: string;
	bytes: Uint8Array;
	size: number;
}

export interface BlobStore {
	put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
	get(key: string): Promise<Blob | undefined>;
	delete(key: string): Promise<void>;
	totalBytes(): Promise<number>;
}

/**
 * The ceiling that stands between an experiment and a full database.
 *
 * 64 MB is roughly forty images: enough to build and look at a chapter's plates,
 * nowhere near enough to matter against 0.5 GB. When it is hit, generation fails
 * loudly with an instruction rather than silently filling the disk.
 */
const TOTAL_CAP_BYTES = 64 * 1024 * 1024;
const SINGLE_CAP_BYTES = 8 * 1024 * 1024;

export class BlobCapReached extends Error {
	constructor(used: number) {
		super(
			`Blob storage is full (${Math.round(used / 1024 / 1024)} MB of ` +
				`${TOTAL_CAP_BYTES / 1024 / 1024} MB). Images live in Postgres as a stopgap — ` +
				`provision R2 and switch the store, or delete old blobs.`
		);
		this.name = 'BlobCapReached';
	}
}

interface Row {
	key: string;
	content_type: string;
	b64: string;
	size: number;
}

/** Accept either shape, so a driver swap cannot silently return nothing. */
function rowsOf<T>(result: { rows?: T[] } | T[]): T[] {
	if (Array.isArray(result)) return result;
	return result.rows ?? [];
}

/** Created on first use rather than in the schema: this table is not permanent. */
let ensured = false;
async function ensureTable(): Promise<void> {
	if (ensured) return;
	await db.execute(sql`
		create table if not exists blobs (
			key text primary key,
			content_type text not null,
			bytes bytea not null,
			size integer not null,
			created_at timestamptz not null default now()
		)
	`);
	ensured = true;
}

export const postgresBlobs: BlobStore = {
	async put(key, bytes, contentType) {
		if (bytes.byteLength > SINGLE_CAP_BYTES) {
			throw new Error(
				`Blob "${key}" is ${Math.round(bytes.byteLength / 1024 / 1024)} MB, over the ` +
					`${SINGLE_CAP_BYTES / 1024 / 1024} MB single-object cap.`
			);
		}
		await ensureTable();

		const used = await postgresBlobs.totalBytes();
		if (used + bytes.byteLength > TOTAL_CAP_BYTES) throw new BlobCapReached(used);

		// Hex is the portable way to hand bytea to Postgres through a driver that
		// has no first-class binary parameter, and it costs 2× on the wire only.
		const hex = Buffer.from(bytes).toString('hex');
		await db.execute(sql`
			insert into blobs (key, content_type, bytes, size)
			values (${key}, ${contentType}, decode(${hex}, 'hex'), ${bytes.byteLength})
			on conflict (key) do update set
				content_type = excluded.content_type,
				bytes = excluded.bytes,
				size = excluded.size
		`);
	},

	async get(key) {
		await ensureTable();
		// drizzle's neon-http driver returns a pg-style result object, not a bare
		// array — `{ fields, rows, rowCount, … }`. Treating it as an array reads
		// as "no such blob", which is a silent miss rather than an error: the put
		// succeeded, the get returned undefined, and nothing complained.
		const result = (await db.execute(sql`
			select key, content_type, encode(bytes, 'base64') as b64, size
			from blobs where key = ${key}
		`)) as unknown as { rows?: Row[] } | Row[];

		const row = rowsOf<Row>(result)[0];
		if (!row) return undefined;
		return {
			key: row.key,
			contentType: row.content_type,
			bytes: new Uint8Array(Buffer.from(row.b64, 'base64')),
			size: row.size
		};
	},

	async delete(key) {
		await ensureTable();
		await db.execute(sql`delete from blobs where key = ${key}`);
	},

	async totalBytes() {
		await ensureTable();
		const result = (await db.execute(
			sql`select coalesce(sum(size), 0)::bigint as total from blobs`
		)) as unknown as { rows?: { total: string | number }[] } | { total: string | number }[];
		return Number(rowsOf<{ total: string | number }>(result)[0]?.total ?? 0);
	}
};

export const blobs: BlobStore = postgresBlobs;
