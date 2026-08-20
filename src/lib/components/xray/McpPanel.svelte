<script lang="ts">
	import { onMount } from 'svelte';
	import { ICON } from '$lib/icons';
	import PanelFrame from '$lib/components/ui/PanelFrame.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	/**
	 * Tools that do not live in this repository.
	 *
	 * Every other tool the agent has was written here — `search_papers`,
	 * `fetch_paper`, `cite`, `bibliography` — and you can read them. The Model
	 * Context Protocol is the other kind: a server somewhere else says what it
	 * can do, and the agent picks those capabilities up at runtime. Nothing in
	 * this codebase knows their names until it asks.
	 *
	 * That difference is the whole point of the panel, so it is the thing the
	 * design carries. **A dashed edge means the thing came from outside.** Solid
	 * rules elsewhere in the X-ray mean "written here"; the dashes are not a
	 * texture, they are the claim. The ochre is the legend's tool colour, used
	 * for tools, unchanged — an MCP tool is still a tool.
	 *
	 * The second half of that claim lives in the id. Every outside tool is
	 * exposed as `mcp_<server>__<tool>`, so when one runs, the chip in the
	 * conversation and the row in the event timeline both say where it came
	 * from without this panel being open at all.
	 *
	 * Fetched on mount and on request rather than tied to the run: which servers
	 * exist is a property of the deployment, not of a conversation. A connection
	 * can still drop, which is why `recheck` exists.
	 */

	/**
	 * The wire shape, declared here rather than imported.
	 *
	 * `$lib/server/mcp` is server-only — SvelteKit refuses to let it into a
	 * component's module graph, and a type-only import is not worth arguing with
	 * the illegal-import check about. If the endpoint changes, this changes.
	 */
	interface WireTool {
		name: string;
		id: string;
		description?: string;
	}
	interface WireServer {
		name: string;
		url: string;
		transport: 'http' | 'sse';
		software?: string;
		tools: WireTool[];
		error?: string;
	}

	const EXAMPLE = '[{"name":"docs","url":"https://example.com/mcp","transport":"http"}]';

	/** Must match MCP_TOOL_PREFIX in `$lib/server/mcp`, which mints these ids. */
	const PREFIX = 'mcp_';

	let servers = $state<WireServer[]>([]);
	let configured = $state(false);
	let configError = $state<string | null>(null);
	let fetchError = $state('');
	let loaded = $state(false);
	let loading = $state(false);

	async function load() {
		loading = true;
		try {
			const response = await fetch('/api/mcp');
			const data = (await response.json()) as {
				configured: boolean;
				error: string | null;
				servers: WireServer[];
			};
			configured = data.configured;
			configError = data.error;
			servers = data.servers ?? [];
			fetchError = '';
		} catch (cause) {
			fetchError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
			loaded = true;
		}
	}

	// `onMount`, not `$effect`: this writes state it would otherwise depend on,
	// which is the shape that produced `effect_update_depth_exceeded` here once.
	onMount(load);

	const live = $derived(servers.filter((s) => !s.error));
	const toolCount = $derived(live.reduce((n, s) => n + s.tools.length, 0));

	const tally = $derived(
		loaded && configured
			? `${live.length}/${servers.length} connected · ${toolCount} tool${toolCount === 1 ? '' : 's'}`
			: undefined
	);

	/** The host alone. A full URL in a 0.625rem column is noise with a scrollbar. */
	function host(url: string): string {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	}

	/** Hosted in another frame's tab group; that frame draws the header. */
	let { bare = false }: { bare?: boolean } = $props();
</script>

