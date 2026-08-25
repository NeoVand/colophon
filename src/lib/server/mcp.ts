import { env } from '$env/dynamic/private';
import { createTool } from '@mastra/core/tools';
import type { JSONSchema7 } from 'json-schema';

/**
 * Tools from outside this codebase.
 *
 * Colophon's four research tools live in `src/lib/agent/tools.ts` — they were
 * written here, they are reviewed here, and they change when this repository
 * changes. The Model Context Protocol is the other kind: a server somewhere
 * else says what it can do, and the agent picks those capabilities up at
 * runtime without a deploy. That is the whole idea, and it is why this module
 * exists at all.
 *
 * ── Why this is hand-rolled, and what it cost ───────────────────────────────
 * The obvious implementation is `@mastra/mcp`, which does exist (1.17.0) and is
 * the maintained client. It is **not installed**, and installing it pulls four
 * `@modelcontextprotocol/*` 2.0.0 packages plus `exit-hook` — a Node process
 * assumption inside a Vercel function, for a client whose entire job here is
 * two JSON-RPC calls. `@mastra/core` ships `dist/mcp/`, but that is
 * `MCPServerBase`: the side that *exposes* tools over MCP, not the side that
 * consumes them. There is no client in what is installed.
 *
 * So: raw `fetch`, same reasoning as `mail.ts` — the protocol is small, and a
 * `fetchImpl` seam is what makes it testable without standing up a server.
 * If `@mastra/mcp` is ever added, `toolsForAgent()` is the seam to swap; the
 * rest of the app only ever sees Mastra tools coming out of it.
 *
 * ── Degrading honestly ──────────────────────────────────────────────────────
 * With no `MCP_SERVERS`, `isMcpConfigured()` is false and everything else
 * returns empty. Nothing throws, because "no MCP server configured" is the
 * normal state of this app and not an error — but a *malformed* `MCP_SERVERS`
 * is an error, and `mcpConfigError()` says so rather than letting it look like
 * an absence. Those are different facts and the panel shows them differently.
 */

/** The revision of MCP this client speaks. Servers may negotiate down. */
const PROTOCOL_VERSION = '2025-06-18';

const CLIENT_INFO = { name: 'colophon', version: '0.0.1' };

/** Long enough for a cold serverless MCP host, short enough that a dead URL does not hold the X-ray open. */
const CONNECT_TIMEOUT_MS = 10_000;

/** A tool call may legitimately do real work — a search, a fetch, a build. */
const CALL_TIMEOUT_MS = 30_000;

/**
 * The mark of an outside tool, carried in the tool's own id.
 *
 * Not decoration. The id is what appears in a `ToolChip` in the conversation,
 * in the event timeline and in the provider's function-call log, so prefixing
 * here is what makes "this came from somewhere else" visible everywhere at
 * once — instead of only in the panel that happens to be about MCP.
 */
export const MCP_TOOL_PREFIX = 'mcp_';

/** OpenAI rejects a function name longer than this. */
const MAX_TOOL_ID = 64;

/** A server that paginates forever must not hold the panel open forever. */
const MAX_TOOL_PAGES = 10;

export class McpFailed extends Error {
	constructor(
		readonly server: string,
		detail: string
	) {
		super(`MCP server "${server}" ${detail}`);
		this.name = 'McpFailed';
	}
}

/* ── what the environment says ────────────────────────────────────────────── */

export type McpTransport = 'http' | 'sse';

export interface McpServerSpec {
	name: string;
	url: string;
	/** `http` is Streamable HTTP; `sse` is the deprecated HTTP+SSE transport. */
	transport: McpTransport;
}

export interface McpConfig {
	servers: McpServerSpec[];
	/** Why part or all of MCP_SERVERS was ignored, in words a reader can act on. */
	error?: string;
}

