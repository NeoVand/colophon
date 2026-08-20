<script lang="ts">
	import { run, respond } from '$lib/agent/stream-client';
	import { addUsage, type ColophonEvent, type Usage } from '$lib/agent/events';
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	interface Turn {
		role: 'you' | 'colophon';
		text: string;
		/** Set while the model is reasoning and this turn has no text yet. */
		thinking?: boolean;
		tools: { id: string; name: string; failed?: boolean; done: boolean; subagent?: string }[];
		usage?: Usage;
		error?: string;
		/**
		 * A tool call waiting on the reader.
		 *
		 * Held on the turn rather than in a modal: the decision belongs beside the
		 * work that prompted it, and a dialog that covers the conversation makes it
		 * harder to judge whether the brief is right.
		 */
		approval?: { runId: string; id: string; name: string; args: unknown; deciding?: boolean };
	}

	let turns = $state<Turn[]>([]);
	let draft = $state('');
	let busy = $state(false);
	let controller: AbortController | undefined;
	let scroller: HTMLDivElement | undefined = $state();

	/**
	 * The conversation this page is continuing.
	 *
	 * Kept in localStorage rather than component state so a reload rejoins the
	 * same conversation instead of silently starting a new one — the surprise of
	 * losing a thread to a refresh is worse than any amount of tidiness.
	 */
	let thread = $state('');

	onMount(() => {
		const existing = localStorage.getItem('colophon:thread');
		thread = existing ?? crypto.randomUUID();
		if (!existing) localStorage.setItem('colophon:thread', thread);
	});

	function newThread() {
		thread = crypto.randomUUID();
		localStorage.setItem('colophon:thread', thread);
		turns = [];
	}

	const ZERO: Usage = { input: 0, output: 0, total: 0, reasoning: 0, cached: 0 };

	/** Follow the stream only while the reader is already near the bottom. */
	async function follow() {
		if (!scroller) return;
		const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
		if (!atBottom) return;
		await tick();
		scroller.scrollTop = scroller.scrollHeight;
	}

	function apply(turn: Turn, event: ColophonEvent) {
		switch (event.k) {
			case 'text':
				turn.thinking = false;
				turn.text += event.text;
				break;
			case 'reasoning':
				// Only claim to be thinking before any text has arrived; afterwards
				// the visible answer is the better signal that work is happening.
				turn.thinking = event.state === 'start' && turn.text === '';
				break;
			case 'tool-call':
				turn.tools.push({
					id: event.id,
					// A delegation is shown by the subagent's name, not by the
					// `agent-paperReader` tool id — what happened is "a paper was
					// read in its own context window", not "a tool was called".
					name: event.subagent ?? event.name,
					subagent: event.subagent,
					done: false
				});
				break;
			case 'tool-result': {
				const tool = turn.tools.find((t) => t.id === event.id);
				if (tool) {
					tool.done = true;
					tool.failed = event.failed;
				}
				break;
			}
			case 'step':
				turn.usage = addUsage(turn.usage ?? ZERO, event.usage);
				break;
			case 'done':
				turn.thinking = false;
				// `done` reports the run total, which supersedes the per-step sum.
				if (event.usage.total) turn.usage = event.usage;
				break;
			case 'tripwire':
				turn.error = `Blocked by ${event.processor ?? 'a guardrail'}: ${event.reason}`;
				break;
			case 'approval':
				turn.thinking = false;
				turn.approval = {
					runId: event.runId,
					id: event.id,
					name: event.name,
					args: event.args
				};
				break;
			case 'error':
				turn.error = event.message;
				break;
		}
	}

	async function send() {
		const prompt = draft.trim();
		if (!prompt || busy) return;

		draft = '';
		busy = true;
		turns.push({ role: 'you', text: prompt, tools: [] });
		turns.push({ role: 'colophon', text: '', thinking: true, tools: [] });
		const turn = turns[turns.length - 1];
		await follow();

		controller = new AbortController();
		await run({
			prompt,
			thread,
			signal: controller.signal,
			onEvent: (event) => {
				apply(turn, event);
				follow();
			},
			onError: (message) => {
				turn.thinking = false;
				turn.error = message;
			}
		});

		busy = false;
		controller = undefined;
	}

	async function decide(turn: Turn, approve: boolean) {
		const pending = turn.approval;
		if (!pending || pending.deciding) return;
		pending.deciding = true;
		busy = true;

		await respond({
			runId: pending.runId,
			toolCallId: pending.id,
			approve,
			onEvent: (event) => {
				apply(turn, event);
				follow();
			},
			onError: (message) => {
				turn.error = message;
			}
		});

		turn.approval = undefined;
		busy = false;
	}

	/** The brief, as a readable string — what is actually being approved. */
	function briefOf(args: unknown): string {
		if (args && typeof args === 'object' && 'prompt' in args) {
			return String((args as { prompt: unknown }).prompt);
		}
		return JSON.stringify(args, null, 2);
	}

	function stop() {
		controller?.abort();
		busy = false;
	}

	function onKeydown(event: KeyboardEvent) {
		// Enter sends; Shift+Enter is a newline. Standard for a chat composer.
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send();
		}
	}
