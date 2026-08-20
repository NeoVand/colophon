<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	/**
	 * Markdown, set to be read.
	 *
	 * `{@html}` is safe here for one specific reason, and it is worth being able
	 * to point at: `renderMarkdown` escapes every character of source text before
	 * it emits a tag, passes no HTML through, and refuses any href that is not
	 * http/https/mailto. The output is a tree this app built, not a string the
	 * model wrote. If that ever stops being true, this component is the thing
	 * that becomes an injection, so the two live and die together.
	 */
	let { text, class: className = '' }: { text: string; class?: string } = $props();

	const html = $derived(renderMarkdown(text));
</script>

<div class="co-prose {className}">{@html html}</div>
