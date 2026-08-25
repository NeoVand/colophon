import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const {
	isMcpConfigured,
	mcpConfigError,
	readMcpConfig,
	listTools,
	toolsForAgent,
	mcpToolId,
	isMcpTool,
	resetMcp
} = await import('./mcp');

const URL_HTTP = 'https://tools.example.com/mcp';

beforeEach(() => {
	env.MCP_SERVERS = undefined;
	// Connections are cached at module scope for the life of a warm serverless
	// instance, which is right in production and poison in a test file: without
	// this, case two is still talking to case one's mocked server.
	resetMcp();
});

afterEach(() => resetMcp());

/* ── a server that speaks Streamable HTTP ─────────────────────────────────── */

const rpc = (payload: object) =>
	new Response(JSON.stringify({ jsonrpc: '2.0', ...payload }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});

const TOOLS = [
	{
		name: 'search_issues',
		description: 'Search issues in a repository.',
		inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
	},
	{ name: 'create_comment', description: 'Comment on an issue.' }
];

function httpServer(tools: unknown[] = TOOLS) {
	return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body ?? '{}')) as {
			id?: number;
			method?: string;
			params?: { name?: string; arguments?: unknown };
		};

		switch (body.method) {
			case 'initialize':
				return rpc({
					id: body.id,
					result: {
						protocolVersion: '2025-06-18',
						capabilities: { tools: {} },
						serverInfo: { name: 'example-mcp', version: '2.1.0' }
					}
				});
			case 'notifications/initialized':
				return new Response(null, { status: 202 });
			case 'tools/list':
				return rpc({ id: body.id, result: { tools } });
			case 'tools/call':
				return rpc({
					id: body.id,
					result: {
						content: [
							{
								type: 'text',
								text: `ran ${body.params?.name} with ${JSON.stringify(body.params?.arguments)}`
							}
						]
					}
				});
			default:
				return rpc({ id: body.id, error: { code: -32601, message: 'no such method' } });
		}
	});
}

const asFetch = (mock: ReturnType<typeof httpServer>) => mock as unknown as typeof fetch;

/* ── unconfigured ─────────────────────────────────────────────────────────── */

