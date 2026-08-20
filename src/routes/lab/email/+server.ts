import type { RequestHandler } from './$types';
import { renderDigestEmail } from '$lib/server/mail';
import { listDigests } from '$lib/server/subscriptions';
import { isStorageConfigured } from '$lib/server/storage';

/**
 * What the email actually looks like.
 *
 * Served as raw `text/html` rather than embedded in a page, so the browser
 * renders exactly the document a mail client receives — same doctype, same
 * table, same inlined styles, nothing inherited from the app's stylesheet. An
 * email preview that borrows the app's CSS is a preview of the wrong thing.
 *
 * With a database it uses the most recent real digest, which is the only way to
 * find out that a heading is too tight or a bibliography wraps badly. Without
 * one it falls back to a specimen exercising every block the renderer emits.
 *
 * `?plain` returns the `text/plain` part instead — the half that is never
 * looked at and is therefore always the half that is broken.
 */

const SPECIMEN = `# Two results worth the week

Sparse autoencoder work split this week, and the split is the news. **Anthropic's
scaling note** reports that reconstruction loss keeps improving past 16M
features while *interpretable* features plateau near 4M — the two curves come
apart, which is the first direct evidence that the usual proxy metric stops
tracking the thing it stands in for.

Against that, a smaller group argues the plateau is an artefact of the
automated interpretability scorer rather than of the features themselves.

## What changes

- If you are training an SAE, the width sweep is no longer free: past ~4M you
  are buying reconstruction you cannot read.
- The scorer disagreement is resolvable and nobody has resolved it. That is a
  cheap paper for someone with the eval harness already built.

> Both papers use the same base model, which is why the disagreement is
> interesting rather than merely confusing.

## Worth knowing

Neither group reports variance across seeds. With \`n = 1\` runs at each width,
a plateau and a noisy measurement look identical.

---

1. Scaling monosemanticity past sixteen million features. https://arxiv.org/abs/2401.12345
2. Automated interpretability scores are not interpretability. https://arxiv.org/abs/2402.54321
`;

export const GET: RequestHandler = async ({ url }) => {
	let topic = 'sparse autoencoders';
	let subject = 'Two results worth the week';
	let markdown = SPECIMEN;
	let papersRead = 2;

	if (isStorageConfigured()) {
		const [latest] = await listDigests(1);
		if (latest?.body?.trim()) {
			subject = latest.title;
			markdown = latest.body;
			papersRead = latest.sources.length;
			topic = 'latest digest';
		}
	}

	const { html, text } = renderDigestEmail({ topic, subject, markdown, papersRead });

	if (url.searchParams.has('plain')) {
		return new Response(text, {
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	return new Response(html, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});
};
