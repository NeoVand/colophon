/**
 * The outgoing request, taken apart.
 *
 * A token total tells you what a turn cost. This tells you *what you bought*:
 * how much of the window is the system prompt, how much is tool schemas you
 * will never use on this turn, how much is one paper's excerpt sitting in the
 * history being re-sent on every subsequent call. That last one is the reason
 * this exists — it is the single most expensive mistake an agent can make and
 * it is completely invisible from a chat window.
 *
 * ── Written against the wire, not against the docs ──────────────────────────
 * Every item kind below was observed by capturing a real request through
 * `/lab/capture`, because the shape is not documented anywhere: it depends on
 * the AI SDK version, on the provider choosing the Responses API over Chat
 * Completions, and on how Mastra assembles instructions. The five kinds that
 * actually appear in an `input` array are:
 *
 *   { role: 'developer', content: string }              the assembled system prompt
 *   { role: 'user', content: [{ type: 'input_text' }] }  what you typed
 *   { type: 'item_reference', id: 'rs_…' }               reasoning, BY REFERENCE
 *   { type: 'function_call', call_id, name, arguments }  the model asking
 *   { type: 'function_call_output', call_id, output }    what came back
 *
 * The third is worth knowing and cost nothing to discover: the provider's
 * reasoning is **not re-sent**. It stays server-side and comes back as a
 * fourteen-byte id, so a long chain of thought is not re-billed on every
 * subsequent call the way the conversation is. An X-ray that showed reasoning
 * as a large band in the context window would be inventing a cost.
 *
 * Anything unrecognised is reported as `other` rather than dropped: an unknown
 * item still occupies the window, and silently omitting it would make the
 * bands add up to less than the request and quietly understate what was sent.
 */

export type PartKind =
	| 'system'
	| 'user'
	| 'assistant'
	| 'tool-schema'
	| 'tool-call'
	| 'tool-result'
	| 'reasoning-ref'
	| 'other';

export interface Part {
	/**
	 * Unique within a decomposition, and the reason it exists: labels repeat.
	 * Every `function_call_output` would otherwise be called "tool result", and a
	 * keyed list of them throws `each_key_duplicate` — which does not merely
	 * misdraw, it aborts the render and leaves whatever was on screen before,
	 * so the panel silently shows its own empty state during a live run.
	 *
	 * Deterministic from the body, which is load-bearing: the light
	 * decomposition that rides the stream and the full one the context endpoint
	 * serves are two runs of this function over the same bytes, and the panel
	 * matches a fetched piece to a streamed row by this id.
	 */
	id: string;
	kind: PartKind;
	/** What a person would call this row. */
	label: string;
	/** Serialised characters, which is what the share is computed from. */
	chars: number;
	/** Fraction of the whole request, 0–1. */
	share: number;
	/** Billed input tokens attributed to this row, once `apportion` has run. */
	tokens?: number;
	/**
	 * The piece itself, present only when it was asked for.
	 *
	 * Off by default and that is deliberate. Every row's text together *is* the
	 * request, so a decomposition carrying text is the request sent twice — on a
	 * twelve-call research turn that is megabytes pushed to the browser to draw
	 * a list of labels. The stream sends the light version; `/api/context` reads
	 * the same captured body again, with text, for the one call on screen.
	 */
	text?: string;
	/** Characters dropped from `text` by the cap. Absent when nothing was cut. */
	clipped?: number;
}

/**
 * The three bands a reader actually asks about.
 *
 * Not a fourth field on the wire — it is a pure function of `kind`, and a
 * derived value that travels is a derived value that can arrive disagreeing
 * with what it was derived from.
 */
export type PartGroup = 'system' | 'tools' | 'messages';

export function groupOf(kind: PartKind): PartGroup {
	if (kind === 'system') return 'system';
	if (kind === 'tool-schema') return 'tools';
	return 'messages';
}

export interface Decomposition {
	model?: string;
	parts: Part[];
	/** Serialised characters across every part. */
	chars: number;
	/** Bytes of the whole request, which exceeds `chars` by the JSON framing. */
	bytes?: number;
}

/** How many characters a value takes once serialised. */
function sizeOf(value: unknown): number {
	if (value === undefined || value === null) return 0;
	if (typeof value === 'string') return value.length;
	return JSON.stringify(value).length;
}