</script>

<svelte:head><title>Colophon</title></svelte:head>

<div
	class="flex h-dvh flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
>
	<header
		class="flex items-baseline gap-3 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800"
	>
		<span class="text-sm font-semibold tracking-tight">Colophon</span>
		<span class="font-mono text-[0.7rem] tracking-widest text-neutral-400 uppercase"
			>research companion</span
		>
		<button
			onclick={newThread}
			class="ml-auto font-mono text-[0.7rem] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
			>new thread</button
		>
		<a
			href={resolve('/lab/probe')}
			class="font-mono text-[0.7rem] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
			>lab</a
		>
	</header>

	<div bind:this={scroller} class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-2xl px-6 py-8">
			{#if turns.length === 0}
				<p class="max-w-prose text-neutral-500">
					Ask something. Nothing is stored yet — this is the streaming seam, not the finished study.
				</p>
			{/if}

			{#each turns as turn, i (i)}
				<article class="mb-7">
					<p class="mb-1.5 font-mono text-[0.7rem] tracking-widest text-neutral-400 uppercase">
						{turn.role}
					</p>

					{#if turn.tools.length}
						<ul class="mb-2 flex flex-wrap gap-1.5">
							{#each turn.tools as tool (tool.id)}
								<li
									class="rounded px-1.5 py-0.5 font-mono text-[0.7rem] {tool.subagent
										? 'border-y border-r border-l-2 border-y-sky-300/60 border-r-sky-300/60 border-l-sky-500 text-sky-700 dark:border-y-sky-900 dark:border-r-sky-900 dark:text-sky-400'
										: tool.failed
											? 'border border-red-300 text-red-600 dark:border-red-900'
											: tool.done
												? 'border border-neutral-300 text-neutral-500 dark:border-neutral-700'
												: 'border border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-500'}"
									title={tool.subagent
										? 'A subagent ran in its own context window. Everything it read was paid for once and discarded; only its reply came back.'
										: tool.name}
								>
									{tool.name}{tool.done ? '' : '…'}
								</li>
							{/each}
						</ul>
					{/if}

					{#if turn.thinking}
						<p class="font-mono text-sm text-neutral-400 italic">thinking…</p>
					{/if}

					{#if turn.text}
						<p class="whitespace-pre-wrap">{turn.text}</p>
					{/if}

					{#if turn.approval}
						<div
							class="mt-2 rounded border border-amber-400/60 bg-amber-50/60 p-3 dark:border-amber-700/60 dark:bg-amber-950/20"
						>
							<p
								class="font-mono text-[0.7rem] tracking-widest text-amber-700 uppercase dark:text-amber-500"
							>
								Approve · {turn.approval.name}
							</p>
							<p class="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
								This spends money. You are approving the exact brief below, as written.
							</p>
							<pre
								class="mt-2 max-h-56 overflow-auto rounded border border-neutral-200 bg-white/70 p-2 font-mono text-[0.72rem] whitespace-pre-wrap dark:border-neutral-800 dark:bg-neutral-900/60">{briefOf(
									turn.approval.args
								)}</pre>
							<div class="mt-2 flex gap-2">
								<button
									onclick={() => decide(turn, true)}
									disabled={turn.approval.deciding}
									class="rounded border border-neutral-900 bg-neutral-900 px-3 py-1.5 font-mono text-xs text-white disabled:opacity-40 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
									>approve</button
								>
								<button
									onclick={() => decide(turn, false)}
									disabled={turn.approval.deciding}
									class="rounded border border-neutral-300 px-3 py-1.5 font-mono text-xs disabled:opacity-40 dark:border-neutral-700"
									>decline</button
								>
							</div>
						</div>
					{/if}

					{#if turn.error}
						<p
							class="mt-1 rounded border border-red-200 bg-red-50 px-2 py-1 font-mono text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
						>
							{turn.error}
						</p>
					{/if}

					{#if turn.usage?.total}
						<p class="mt-1.5 font-mono text-[0.7rem] text-neutral-400 tabular-nums">
							{turn.usage.input} in · {turn.usage.output} out{turn.usage.reasoning
								? ` · ${turn.usage.reasoning} reasoning`
								: ''}{turn.usage.cached ? ` · ${turn.usage.cached} cached` : ''}
						</p>
					{/if}
				</article>
			{/each}
		</div>
	</div>

	<div class="border-t border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<div class="mx-auto flex max-w-2xl items-end gap-2">
			<textarea
				bind:value={draft}
				onkeydown={onKeydown}
				rows="1"
				placeholder="Ask Colophon…"
				class="min-h-[2.5rem] flex-1 resize-none rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
			></textarea>
			{#if busy}
				<button
					onclick={stop}
					class="rounded border border-neutral-300 px-3 py-2 font-mono text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
					>stop</button
				>
			{:else}
				<button
					onclick={send}
					disabled={!draft.trim()}
					class="rounded border border-neutral-900 bg-neutral-900 px-3 py-2 font-mono text-xs text-white disabled:opacity-30 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
					>send</button
				>
			{/if}
		</div>
	</div>
</div>
