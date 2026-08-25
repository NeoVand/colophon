import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { captureFor } from '$lib/agent/capture';
import { decompose } from '$lib/agent/context';

/**
 * One model call, opened up — the pieces with their text, or the body whole.
 *
 * The context panel already gets a decomposition on the event stream: labels,
 * sizes, shares, live, per call. What it could not do was let you read the
 * piece a row named, and that is most of why the panel was thinner than
 * harnessXray's — there, the request is in the browser, so a row can simply
 * expand onto its own text.
 *
 * Colophon's request is on the server, so the text has to be asked for. Sending
 * it on the stream instead was the obvious alternative and it is wrong: the
 * pieces of a request *are* the request, so a decomposition carrying text is
 * the request sent twice, on every call, whether or not anyone opens a row. A
 * twelve-call research turn would push megabytes to draw a list of labels.
 *
 * So the stream stays light and this serves the one call on screen, from the
 * same captured body through the same `decompose`. There is no second source of
 * truth here — only a second reading of the first one, with `text: true`.
 *
 * ── What it cannot do, said out loud ────────────────────────────────────────
 * The store is in memory and bounded (see `capture.ts`). A call from a turn
 * several conversations ago, or from before a cold start, is simply gone, and
 * this returns 404 rather than something plausible. On Vercel it will also miss
 * whenever the request lands on a different instance from the run.
 *
 * Gating is `hooks.server.ts`'s job: everything but `/api/cron/` sits behind
 * the session cookie.
 */

/** The whole body, capped. Past this a browser is scrolling, not reading. */
const RAW_LIMIT = 250_000;

export const GET: RequestHandler = async ({ url }) => {
	const thread = url.searchParams.get('thread') ?? '';
	const wanted = Number(url.searchParams.get('call'));
	const raw = url.searchParams.get('raw') === '1';

	const capture = captureFor(thread);
	if (!capture) {
		/*
		 * 404 with a sentence, not a bare status. The panel has to be able to say
		 * *which* absence this is — nothing has run, or it ran and the body has
		 * been evicted — and a status code cannot tell those apart.
		 */
		error(
			404,
			'No captured requests for this conversation. It may have been evicted, or run on another instance.'
		);
	}

	/** Every call still held, so the pager knows where it can actually go. */
	const calls = capture.requests.map((r) => ({ call: r.seq, bytes: r.bytes, at: r.at, ms: r.ms }));

	const record = Number.isFinite(wanted)
		? capture.requests.find((r) => r.seq === wanted)
		: capture.latest();

	if (!record) {
		return json({ calls, found: false });
	}

	if (raw) {
		const text = JSON.stringify(record.body, null, 2) ?? '';
		return json({
			calls,
			found: true,
			call: record.seq,
			bytes: record.bytes,
			raw: text.slice(0, RAW_LIMIT),
			// The panel says how much it is not showing rather than ending
			// mid-token and letting a reader take that for the whole request.
			clipped: Math.max(0, text.length - RAW_LIMIT)
		});
	}

	// The same function the stream uses, asked for the text this time. Piece ids
	// are deterministic from the body, so a row streamed live and the piece
	// fetched here are matched by id without either side keeping a mapping.
	const { model, parts, chars } = decompose(record.body, { text: true });

	return json({
		calls,
		found: true,
		call: record.seq,
		model,
		chars,
		bytes: record.bytes,
		ms: record.ms,
		parts
	});
};
