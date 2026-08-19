<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();
</script>

<svelte:head><title>Colophon</title></svelte:head>

<main
	class="flex h-dvh items-center justify-center bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
>
	<form method="POST" use:enhance class="w-full max-w-xs px-6">
		<p class="font-mono text-[0.7rem] tracking-widest text-neutral-400 uppercase">Colophon</p>
		<h1 class="mt-2 mb-6 text-xl font-semibold tracking-tight">
			A record of how the thinking was made.
		</h1>

		<label class="block">
			<span class="sr-only">Password</span>
			<input
				name="password"
				type="password"
				autocomplete="current-password"
				class="w-full rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
			/>
		</label>

		{#if form?.wrong}
			<p class="mt-2 font-mono text-xs text-red-600 dark:text-red-400">Not that one.</p>
		{/if}

		<button
			type="submit"
			class="mt-4 w-full rounded border border-neutral-900 bg-neutral-900 px-3 py-2 font-mono text-xs text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
			>enter</button
		>
	</form>
</main>