export interface McpOptions {
	/**
	 * The transport seam, for tests.
	 *
	 * Same reasoning as `mail.ts`: there is no SDK here, so there is no SDK to
	 * stub — the only thing to substitute is `fetch` itself.
	 */
	fetchImpl?: typeof fetch;
	connectTimeoutMs?: number;
	callTimeoutMs?: number;
}

type Resolved = Required<McpOptions>;

function withDefaults(options: McpOptions): Resolved {
	return {
		fetchImpl: options.fetchImpl ?? fetch,
		connectTimeoutMs: options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
		callTimeoutMs: options.callTimeoutMs ?? CALL_TIMEOUT_MS
	};
}

/**
 * Read and validate `MCP_SERVERS`.
 *
 * Deliberately not memoised. `$env/dynamic/private` is dynamic by definition,
 * the parse is a few microseconds, and a cached config is the kind of thing
 * that makes a test pass for the wrong reason.
 */
export function readMcpConfig(): McpConfig {
	const raw = env.MCP_SERVERS?.trim();
	if (!raw) return { servers: [] };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		return { servers: [], error: `MCP_SERVERS is not valid JSON: ${message(cause)}` };
	}

	if (!Array.isArray(parsed)) {
		return {
			servers: [],
			error: 'MCP_SERVERS must be a JSON array of {name, url, transport} objects.'
		};
	}

	const servers: McpServerSpec[] = [];
	const problems: string[] = [];
	const seen = new Set<string>();

	parsed.forEach((entry, index) => {
		const where = `entry ${index + 1}`;

		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			problems.push(`${where} is not an object`);
			return;
		}

		const { name, url, transport } = entry as Record<string, unknown>;

		if (typeof name !== 'string' || !name.trim()) {
			problems.push(`${where} has no name`);
			return;
		}
		const id = name.trim();

		if (typeof url !== 'string' || !url.trim()) {
			problems.push(`${where} ("${id}") has no url`);
			return;
		}
		try {
			new URL(url.trim());
		} catch {
			problems.push(`${where} ("${id}") has a url that is not a URL: ${url}`);
			return;
		}

		if (transport !== undefined && transport !== 'http' && transport !== 'sse') {
			problems.push(
				`${where} ("${id}") has transport ${JSON.stringify(transport)}; expected "http" or "sse"`
			);
			return;
		}

		// Dropped rather than renamed, because the name is the key everything
		// downstream is grouped and de-duplicated by — two servers answering to
		// one name would produce colliding tool ids and a duplicate {#each} key,
		// and a duplicate key aborts the render rather than merely misdrawing it.
		if (seen.has(id)) {
			problems.push(`${where} repeats the name "${id}"`);
			return;
		}
		seen.add(id);

		servers.push({ name: id, url: url.trim(), transport: transport ?? 'http' });
	});

	return { servers, error: problems.length ? problems.join('; ') : undefined };
}

export function isMcpConfigured(): boolean {
	return readMcpConfig().servers.length > 0;
}

/** What was wrong with `MCP_SERVERS`, if anything was. */
export function mcpConfigError(): string | undefined {
	return readMcpConfig().error;
}

/** True for a tool id minted by this module — the test the UI uses to tell outside tools from built-ins. */
export function isMcpTool(id: string): boolean {
	return id.startsWith(MCP_TOOL_PREFIX);
}

/* ── the JSON-RPC layer ───────────────────────────────────────────────────── */

interface JsonRpcReply {
	id?: number | string | null;
	result?: unknown;
	error?: { code?: number; message?: string };
}

interface Connection {
	spec: McpServerSpec;
	/** What the server called itself during the handshake, if it said. */
	software?: string;
	request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
	close(): void;
}

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** Pick our own reply out of a payload that may be a single object or a batch. */
function matchReply(payload: unknown, id: number): JsonRpcReply | undefined {
	const entries = Array.isArray(payload) ? payload : [payload];
	return entries.find(
		(entry): entry is JsonRpcReply =>
			typeof entry === 'object' && entry !== null && (entry as JsonRpcReply).id === id
	);
}