/** Responses-API content: a bare string, or an array of typed parts. */
function textOf(content: unknown): number {
	if (typeof content === 'string') return content.length;
	if (!Array.isArray(content)) return sizeOf(content);
	return content.reduce((sum: number, part) => {
		const p = part as { text?: unknown };
		return sum + (typeof p?.text === 'string' ? p.text.length : sizeOf(part));
	}, 0);
}

/**
 * The same content, as the string a person reads.
 *
 * Deliberately a second function rather than `textOf` returning a string that
 * gets measured: the sizes are computed on every request and the strings only
 * when someone asks, and a shared implementation would tempt the light path
 * into building megabytes it then throws away.
 */
function stringOf(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return content === undefined ? '' : pretty(content);
	return content
		.map((part) => {
			const p = part as { text?: unknown };
			return typeof p?.text === 'string' ? p.text : pretty(part);
		})
		.join('\n');
}

/** JSON a reader can scan, falling back to a description rather than throwing. */
function pretty(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return '[unserialisable]';
	}
}

/**
 * How much of one piece the endpoint will hand over.
 *
 * A fetched paper's tool result is a couple of hundred thousand characters, and
 * a row that opened onto all of it would be a scroll with no bottom. Twenty
 * thousand is several screens — enough to see what the thing *is*, which is the
 * question a reader has here — and the row says how much was cut rather than
 * ending mid-word and letting you assume that was all of it.
 */
export const PIECE_TEXT_LIMIT = 20_000;

function clip(text: string): { text: string; clipped?: number } {
	if (text.length <= PIECE_TEXT_LIMIT) return { text };
	return { text: text.slice(0, PIECE_TEXT_LIMIT), clipped: text.length - PIECE_TEXT_LIMIT };
}

interface Item {
	role?: string;
	type?: string;
	content?: unknown;
	name?: string;
	arguments?: unknown;
	output?: unknown;
	id?: string;
}

/**
 * One request body → the bands that make it up.
 *
 * Tool schemas come first because they are constant across a turn and are the
 * thing most often forgotten: eight tools with rich descriptions is a fixed tax
 * on every call, paid whether or not any of them is used.
 */
