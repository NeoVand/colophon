<script lang="ts">
	/**
	 * The browser gate.
	 *
	 * Colophon's Lab mode claims a real Mastra harness runs client-side, with no
	 * server and no key. That claim rests on a shim set and a `process` stub, both
	 * of which are easy to break by accident — a stray `resolve.alias`, a Mastra
	 * minor version reaching for a new builtin. This page is the standing check.
	 *
	 * It deliberately does NOT call a model. It proves the harder half: that the
	 * module graph initialises in a browser at all, and that the agent can
	 * introspect itself once constructed.
	 */
	import { onMount } from 'svelte';

	type Check = { name: string; ok: boolean; detail: string };

	let checks = $state<Check[]>([]);
	let running = $state(false);
	let finished = $state(false);

	async function probe() {
		running = true;
		finished = false;
		checks = [];

		const record = (name: string, ok: boolean, detail: string) => {
			checks.push({ name, ok, detail });
		};

		try {
			record(
				'process stub',
				typeof globalThis.process !== 'undefined',
				`platform=${globalThis.process?.platform ?? 'missing'}`
			);

			const { Agent } = await import('@mastra/core/agent');
			const { createTool } = await import('@mastra/core/tools');
			record('module graph initialises', true, '@mastra/core/agent imported without throwing');

			const { z } = await import('zod');
			const echo = createTool({
				id: 'echo',
				description: 'Echo a message back, to prove tool wiring.',
				inputSchema: z.object({ message: z.string() }),
				execute: async ({ context }) => ({ echoed: context.message })
			});

			// The model is constructed the long way on purpose. See CLAUDE.md: the
			// `model: 'openai/gpt-5'` string form exposes no fetch hook and would
			// silently disable the wire capture the whole X-ray depends on.
			const { createOpenAI } = await import('@ai-sdk/openai');
			const openai = createOpenAI({
				apiKey: 'not-used-this-page-makes-no-request',
				fetch: async () => {
					throw new Error('the probe must not reach the network');
				}
			});

			const agent = new Agent({
				id: 'probe',
				name: 'probe',
				instructions: 'You exist to prove the harness loads.',
				model: openai('gpt-4o-mini'),
				tools: { echo }
			});
			record('agent constructs', true, 'new Agent() returned');

			const tools = await agent.getToolsForExecution({});
			record('tools resolve', Object.keys(tools ?? {}).length === 1, Object.keys(tools ?? {}).join(', '));

			const instructions = await agent.getInstructions();
			record('instructions resolve', typeof instructions === 'string', String(instructions));

			const model = await agent.getModel();
			const modelId = (model as { modelId?: string })?.modelId ?? '(resolved object)';
			record('model resolves through the fetch seam', Boolean(model), modelId);

			// Web Crypto backs the sha256 shim; this is the value Mastra's content
			// addressing depends on being correct.
			const { createHash } = await import('$lib/shims/node-crypto');
			const digest = createHash('sha256').update('abc').digest('hex');
			record(
				'sha256 shim matches the NIST vector',
				digest === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
				String(digest).slice(0, 24) + '…'
			);
		} catch (error) {
			record('FAILED', false, error instanceof Error ? error.message : String(error));
		}

		running = false;
		finished = true;
	}

	// onMount, not $effect. The probe writes the same state the effect would
	// track — `checks.push` reads the array's length on the way in — so running
	// it inside an $effect re-triggers the effect and blows the update depth.
	// A one-shot that only makes sense in a browser is exactly what onMount is.
	onMount(probe);

	const passed = $derived(checks.filter((c) => c.ok).length);
	const allPassed = $derived(finished && checks.length > 0 && passed === checks.length);
</script>

<svelte:head><title>Harness probe · Colophon</title></svelte:head>

<main class="mx-auto max-w-2xl px-6 py-16 text-neutral-900 dark:text-neutral-100">
	<p class="font-mono text-xs uppercase tracking-widest text-neutral-500">Lab · M0 gate</p>
	<h1 class="mt-3 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">Does the harness run in a browser?</h1>
	<p class="mt-3 max-w-prose text-neutral-600 dark:text-neutral-400">
		A real Mastra agent, constructed in this tab. No server, no key, and no network — this page
		proves the module graph initialises and the agent can introspect itself.
	</p>

	<div class="mt-8 divide-y divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
		{#each checks as check (check.name)}
			<div class="flex items-baseline gap-3 py-3">
				<span class="font-mono text-sm {check.ok ? 'text-emerald-600' : 'text-red-600'}">
					{check.ok ? '✓' : '✗'}
				</span>
				<div class="min-w-0 flex-1">
					<div class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{check.name}</div>
					<div class="mt-0.5 truncate font-mono text-xs text-neutral-500">{check.detail}</div>
				</div>
			</div>
		{/each}
	</div>

	{#if running}
		<p class="mt-6 font-mono text-sm text-neutral-500">running…</p>
	{:else if finished}
		<p class="mt-6 font-mono text-sm {allPassed ? 'text-emerald-600' : 'text-red-600'}">
			{passed}/{checks.length} passed{allPassed ? ' — Lab mode is viable' : ' — see the failure above'}
		</p>
		<button
			class="mt-4 rounded border border-neutral-300 px-3 py-1.5 font-mono text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
			onclick={probe}
		>
			run again
		</button>
	{/if}
</main>