function unwrap(server: string, reply: JsonRpcReply): unknown {
	if (reply.error) {
		const code = reply.error.code === undefined ? '' : ` (code ${reply.error.code})`;
		throw new McpFailed(server, `returned an error: ${reply.error.message ?? 'no message'}${code}`);
	}
	return reply.result;
}

/**
 * Server-sent events, as frames.
 *
 * Written out rather than pulled in because both transports need it and neither
 * needs more than this: MCP uses `event:` and `data:` and nothing else, and a
 * dependency for thirty lines of line-splitting is a dependency to keep
 * upgrading forever.
 */
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<{
	event: string;
	data: string;
}> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;

			// Normalised on the buffer rather than the chunk: a frame separator can
			// straddle a chunk boundary, arriving as "\r" at the end of one read and
			// "\n\n" at the start of the next.
			buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');

			for (;;) {
				const split = buffer.indexOf('\n\n');
				if (split === -1) break;
				const frame = parseFrame(buffer.slice(0, split));
				buffer = buffer.slice(split + 2);
				if (frame) yield frame;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function parseFrame(raw: string): { event: string; data: string } | undefined {
	let event = 'message';
	const data: string[] = [];

	for (const line of raw.split('\n')) {
		if (!line || line.startsWith(':')) continue;
		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'event') event = value;
		else if (field === 'data') data.push(value);
	}

	return data.length ? { event, data: data.join('\n') } : undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(onTimeout()), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(cause) => {
				clearTimeout(timer);
				reject(cause);
			}
		);
	});
}

/* ── Streamable HTTP ──────────────────────────────────────────────────────── */

/**
 * The current transport: every message is a POST, and the reply comes back
 * either as JSON or as a one-frame event stream. Both are legal for the same
 * request, which is why `Accept` names both and the reader below handles both.
 */
async function openHttp(spec: McpServerSpec, opts: Resolved): Promise<Connection> {
	let sessionId = '';
	let negotiated = PROTOCOL_VERSION;
	let handshaken = false;
	let nextId = 0;

	const headers = (): Record<string, string> => {
		const h: Record<string, string> = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream'
		};
		if (sessionId) h['mcp-session-id'] = sessionId;
		// Only after `initialize`: sending a version before one is negotiated is
		// what the handshake is for.
		if (handshaken) h['mcp-protocol-version'] = negotiated;
		return h;
	};

	const post = async (body: object, timeoutMs: number, expect?: number): Promise<unknown> => {
		let response: Response;
		try {
			response = await opts.fetchImpl(spec.url, {
				method: 'POST',
				headers: headers(),
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (cause) {
			throw new McpFailed(spec.name, `could not be reached at ${spec.url}: ${message(cause)}`);
		}

		const issued = response.headers.get('mcp-session-id');
		if (issued) sessionId = issued;

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new McpFailed(
				spec.name,
				`answered HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`
			);
		}

		if (expect === undefined) {
			// A notification has no reply, but the body still has to be drained —
			// an abandoned body keeps the connection open in Node's fetch until GC.
			await response.arrayBuffer().catch(() => undefined);
			return undefined;
		}

		return unwrap(spec.name, await replyFrom(spec, response, expect));
	};

	const initId = ++nextId;
	const hello = (await post(
		{
			jsonrpc: '2.0',
			id: initId,
			method: 'initialize',
			params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }
		},
		opts.connectTimeoutMs,
		initId
	)) as { protocolVersion?: string; serverInfo?: { name?: string; version?: string } } | undefined;

	if (typeof hello?.protocolVersion === 'string') negotiated = hello.protocolVersion;
	handshaken = true;

	await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, opts.connectTimeoutMs);

	return {
		spec,
		software: softwareName(hello?.serverInfo),
		request(method, params, timeoutMs = opts.callTimeoutMs) {
			const id = ++nextId;
			return post(
				{ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) },
				timeoutMs,
				id
			) as Promise<unknown>;
		},
		close() {
			if (!sessionId) return;
			// Best effort. A session the server has already forgotten is not a
			// failure worth surfacing to anyone.
			void opts
				.fetchImpl(spec.url, { method: 'DELETE', headers: headers() })
				.then((r) => r.arrayBuffer())
				.catch(() => undefined);
		}
	};
}

