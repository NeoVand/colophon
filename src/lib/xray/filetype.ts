import type { IconName } from '$lib/icons';

/**
 * What a file looks like, decided once.
 *
 * The X-ray shows files in at least four places — the paper list, a tool
 * result, an attachment, a figure — and each one that guesses for itself
 * eventually disagrees with the others: a PDF drawn with the same glyph as a
 * markdown note, a PNG drawn with the sparkles that mean "generated image".
 * One table, six kinds, no guessing at the call site.
 *
 * ── Why these get their own colour tokens ───────────────────────────────────
 * The `--co-*` legend is a legend: ochre means a tool ran, sage means the
 * library, violet means the delivery gate withheld something. Borrowing one of
 * those for "this file is a PDF" says something untrue in a panel whose whole
 * claim is that its colours mean things.
 *
 * So file kinds get a family of their own, `--co-file-*`, free to use the
 * conventional associations a reader already holds — red for PDF, green for
 * tabular data, violet for pictures. Each is declared with a fallback to
 * `--muted-foreground`, so before those tokens exist in `layout.css` a file row
 * renders in neutral ink rather than inheriting whatever colour it happens to
 * sit in.
 */
export type FileKind = 'doc' | 'pdf' | 'image' | 'data' | 'code' | 'plain';

export interface FileFace {
	kind: FileKind;
	/** A key into `ICON`, not an icon value: this module stays free of imports. */
	icon: IconName;
	/** The custom property itself, for a stylesheet that wants to declare it. */
	token: string;
	/** Ready to drop into a `style:color`, with a neutral fallback. */
	color: string;
	/** For a title attribute, where the glyph alone is not enough. */
	label: string;
}

function face(kind: FileKind, icon: IconName, label: string): FileFace {
	const token = `--co-file-${kind}`;
	return { kind, icon, token, color: `var(${token}, var(--muted-foreground))`, label };
}

export const FILE_FACE: Record<FileKind, FileFace> = {
	// `prose` is the lines-of-text glyph: a document is a thing meant to be read,
	// which is exactly what separates it from `plain` below.
	doc: face('doc', 'prose', 'document'),
	pdf: face('pdf', 'pdf', 'PDF'),
	image: face('image', 'figure', 'image'),
	// `spend` is the registry's key for the database glyph — named for the panel
	// it was first added to, not for the picture. A data file wants that picture.
	// If `icons.ts` ever gains a `data` alias, this is the one line to change.
	data: face('data', 'spend', 'data'),
	code: face('code', 'raw', 'code'),
	plain: face('plain', 'paper', 'text')
};

const IMAGE = /^(png|jpe?g|webp|gif|svg|avif|heic|tiff?|bmp|ico)$/;
const DOC = /^(md|markdown|tex|rst|docx?|rtf|odt|epub)$/;
const DATA = /^(csv|tsv|jsonl?|ndjson|ya?ml|toml|parquet|xlsx?)$/;
const CODE =
	/^(ts|tsx|js|jsx|mjs|cjs|svelte|py|rb|rs|go|java|c|h|cpp|sh|zsh|html?|css|scss|sql|bib)$/;

/**
 * The kind of a path, URL or bare filename.
 *
 * Deliberately tolerant about what it is handed, because in practice it is
 * handed all three. The cases that are wrong if you only split on the last dot:
 *
 *   `https://arxiv.org/…/fig3.png?v=2`  the query is not part of the extension
 *   `docs.v2/README`                    the dot is in a directory, not the file
 *   `.gitignore`                        a leading dot is a name, not a suffix
 *
 * Anything unrecognised is `plain` rather than a seventh "unknown" kind: a file
 * we cannot classify still needs a glyph, and text is the honest default.
 */
export function kindOf(path: string): FileKind {
	const base = (path.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '').trim();
	const dot = base.lastIndexOf('.');
	const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';

	if (ext === 'pdf') return 'pdf';
	if (IMAGE.test(ext)) return 'image';
	if (DOC.test(ext)) return 'doc';
	if (DATA.test(ext)) return 'data';
	if (CODE.test(ext)) return 'code';
	return 'plain';
}

/** The glyph, colour and label for a path, in one call. */
export function faceOf(path: string): FileFace {
	return FILE_FACE[kindOf(path)];
}
