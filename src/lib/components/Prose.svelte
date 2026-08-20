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

<!--
	The one `{@html}` in the app, and the reason `markdown.ts` exists.

	The rule this disables is the right rule; the safety is one layer up, where it
	can be tested. `renderMarkdown` escapes every character of input before any
	tag is emitted and passes hrefs through `safeHref`, which admits only http,
	https and mailto — see `markdown.spec.ts`, where the XSS cases are the point
	of the file. Sanitising again here would be sanitising output rather than
	input, which is the version that gets it wrong.
-->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class="co-prose {className}">{@html html}</div>