async function replyFrom(
	spec: McpServerSpec,
	response: Response,
	id: number
): Promise<JsonRpcReply> {
	const type = response.headers.get('content-type') ?? '';

	if (!type.includes('text/event-stream')) {
		const payload = safeJson(await response.text().catch(() => ''));
		const match = payload === undefined ? undefined : matchReply(payload, id);
		if (!match) throw new McpFailed(spec.name, `answered with no reply to request ${id}`);
		return match;
	}

	if (!response.body) throw new McpFailed(spec.name, 'opened an event stream with no body');

	for await (const frame of sseFrames(response.body)) {
		const payload = safeJson(frame.data);
		const match = payload === undefined ? undefined : matchReply(payload, id);
		if (match) return match;
	}

	throw new McpFailed(spec.name, `closed its stream before answering request ${id}`);
}

/* ── the deprecated HTTP+SSE transport ────────────────────────────────────── */

/**
 * The older shape, still what a good deal of deployed servers speak.
 *
 * Its oddity: replies do not come back from the request that asked for them.
 * A long-lived GET stream is opened first, the server names a POST endpoint on
 * it, and every reply to every subsequent POST arrives back on that same
 * stream. So this needs a reader loop and a table of who is waiting for which
 * id — machinery the newer transport made unnecessary.
 */
async function openSse(spec: McpServerSpec, opts: Resolved): Promise<Connection> {
	const abort = new AbortController();

	let stream: Response;
	try {
		// Raced rather than given `AbortSignal.timeout`: this stream is meant to
		// stay open for the life of the connection, so a signal that fires after
		// ten seconds would kill it mid-conversation. The bound belongs on the
		// handshake alone.
		stream = await withTimeout(
			opts.fetchImpl(spec.url, {
				method: 'GET',
				headers: { accept: 'text/event-stream' },
				signal: abort.signal
			}),
			opts.connectTimeoutMs,
			() => {
				abort.abort();
				return new McpFailed(
					spec.name,
					`did not open an event stream within ${opts.connectTimeoutMs}ms`
				);
			}
		);
	} catch (cause) {
		if (cause instanceof McpFailed) throw cause;
		throw new McpFailed(spec.name, `could not be reached at ${spec.url}: ${message(cause)}`);
	}

	if (!stream.ok || !stream.body) {
		throw new McpFailed(spec.name, `answered HTTP ${stream.status} opening its event stream`);
	}

	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (cause: unknown) => void }
	>();
	let announceEndpoint!: (url: string) => void;
	let failEndpoint!: (cause: unknown) => void;
	const endpointReady = new Promise<string>((res, rej) => {
		announceEndpoint = res;
		failEndpoint = rej;
	});
	let dead: McpFailed | undefined;

	const die = (why: McpFailed) => {
		dead = why;
		// A no-op once the endpoint has arrived, which is the common case.
		failEndpoint(why);
		for (const waiter of pending.values()) waiter.reject(why);
		pending.clear();
	};

	void (async () => {
		try {
			for await (const frame of sseFrames(stream.body!)) {
				if (frame.event === 'endpoint') {
					announceEndpoint(new URL(frame.data, spec.url).toString());
					continue;
				}
				const payload = safeJson(frame.data);
				if (payload === undefined) continue;
				for (const entry of Array.isArray(payload) ? payload : [payload]) {
					const replyId = (entry as JsonRpcReply)?.id;
					if (typeof replyId !== 'number') continue; // a notification, not our reply
					const waiter = pending.get(replyId);
					if (!waiter) continue;
					pending.delete(replyId);
					waiter.resolve(entry);
				}
			}
			die(new McpFailed(spec.name, 'closed its event stream'));
		} catch (cause) {
			die(new McpFailed(spec.name, `event stream failed: ${message(cause)}`));
		}
	})();

	const endpoint = await withTimeout(
		endpointReady,
		opts.connectTimeoutMs,
		() =>
			new McpFailed(
				spec.name,
				`sent no "endpoint" event within ${opts.connectTimeoutMs}ms; it may not speak the HTTP+SSE transport`
			)
	);

	let nextId = 0;

	const send = async (
		method: string,
		params: Record<string, unknown> | undefined,
		timeoutMs: number,
		notify = false
	): Promise<unknown> => {
		if (dead) throw dead;

		const id = notify ? undefined : ++nextId;
		// Registered before the POST, because a fast server can push the reply
		// onto the stream before its own 202 comes back.
		const waiting =
			id === undefined
				? undefined
				: new Promise<unknown>((res, rej) => pending.set(id, { resolve: res, reject: rej }));

		let posted: Response;
		try {
			posted = await opts.fetchImpl(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					...(id === undefined ? {} : { id }),
					method,
					...(params ? { params } : {})
				}),
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (cause) {
			if (id !== undefined) pending.delete(id);
			throw new McpFailed(spec.name, `could not be sent ${method}: ${message(cause)}`);
		}

		if (!posted.ok) {
			if (id !== undefined) pending.delete(id);
			throw new McpFailed(spec.name, `answered HTTP ${posted.status} to ${method}`);
		}
		await posted.arrayBuffer().catch(() => undefined);

		if (!waiting || id === undefined) return undefined;

		const reply = await withTimeout(waiting, timeoutMs, () => {
			pending.delete(id);
			return new McpFailed(spec.name, `did not answer ${method} within ${timeoutMs}ms`);
		});
		return unwrap(spec.name, reply as JsonRpcReply);
	};

	const hello = (await send(
		'initialize',
		{ protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
		opts.connectTimeoutMs
	)) as { serverInfo?: { name?: string; version?: string } } | undefined;

	await send('notifications/initialized', undefined, opts.connectTimeoutMs, true);

	return {
		spec,
		software: softwareName(hello?.serverInfo),
		request: (method, params, timeoutMs = opts.callTimeoutMs) => send(method, params, timeoutMs),
		close: () => abort.abort()
	};
}