export function decompose(body: unknown, { text = false } = {}): Decomposition {
	const b = (body ?? {}) as { model?: string; input?: unknown; tools?: unknown };
	const parts: Part[] = [];

	let n = 0;
	/**
	 * `source` is a thunk, not a string.
	 *
	 * The light path — every request, on every call — must not pay to build a
	 * two-hundred-kilobyte string it will immediately discard. Passing the work
	 * rather than the result means the only decompositions that stringify
	 * anything are the ones somebody asked to read.
	 */
	const add = (part: Omit<Part, 'id' | 'share' | 'text' | 'clipped'>, source?: () => string) =>
		parts.push({
			...part,
			id: `p${n++}`,
			share: 0,
			...(text && source ? clip(source()) : {})
		});

	if (Array.isArray(b.tools)) {
		for (const tool of b.tools as { name?: string }[]) {
			add(
				{ kind: 'tool-schema', label: `${tool?.name ?? 'tool'} — schema`, chars: sizeOf(tool) },
				() => pretty(tool)
			);
		}
	}

	if (Array.isArray(b.input)) {
		const input = b.input as Item[];

		/*
		 * Which tool produced which result.
		 *
		 * A `function_call_output` carries only a `call_id`, so on its own every
		 * result is an anonymous blob labelled "tool result". Correlating it back
		 * to the `function_call` that has the same id is what turns the largest
		 * row in the panel from "tool result — 61%" into "fetch_paper — result —
		 * 61%", which is the difference between knowing the history is expensive
		 * and knowing *what* in it is expensive.
		 */
		const nameOf = new Map<string, string>();
		for (const item of input) {
			const callId = (item as { call_id?: string })?.call_id;
			if (item?.type === 'function_call' && callId && item.name) nameOf.set(callId, item.name);
		}

		let userN = 0;
		let systemN = 0;
		for (const raw of input) {
			const item = raw ?? {};

			// The system prompt arrives as a `developer` message on reasoning
			// models, and as `system` elsewhere. Both mean the same band.
			if (item.role === 'developer' || item.role === 'system') {
				/*
				 * There is more than one of these, which was a surprise worth
				 * naming. A fresh thread's first call carried two developer
				 * messages: the agent's instructions, and a second block that is
				 * the resource-scoped working memory being injected. Labelling both
				 * "system prompt" made the largest two rows in the panel
				 * indistinguishable from each other.
				 *
				 * The marker is the heading of the template in
				 * `src/lib/server/storage.ts`, so this is recognising our own text
				 * rather than guessing at Mastra's. If that template is renamed the
				 * row falls back to a number, which is wrong-but-honest rather than
				 * confidently mislabelled.
				 */
				const content = typeof item.content === 'string' ? item.content : '';
				const isMemory = content.includes('Reader profile');
				systemN++;
				add(
					{
						kind: 'system',
						label: isMemory
							? 'working memory'
							: systemN > 1
								? `system prompt ${systemN}`
								: 'system prompt',
						chars: textOf(item.content)
					},
					() => stringOf(item.content)
				);
				continue;
			}
			if (item.role === 'user') {
				add({ kind: 'user', label: `your turn ${++userN}`, chars: textOf(item.content) }, () =>
					stringOf(item.content)
				);
				continue;
			}
			if (item.role === 'assistant') {
				add({ kind: 'assistant', label: 'answer', chars: textOf(item.content) }, () =>
					stringOf(item.content)
				);
				continue;
			}

			const callId = (item as { call_id?: string }).call_id;

			switch (item.type) {
				case 'function_call':
					add(
						{
							kind: 'tool-call',
							label: `${item.name ?? 'tool'} — call`,
							chars: sizeOf(item.arguments)
						},
						() => pretty(item.arguments)
					);
					break;
				case 'function_call_output':
					add(
						{
							kind: 'tool-result',
							label: `${(callId && nameOf.get(callId)) ?? 'tool'} — result`,
							chars: sizeOf(item.output)
						},
						() => pretty(item.output)
					);
					break;
				case 'item_reference':
					// Fourteen-ish bytes standing in for a whole chain of thought.
					// Kept as a row precisely so its smallness is visible.
					add(
						{ kind: 'reasoning-ref', label: 'reasoning (by reference)', chars: sizeOf(item.id) },
						() =>
							`${item.id}\n\nThe model's reasoning stays on the provider's side. Only this handle is re-sent, so a long chain of thought is not re-billed the way the conversation is.`
					);
					break;
				default:
					add(
						{
							kind: 'other',
							label: item.type ?? item.role ?? 'unknown item',
							chars: sizeOf(item)
						},
						() => pretty(item)
					);
			}
		}
	}

	const chars = parts.reduce((sum, p) => sum + p.chars, 0);
	for (const part of parts) part.share = chars ? part.chars / chars : 0;

	return { model: b.model, parts, chars };
}

/**
 * Attribute the billed input tokens across the bands.
 *
 * **By size, not by measurement.** The provider bills one number for the whole
 * request; there is no per-row breakdown to be had, so each row gets its share
 * of the total in proportion to its characters. That is an approximation and
 * the UI says so — a JSON schema tokenises differently from English prose, so a
 * schema-heavy row is somewhat overstated and a prose-heavy row understated.
 *
 * It is still worth doing. The question anyone actually has is "which half of
 * this bill is the conversation and which half is tool schemas", and a
 * proportional split answers that correctly even when a row is off by a fifth.
 * The alternative — showing characters and leaving the reader to convert — is
 * precise about the wrong quantity.
 */
export function apportion(parts: Part[], inputTokens: number): Part[] {
	if (!inputTokens) return parts.map((p) => ({ ...p }));
	return parts.map((p) => ({ ...p, tokens: Math.round(p.share * inputTokens) }));
}

/** Bands merged by kind, for the summary bar. */
export function bands(parts: Part[]): { kind: PartKind; chars: number; share: number }[] {
	const totals = new Map<PartKind, number>();
	for (const part of parts) totals.set(part.kind, (totals.get(part.kind) ?? 0) + part.chars);

	const chars = [...totals.values()].reduce((a, b) => a + b, 0);
	// A fixed order, so the bar does not reshuffle between calls: constant costs
	// on the left, the conversation in the middle, this turn's work on the right.
	const ORDER: PartKind[] = [
		'system',
		'tool-schema',
		'user',
		'assistant',
		'tool-call',
		'tool-result',
		'reasoning-ref',
		'other'
	];

	return ORDER.filter((k) => totals.get(k)).map((kind) => ({
		kind,
		chars: totals.get(kind) as number,
		share: chars ? (totals.get(kind) as number) / chars : 0
	}));
}