describe('when no MCP server is configured', () => {
	it('says so, rather than pretending or throwing', async () => {
		expect(isMcpConfigured()).toBe(false);
		expect(mcpConfigError()).toBeUndefined();
		await expect(listTools()).resolves.toEqual([]);
		await expect(toolsForAgent()).resolves.toEqual({});
	});

	it('reaches the network not at all', async () => {
		const fetchImpl = httpServer();
		await listTools({ fetchImpl: asFetch(fetchImpl) });
		await toolsForAgent({ fetchImpl: asFetch(fetchImpl) });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('treats an empty string the same as an unset variable', () => {
		env.MCP_SERVERS = '   ';
		expect(isMcpConfigured()).toBe(false);
		expect(mcpConfigError()).toBeUndefined();
	});
});

/* ── a broken MCP_SERVERS ─────────────────────────────────────────────────── */

describe('when MCP_SERVERS is malformed', () => {
	it('reports unparseable JSON instead of looking unconfigured', async () => {
		env.MCP_SERVERS = '[{name: "oops"';
		expect(isMcpConfigured()).toBe(false);
		expect(mcpConfigError()).toMatch(/not valid JSON/);
		await expect(listTools()).resolves.toEqual([]);
		await expect(toolsForAgent()).resolves.toEqual({});
	});

	it('rejects a JSON value that is not an array', () => {
		env.MCP_SERVERS = '{"name":"solo","url":"https://x.example/mcp"}';
		expect(isMcpConfigured()).toBe(false);
		expect(mcpConfigError()).toMatch(/must be a JSON array/);
	});

	it('names the entry that is wrong, and keeps the ones that are not', () => {
		env.MCP_SERVERS = JSON.stringify([
			{ name: 'good', url: URL_HTTP, transport: 'http' },
			{ name: 'no-url' },
			{ url: 'https://anon.example/mcp' },
			{ name: 'bad-url', url: 'not a url' },
			{ name: 'bad-transport', url: URL_HTTP, transport: 'stdio' }
		]);

		const config = readMcpConfig();
		expect(config.servers).toEqual([{ name: 'good', url: URL_HTTP, transport: 'http' }]);
		expect(config.error).toMatch(/entry 2 \("no-url"\) has no url/);
		expect(config.error).toMatch(/entry 3 has no name/);
		expect(config.error).toMatch(/entry 4 \("bad-url"\)/);
		expect(config.error).toMatch(/entry 5 \("bad-transport"\) has transport "stdio"/);
		// One good entry survives, so the app is still configured.
		expect(isMcpConfigured()).toBe(true);
	});

	/**
	 * Two servers under one name would mint colliding tool ids and, in the panel,
	 * a duplicate {#each} key — which throws and aborts the render rather than
	 * merely misdrawing. Dropping the repeat is the cheap half of that fix.
	 */
	it('drops a repeated server name rather than letting two share an identity', () => {
		env.MCP_SERVERS = JSON.stringify([
			{ name: 'docs', url: URL_HTTP },
			{ name: 'docs', url: 'https://other.example/mcp' }
		]);
		const config = readMcpConfig();
		expect(config.servers).toHaveLength(1);
		expect(config.error).toMatch(/repeats the name "docs"/);
	});

	it('defaults a missing transport to http rather than refusing the entry', () => {
		env.MCP_SERVERS = JSON.stringify([{ name: 'docs', url: URL_HTTP }]);
		expect(readMcpConfig().servers[0].transport).toBe('http');
	});
});

/* ── a server that will not connect ───────────────────────────────────────── */

describe('when a server cannot be reached', () => {
	beforeEach(() => {
		env.MCP_SERVERS = JSON.stringify([{ name: 'down', url: URL_HTTP, transport: 'http' }]);
	});

	it('reports the failure against that server instead of throwing', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});

		const [report] = await listTools({ fetchImpl: fetchImpl as unknown as typeof fetch });

		expect(report.name).toBe('down');
		expect(report.tools).toEqual([]);
		expect(report.error).toMatch(/could not be reached/);
	});

	it('keeps an unreachable server visible rather than silently omitting it', async () => {
		// "This server is down" and "this server has no tools" are different
		// facts; dropping the row would make a broken deployment look like a
		// working empty one.
		const fetchImpl = vi.fn(async () => new Response('nope', { status: 502 }));
		const reports = await listTools({ fetchImpl: fetchImpl as unknown as typeof fetch });

		expect(reports).toHaveLength(1);
		expect(reports[0].error).toMatch(/HTTP 502/);
	});

	it('gives the agent no tools from it, but does not fail the turn', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});
		await expect(
			toolsForAgent({ fetchImpl: fetchImpl as unknown as typeof fetch })
		).resolves.toEqual({});
	});

	it('does not remember the failure, so a restarted server comes back', async () => {
		const failing = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});
		await listTools({ fetchImpl: failing as unknown as typeof fetch });

		// Same process, same configuration — only the server has recovered. A
		// cached rejected handshake would keep the panel empty until redeploy.
		const healthy = httpServer();
		const [report] = await listTools({ fetchImpl: asFetch(healthy) });
		expect(report.error).toBeUndefined();
		expect(report.tools).toHaveLength(2);
	});

	it('lets a healthy server carry on when its neighbour is down', async () => {
		env.MCP_SERVERS = JSON.stringify([
			{ name: 'up', url: URL_HTTP },
			{ name: 'down', url: 'https://dead.example/mcp' }
		]);

		const healthy = httpServer();
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).startsWith('https://dead.example')) throw new TypeError('fetch failed');
			return healthy(input, init);
		});

		const reports = await listTools({ fetchImpl: fetchImpl as unknown as typeof fetch });
		expect(reports.map((r) => Boolean(r.error))).toEqual([false, true]);

		const tools = await toolsForAgent({ fetchImpl: fetchImpl as unknown as typeof fetch });
		expect(Object.keys(tools)).toEqual(['mcp_up__search_issues', 'mcp_up__create_comment']);
	});
});

/* ── a server that works ──────────────────────────────────────────────────── */