function softwareName(info?: { name?: string; version?: string }): string | undefined {
	if (!info?.name) return undefined;
	return info.version ? `${info.name} ${info.version}` : info.name;
}

/* ── connections, opened once ─────────────────────────────────────────────── */

/**
 * Live connections, keyed by transport and URL.
 *
 * Module scope, so a warm serverless instance keeps its handshake between
 * requests — the alternative is re-initialising every MCP server on every
 * render of the panel, which is three round trips to show a list that has not
 * changed.
 */
const connections = new Map<string, Promise<Connection>>();

function connect(spec: McpServerSpec, opts: Resolved): Promise<Connection> {
	const key = `${spec.transport} ${spec.url}`;
	let open = connections.get(key);

	if (!open) {
		open = spec.transport === 'sse' ? openSse(spec, opts) : openHttp(spec, opts);
		// A failed handshake must not be remembered. The server may simply have
		// been redeploying, and a cached rejection would keep the panel empty
		// until this process was itself replaced. The caller holds the original
		// promise and handles its rejection; this branch exists only to evict.
		open.catch(() => connections.delete(key));
		connections.set(key, open);
	}

	return open;
}

/**
 * Forget every connection.
 *
 * For tests, which change `MCP_SERVERS` between cases and would otherwise be
 * talking to the previous case's mock — and the honest thing to call if
 * configuration is ever reloaded while the process lives.
 */
export function resetMcp(): void {
	for (const open of connections.values()) {
		open.then(
			(connection) => connection.close(),
			() => undefined
		);
	}
	connections.clear();
}

/* ── what a server offers ─────────────────────────────────────────────────── */