<PanelFrame {bare} label="mcp" icon={ICON.mcp} tone="tool" readout={tally}>
	{#snippet actions()}
		{#if loaded}
			<button class="co-eyebrow recheck" onclick={load} disabled={loading}>
				{loading ? '…' : 'recheck'}
			</button>
		{/if}
	{/snippet}

	{#if !loaded}
		<p class="quiet pad">…</p>
	{:else if fetchError}
		<p class="err pad">{fetchError}</p>
	{:else if !configured}
		<!--
			The one empty state here that keeps something under its title, because
			what is under it is a *sample of the config*, not a sentence about MCP.
			It tells a reader what to type; the sentence it replaced only told them
			what to feel. Shown rather than described, and shorter either way.
		-->
		<EmptyState icon={ICON.mcp} tone="tool" title="No servers connected" />
		<div class="hint">
			{#if configError}
				<p class="err">{configError}</p>
			{:else}
				<p class="quiet"><code>MCP_SERVERS</code>, a JSON array:</p>
				<pre class="example">{EXAMPLE}</pre>
			{/if}
		</div>
	{:else}
		<div class="content">
			{#if configError}
				<p class="err">{configError}</p>
			{/if}

			<ul class="servers">
				{#each servers as server (server.name)}
					<li class="server" class:down={Boolean(server.error)}>
						<div class="ident">
							<span class="name">{server.name}</span>
							<span class="co-eyebrow transport">{server.transport}</span>
							<span class="co-num where">{host(server.url)}</span>
						</div>

						{#if server.error}
							<p class="err">{server.error}</p>
						{:else}
							<p class="co-num software">
								{server.software ?? 'connected'} · {server.tools.length} tool{server.tools
									.length === 1
									? ''
									: 's'}
							</p>

							{#if server.tools.length}
								<ul class="tools">
									{#each server.tools as tool (tool.id)}
										<li class="tool">
											<p class="id co-num">
												<span class="prefix">{PREFIX}</span>{tool.id.startsWith(PREFIX)
													? tool.id.slice(PREFIX.length)
													: tool.id}
											</p>
											{#if tool.description}
												<p class="what">{tool.description}</p>
											{/if}
										</li>
									{/each}
								</ul>
							{:else}
								<p class="quiet">Connected, and offering nothing.</p>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>

			{#if toolCount}
				<!-- A readout, not a caption: the prefix is already visible on every id
				     above, so the line only has to say where else it shows up. -->
				<p class="quiet foot">
					Prefixed <code>{PREFIX}</code> everywhere, chat included.
				</p>
			{/if}
		</div>
	{/if}
</PanelFrame>

<style>
	.recheck {
		border: 0;
		background: transparent;
		padding: 0 0.2rem;
		cursor: pointer;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
		transition: color 150ms ease;
	}
	.recheck:hover:not(:disabled) {
		color: var(--co-accent);
	}
	.recheck:disabled {
		cursor: default;
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 0;
		padding: 0.6rem 0.7rem 0.75rem;
	}

	/* Follows the empty state rather than living inside it: `EmptyState` takes a
	   sentence, and the thing a reader needs next is a line of JSON they can
	   copy. Centred to sit under the icon it belongs to. */
	.hint {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0 1.75rem 1.5rem;
		text-align: center;
	}

	.pad {
		padding: 0.6rem 0.7rem 0.75rem;
	}

	.quiet {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		text-wrap: pretty;
	}
	.foot {
		font-size: 0.6875rem;
	}

	.err {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		line-height: 1.5;
		color: var(--co-error);
		text-wrap: pretty;
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: color-mix(in oklab, var(--foreground) 70%, transparent);
	}

	.example {
		margin: 0;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		line-height: 1.6;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
	}

	.servers,
	.tools {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.servers {
		overflow-y: auto;
		min-height: 0;
	}

	.server {
		padding: 0.4rem 0;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
	}
	.server:last-child {
		border-bottom: 0;
	}

	.ident {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}

	.name {
		font-size: 0.78rem;
		color: var(--foreground);
	}
	.server.down .name {
		color: color-mix(in oklab, var(--foreground) 60%, transparent);
	}

	/* Which protocol revision this server speaks is a real fact about it: `sse`
	   is the deprecated transport, and knowing that is the difference between
	   "old server" and "broken server" when one starts misbehaving. */
	.transport {
		font-size: 0.5rem;
		padding: 0 0.25rem;
		border: 1px solid color-mix(in oklab, var(--co-tool) 30%, transparent);
		border-radius: 2px;
		color: color-mix(in oklab, var(--co-tool) 65%, var(--muted-foreground));
	}

	.where {
		margin-left: auto;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
	}

	.software {
		margin: 0.15rem 0 0;
		font-size: 0.625rem;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}

	.tools {
		margin-top: 0.35rem;
		/*
			The dashed edge is the panel's one argument, made in CSS: everything
			else in the X-ray is ruled with a solid hairline, and solid means
			"written in this repository". These tools were not. The gap in the line
			is the gap in the codebase.
		*/
		border-left: 1px dashed color-mix(in oklab, var(--co-tool) 45%, transparent);
		padding-left: 0.5rem;
	}

	.tool {
		padding: 0.2rem 0;
	}

	.id {
		margin: 0;
		font-size: 0.625rem;
		line-height: 1.4;
		color: var(--co-tool);
		overflow-wrap: anywhere;
	}
	/* The namespace recedes; the tool's own name is what you read. */
	.prefix {
		color: color-mix(in oklab, var(--co-tool) 45%, transparent);
	}

	.what {
		margin: 0.05rem 0 0;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
		text-wrap: pretty;
	}
</style>
