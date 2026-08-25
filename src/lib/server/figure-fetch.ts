import { blobs } from './blobs';
import { figureSlug, type ExtractedFigure } from '$lib/agent/figures';

/**
 * Getting an extracted figure into the store.
 *
 * `src/lib/agent/figures.ts` decides *what* a paper's figures are, purely from
 * its HTML; this fetches the bytes and puts them where `/figures/[...path]`
 * serves from. The split is deliberate: the parsing is the part with the sharp
 * edges and it is testable without a network or a database.
 *
 * Keys mirror the generated-figure convention (`figures/<name>.<ext>`), so an
 * extracted figure and a commissioned one are the same kind of thing to the
 * gallery, to the document viewer and to a markdown `![](…)` — the difference
 * that matters is in the caption, which says where the picture came from.
 */

export interface StoredFigure {
	/** The path a document embeds, and the route that serves it. */
	path: string;
	/** The blob key behind that path. */
	key: string;
	caption: string;
	bytes: number;
	contentType: string;
	index: number;
}

export type FigureFetchResult = { ok: true; figure: StoredFigure } | { ok: false; reason: string };

/**
 * A ceiling of our own, well under the store's 8 MB per-object cap.
 *
 * A paper figure is tens to a few hundred kilobytes; anything past two
 * megabytes is a poster-sized render or a mislabelled archive, and the blob
 * store is a stopgap living in Postgres (see `blobs.ts`) where forty images
 * fill the budget. Checking here means an oversized file is refused before it
 * is downloaded rather than after.
 */
const FIGURE_CAP_BYTES = 2 * 1024 * 1024;

/** Extensions for the formats arXiv actually serves. */
const EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
	'image/avif': 'avif'
};

function extensionFor(contentType: string): string | undefined {
	const mime = contentType.split(';')[0].trim().toLowerCase();
	if (EXTENSIONS[mime]) return EXTENSIONS[mime];
	// An image subtype nobody has seen yet is still an image; a sanitised
	// subtype is a better extension than refusing a perfectly good figure.
	const subtype = mime.startsWith('image/') ? mime.slice(6).replace(/[^a-z0-9]/g, '') : '';
	return subtype || undefined;
}

/**
 * Download one figure and store it.
 *
 * Returns a reason instead of throwing for anything that is merely this
 * figure's problem — a 404, a redirect to an HTML error page, an oversized
 * file. One bad image in a paper should cost that image, not the extraction.
 * A full blob store is not that kind of problem and is left to throw.
 */
export async function storeFigure(
	arxivId: string,
	figure: ExtractedFigure,
	{ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}
): Promise<FigureFetchResult> {
	let response: Response;
	try {
		response = await fetchImpl(figure.url);
	} catch {
		// arxiv.org refuses connections under burst load rather than answering,
		// which reads as a crash unless it is turned back into words here.
		return { ok: false, reason: `could not reach ${figure.url}` };
	}
	if (!response.ok) return { ok: false, reason: `HTTP ${response.status} for ${figure.url}` };

	const contentType = response.headers.get('content-type') ?? '';
	const extension = extensionFor(contentType);
	// arXiv answers a missing asset with a 200 and an HTML page often enough that
	// trusting the status alone stores web pages under a .png.
	if (!extension) return { ok: false, reason: `${figure.url} is ${contentType || 'untyped'}` };

	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > FIGURE_CAP_BYTES)
		return { ok: false, reason: `${figure.url} is ${Math.round(declared / 1024)} KB` };

	const bytes = new Uint8Array(await response.arrayBuffer());
	// Checked again: `content-length` is absent on a chunked response, so the
	// header test above is an optimisation and this one is the actual limit.
	if (bytes.byteLength > FIGURE_CAP_BYTES)
		return { ok: false, reason: `${figure.url} is ${Math.round(bytes.byteLength / 1024)} KB` };
	if (!bytes.byteLength) return { ok: false, reason: `${figure.url} is empty` };

	// Numbered by position rather than by the caption's label: position is unique
	// within a paper, and two figures overwriting each other in the store would
	// be a silent loss rather than an error.
	const key = `figures/${figureSlug(arxivId)}-fig${figure.index}.${extension}`;
	await blobs.put(key, bytes, contentType.split(';')[0].trim());

	return {
		ok: true,
		figure: {
			path: `/${key}`,
			key,
			caption: figure.caption,
			bytes: bytes.byteLength,
			contentType,
			index: figure.index
		}
	};
}