export interface McpToolInfo {
	/** The tool's name on its own server. */
	name: string;
	/** The id Colophon exposes it under — namespaced, so it cannot shadow a built-in. */
	id: string;
	description?: string;
	/** JSON Schema, exactly as the server gave it. */
	inputSchema?: JSONSchema7;
}

export interface McpServerReport {
	name: string;
	url: string;
	transport: McpTransport;
	/** What the server called itself in the handshake. */
	software?: string;
	tools: McpToolInfo[];
	/** Set when this server could not be reached, or refused the handshake. */
	error?: string;
}

function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

/** The id one MCP tool is exposed under. Deterministic, so the panel and the agent agree. */
export function mcpToolId(server: string, tool: string): string {
	return `${MCP_TOOL_PREFIX}${slug(server)}__${slug(tool)}`.slice(0, MAX_TOOL_ID);
}

function parseToolList(spec: McpServerSpec, result: unknown): McpToolInfo[] {
	const listed = (result as { tools?: unknown })?.tools;
	if (!Array.isArray(listed)) return [];

	const seen = new Set<string>();
	const tools: McpToolInfo[] = [];

	for (const entry of listed) {
		const raw = entry as { name?: unknown; description?: unknown; inputSchema?: unknown };
		if (typeof raw?.name !== 'string' || !raw.name) continue;
		// Names are unique per server by spec, but this list is what keys an
		// {#each} in the panel and a duplicate key aborts the render.
		if (seen.has(raw.name)) continue;
		seen.add(raw.name);

		tools.push({
			name: raw.name,
			id: mcpToolId(spec.name, raw.name),
			description: typeof raw.description === 'string' ? raw.description : undefined,
			inputSchema:
				typeof raw.inputSchema === 'object' && raw.inputSchema !== null
					? (raw.inputSchema as JSONSchema7)
					: undefined
		});
	}

	return tools;
}

/**
 * Resolve any id that two tools ended up sharing.
 *
 * Slugging is lossy and the 64-character cap is lossier, so two different tools
 * can in principle map onto one id — and a silent collision means one tool
 * quietly answering for another. A suffix is ugly; a shadow is a bug.
 */
function disambiguate(reports: McpServerReport[]): void {
	const taken = new Set<string>();
	for (const report of reports) {
		for (const tool of report.tools) {
			if (!taken.has(tool.id)) {
				taken.add(tool.id);
				continue;
			}
			const stem = tool.id.slice(0, MAX_TOOL_ID - 3);
			let n = 2;
			while (taken.has(`${stem}_${n}`)) n++;
			tool.id = `${stem}_${n}`;
			taken.add(tool.id);
		}
	}
}

async function listServerTools(conn: Connection, opts: Resolved): Promise<McpToolInfo[]> {
	const tools: McpToolInfo[] = [];
	let cursor: string | undefined;

	for (let page = 0; page < MAX_TOOL_PAGES; page++) {
		const result = await conn.request(
			'tools/list',
			cursor ? { cursor } : undefined,
			opts.callTimeoutMs
		);
		tools.push(...parseToolList(conn.spec, result));

		const next = (result as { nextCursor?: unknown })?.nextCursor;
		if (typeof next !== 'string' || !next) break;
		cursor = next;
	}

	return tools;
}

/**
 * Every configured server, and what each one offers.
 *
 * Never throws and never omits: a server that cannot be reached comes back with
 * an `error` and no tools, because "this server is down" and "this server has
 * no tools" are different facts and the panel draws them differently. Silently
 * dropping the dead one would make a broken configuration look like a working
 * empty one.
 */
export async function listTools(options: McpOptions = {}): Promise<McpServerReport[]> {
	const opts = withDefaults(options);
	const { servers } = readMcpConfig();

	const reports = await Promise.all(
		servers.map(async (spec): Promise<McpServerReport> => {
			const base = { name: spec.name, url: spec.url, transport: spec.transport };
			try {
				const conn = await connect(spec, opts);
				return { ...base, software: conn.software, tools: await listServerTools(conn, opts) };
			} catch (cause) {
				return { ...base, tools: [], error: message(cause) };
			}
		})
	);

	disambiguate(reports);
	return reports;
}