describe('a reachable server', () => {
	beforeEach(() => {
		env.MCP_SERVERS = JSON.stringify([{ name: 'GitHub', url: URL_HTTP, transport: 'http' }]);
	});

	it('handshakes once and lists what it offers', async () => {
		const fetchImpl = httpServer();
		const [report] = await listTools({ fetchImpl: asFetch(fetchImpl) });

		expect(report.software).toBe('example-mcp 2.1.0');
		expect(report.tools.map((t) => t.name)).toEqual(['search_issues', 'create_comment']);
		expect(report.tools[0].inputSchema).toMatchObject({ required: ['q'] });

		const methods = fetchImpl.mock.calls.map(
			([, init]) => JSON.parse(String(init?.body)).method as string
		);
		expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
	});

	it('namespaces every tool so an outside one can never shadow a built-in', async () => {
		const [report] = await listTools({ fetchImpl: asFetch(httpServer()) });
		expect(report.tools.map((t) => t.id)).toEqual([
			'mcp_github__search_issues',
			'mcp_github__create_comment'
		]);
		expect(report.tools.every((t) => isMcpTool(t.id))).toBe(true);
		expect(isMcpTool('search_papers')).toBe(false);
	});

	it('says in each description which server the tool came from', async () => {
		const tools = await toolsForAgent({ fetchImpl: asFetch(httpServer()) });
		expect(tools.mcp_github__search_issues.description).toMatch(
			/from the "GitHub" MCP server, not built into Colophon/
		);
	});

	it('calls the tool by its own name, not by the namespaced id', async () => {
		const fetchImpl = httpServer();
		const tools = await toolsForAgent({ fetchImpl: asFetch(fetchImpl) });

		const execute = tools.mcp_github__search_issues.execute as (input: unknown) => Promise<unknown>;
		const result = await execute({ q: 'flaky test' });

		// All-text content comes back as a string: a model reads that better than
		// a wrapper object around one text block.
		expect(result).toBe('ran search_issues with {"q":"flaky test"}');

		const sent = JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body));
		expect(sent.params).toEqual({ name: 'search_issues', arguments: { q: 'flaky test' } });
	});

	it('reuses the handshake instead of re-initialising on every read', async () => {
		const fetchImpl = httpServer();
		await listTools({ fetchImpl: asFetch(fetchImpl) });
		await listTools({ fetchImpl: asFetch(fetchImpl) });

		const initialises = fetchImpl.mock.calls.filter(
			([, init]) => JSON.parse(String(init?.body)).method === 'initialize'
		);
		expect(initialises).toHaveLength(1);
	});

	it('surfaces a tool that reports its own failure as a failure', async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (body.method === 'tools/call') {
				return rpc({
					id: body.id,
					result: { isError: true, content: [{ type: 'text', text: 'rate limited' }] }
				});
			}
			return httpServer()(input, init);
		});

		const tools = await toolsForAgent({ fetchImpl: fetchImpl as unknown as typeof fetch });
		const execute = tools.mcp_github__search_issues.execute as (input: unknown) => Promise<unknown>;

		await expect(execute({ q: 'x' })).rejects.toThrow(/rate limited/);
	});

	it('reads a reply that arrives as an event stream rather than as JSON', async () => {
		// Streamable HTTP lets a server answer either way for the same request.
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });

			const payload =
				body.method === 'initialize'
					? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'streamy' } }
					: { tools: TOOLS };

			return new Response(
				`event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: payload })}\r\n\r\n`,
				{ status: 200, headers: { 'content-type': 'text/event-stream' } }
			);
		});

		const [report] = await listTools({ fetchImpl: fetchImpl as unknown as typeof fetch });
		expect(report.software).toBe('streamy');
		expect(report.tools).toHaveLength(2);
	});

	it('ignores a tool entry with no name rather than minting a nameless id', async () => {
		const [report] = await listTools({
			fetchImpl: asFetch(httpServer([{ description: 'anonymous' }, TOOLS[0]]))
		});
		expect(report.tools.map((t) => t.name)).toEqual(['search_issues']);
	});
});

/* ── ids ──────────────────────────────────────────────────────────────────── */

describe('tool ids', () => {
	it('slug anything a server name can contain down to a legal function name', () => {
		expect(mcpToolId('My Docs!', 'read-file')).toBe('mcp_my_docs__read_file');
		expect(mcpToolId('a'.repeat(80), 'b')).toHaveLength(64);
	});
});

/* ── the deprecated HTTP+SSE transport ────────────────────────────────────── */

describe('the sse transport', () => {
	/**
	 * Its awkward shape, reproduced: the reply to a POST does not come back from
	 * that POST. It arrives on a separate stream that was opened first.
	 */
	function sseServer() {
		let push!: (frame: string) => void;
		let end!: () => void;

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const encode = new TextEncoder();
				push = (frame) => controller.enqueue(encode.encode(frame));
				end = () => controller.close();
				// Enqueued before anything reads: a real server names its POST
				// endpoint as the first thing on the stream.
				push('event: endpoint\ndata: /messages?session=abc\n\n');
			}
		});

		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (!init?.method || init.method === 'GET') {
				return new Response(stream, {
					status: 200,
					headers: { 'content-type': 'text/event-stream' }
				});
			}

			const body = JSON.parse(String(init.body ?? '{}')) as { id?: number; method?: string };
			if (body.id !== undefined) {
				const result =
					body.method === 'initialize'
						? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'legacy' } }
						: { tools: TOOLS };
				push(
					`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`
				);
			}
			return new Response(null, { status: 202 });
		});

		return { fetchImpl, url: () => String(fetchImpl.mock.calls[1]?.[0]), end };
	}

	it('takes the POST endpoint off the stream and reads replies back from it', async () => {
		env.MCP_SERVERS = JSON.stringify([
			{ name: 'legacy', url: 'https://old.example/sse', transport: 'sse' }
		]);

		const server = sseServer();
		try {
			const [report] = await listTools({ fetchImpl: server.fetchImpl as unknown as typeof fetch });

			expect(report.error).toBeUndefined();
			expect(report.software).toBe('legacy');
			expect(report.tools.map((t) => t.id)).toEqual([
				'mcp_legacy__search_issues',
				'mcp_legacy__create_comment'
			]);
			// The endpoint was relative; it must be resolved against the stream URL.
			expect(server.url()).toBe('https://old.example/messages?session=abc');
		} finally {
			server.end();
		}
	});
});