/* ── calling one ──────────────────────────────────────────────────────────── */

function textOf(content: unknown[]): string {
	return content
		.filter(
			(block): block is { type: string; text: string } =>
				typeof block === 'object' &&
				block !== null &&
				(block as { type?: unknown }).type === 'text' &&
				typeof (block as { text?: unknown }).text === 'string'
		)
		.map((block) => block.text)
		.join('\n');
}

function unwrapToolResult(server: string, tool: string, result: unknown): unknown {
	const payload = (result ?? {}) as {
		content?: unknown;
		structuredContent?: unknown;
		isError?: unknown;
	};
	const blocks = Array.isArray(payload.content) ? payload.content : [];
	const text = textOf(blocks);

	// A tool-level error is not a transport error: the call succeeded and the
	// tool said no. Throwing is still right — it is what marks the chip failed
	// in the conversation instead of feeding the model an error as if it were
	// an answer.
	if (payload.isError) {
		throw new McpFailed(server, `tool "${tool}" failed: ${text || 'no detail given'}`);
	}

	if (payload.structuredContent !== undefined) return payload.structuredContent;

	// All-text is the common case, and a model reads a string better than a
	// wrapper around one. Anything else — images, resource links, embedded
	// resources — goes back whole rather than being flattened into a claim
	// about what came back that is not true.
	if (blocks.length && blocks.every((b) => (b as { type?: unknown })?.type === 'text')) return text;
	return blocks.length ? blocks : '';
}

/**
 * One MCP tool, as a Mastra tool.
 *
 * `createTool` takes a JSON Schema directly — `PublicSchema` in
 * `@mastra/schema-compat` is a union that includes `JSONSchema7` — which is
 * exactly the shape an MCP server hands over. No zod round-trip, and no
 * lossy JSON-Schema-to-zod conversion in the middle of a tool definition.
 */
function toMastraTool(spec: McpServerSpec, tool: McpToolInfo, opts: Resolved) {
	return createTool({
		id: tool.id,
		description: `${tool.description ?? tool.name} (from the "${spec.name}" MCP server, not built into Colophon)`,
		inputSchema: tool.inputSchema ?? ({ type: 'object', properties: {} } as JSONSchema7),
		execute: async (input: unknown) => {
			const conn = await connect(spec, opts);
			const result = await conn.request(
				'tools/call',
				{ name: tool.name, arguments: (input ?? {}) as Record<string, unknown> },
				opts.callTimeoutMs
			);
			return unwrapToolResult(spec.name, tool.name, result);
		}
	});
}

/**
 * Everything MCP can contribute to a run, ready to merge with the built-ins.
 *
 * Returns `{}` when nothing is configured, and skips any server that could not
 * be reached — an agent should lose the tools of a server that is down, not the
 * whole turn. `listTools()` is where the failure is *reported*; this is where
 * it is survived.
 */
export async function toolsForAgent(
	options: McpOptions = {}
): Promise<Record<string, ReturnType<typeof createTool>>> {
	const opts = withDefaults(options);
	const { servers } = readMcpConfig();
	if (!servers.length) return {};

	const byName = new Map(servers.map((spec) => [spec.name, spec]));
	const reports = await listTools(options);
	const tools: Record<string, ReturnType<typeof createTool>> = {};

	for (const report of reports) {
		const spec = byName.get(report.name);
		if (!spec || report.error) continue;
		for (const tool of report.tools) {
			// The cast isolates one inference mismatch: with a JSON Schema rather
			// than a zod type, `createTool` cannot infer the input shape, so the
			// returned Tool is generic in a way the record's value type is not.
			tools[tool.id] = toMastraTool(spec, tool, opts) as ReturnType<typeof createTool>;
		}
	}

	return tools;
}
