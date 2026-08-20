import { Agent } from '@mastra/core/agent';
import { model } from '$lib/server/model';
import { agentMemory, isStorageConfigured, READER } from '$lib/server/storage';
import { createResearchTools } from './tools';
import { formatReferences } from './sources';
import { deliveryGate } from './delivery-gate';
import {
	dueSubscriptions,
	markDelivered,
	markDeliveryFailed,
	markSwept,
	recordDigest,
	rememberPaper,
	sweepSince,
	type Subscription
} from '$lib/server/subscriptions';
import { isMailConfigured, sendDigest } from '$lib/server/mail';

/**
 * The sweep: what Colophon does while you are asleep.
 *
 * One subscription, one run, one verdict. The interesting design decision is
 * that a *withheld* digest is a successful sweep — the gate staying quiet on a
 * thin week is the product working, not failing, and the code says so by
 * recording it and marking the subscription swept either way.
 *
 * ── Why this is not a Mastra workflow ───────────────────────────────────────
 * Mastra's scheduler needs a long-lived host and does not run on serverless;
 * its DurableAgent wants Inngest. Neither is available on Vercel Hobby. So the
 * shape is: platform cron fires a route, the route runs this. If a sweep ever
 * outgrows the 300s function limit, the answer is a Vercel Workflow whose steps
 * each make one bounded call — not Mastra's own durability. See CLAUDE.md.
 */

export interface SweepResult {
	subscriptionId: string;
	query: string;
	/** The gate's answer. 'passed' is not the same as delivered — see `delivered`. */
	verdict: 'passed' | 'withheld' | 'failed';
	title: string;
	reason?: string;
	sources: string[];
	/** True only once a mail provider has accepted it. */
	delivered: boolean;
	/** Why it did not arrive, when the gate had said it should. */
	deliveryError?: string;
	ms: number;
}

function buildPrompt(subscription: Subscription, since: Date): string {
	const day = since.toISOString().slice(0, 10);
	return `Sweep the literature for: ${subscription.query}

Only papers published on or after ${day}.

${subscription.notes ? `Why this is being followed, in the reader's words:\n"${subscription.notes}"\n\nLet that decide what is worth mentioning and what is not.` : ''}

Search by recency. Read the two or three papers that actually matter — not
every result. Verify each claim through the cite tool as you write it.

## The shape of the digest

First line: a markdown H1 that is a **headline about what happened** — the
finding, the disagreement, the thing that changed. Not the search query, not a
date range, not "Weekly digest". A reader scanning their inbox sees only this.

Then prose. Short paragraphs, each making one point, opening with the sentence
that carries the news. Attribute in running text — (Lee et al., 2026) — the way
a person writing to a colleague would.

Use a bulleted list only for genuinely parallel items, at most four, one
sentence each. A single bullet containing a paragraph is a paragraph; write it
as one.

Do **not** write a references or bibliography section, and do not call the
bibliography tool. References are appended for you, built from the papers you
actually opened. Never copy retrieval bookkeeping into the prose — words like
"read", "listed", "via search_papers" are the system talking to itself, and the
reader should never meet them.

If the period genuinely contained nothing worth the reader's attention, say so
in a sentence and stop. Padding a thin week is worse than silence.`;
}

/** Everything the research tool set offers except the bibliography. */
function withoutBibliography<T extends Record<string, unknown>>(tools: T): Omit<T, 'bibliography'> {
	const { bibliography: _unused, ...rest } = tools;
	void _unused;
	return rest;
}

/** The heading on the first line, or a fallback. */
function titleOf(body: string, subscription: Subscription): string {
	const heading = body.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
	return heading || `${subscription.query} — ${new Date().toISOString().slice(0, 10)}`;
}

/**
 * A TripWire from the delivery gate, as opposed to a genuine failure.
 *
 * Mastra does not export a stable TripWire class for `instanceof`, and the
 * error surfaces differently depending on whether it came through `generate`
 * or the stream. The gate's own verdict is captured separately via `onVerdict`,
 * so this only has to distinguish "the gate stopped it" from "something broke",
 * and it errs toward calling an ambiguous case a failure — a real outage
 * silently recorded as "quiet week" would be the worst outcome available.
 */
function looksLikeTripwire(error: unknown, gateFired: boolean): boolean {
	if (gateFired) return true;
	const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
	return /tripwire/i.test(text);
}

export async function sweepOne(subscription: Subscription): Promise<SweepResult> {
	const startedAt = Date.now();
	const since = sweepSince(subscription);
	const research = createResearchTools();

	let verdict: { worthSending: boolean; reason: string } | undefined;
	const gate = deliveryGate({ onVerdict: (v) => (verdict = v) });

	const agent = new Agent({
		id: 'colophon-sweep',
		name: 'Colophon',
		instructions: `You are Colophon, writing a periodic digest for a reader who
follows this field closely and has very little time. Be specific, be short, and
be willing to report that nothing happened.`,
		model: model(),
		// `bibliography` is deliberately withheld from a sweep. The references are
		// appended by the system afterwards, so a tool that produces a second,
		// differently-formatted list has nothing to contribute and one obvious way
		// to do harm. Telling the model not to call a tool it has is advice; not
		// giving it the tool is the same guarantee the `cite` refusal makes.
		// The interactive agent keeps it — there, the reader can ask for one.
		tools: withoutBibliography(research.tools),
		outputProcessors: [gate],
		...(isStorageConfigured() ? { memory: agentMemory() } : {})
	});

	let body = '';
	let failure: string | undefined;

	try {
		const result = await agent.generate(buildPrompt(subscription, since), {
			maxSteps: 24,
			// One thread per subscription, so a sweep can see what it said last
			// time — which is what makes "this contradicts last week" possible.
			...(isStorageConfigured()
				? { memory: { thread: `sweep:${subscription.id}`, resource: READER } }
				: {})
		});
		body = result.text ?? '';
	} catch (error) {
		if (!looksLikeTripwire(error, Boolean(verdict && !verdict.worthSending))) {
			failure = error instanceof Error ? error.message : String(error);
		}
	}

	// Everything retrieved goes to the library, whether or not the digest ships.
	// The reading happened; forgetting it because the gate said no would mean
	// re-reading the same papers tomorrow.
	for (const source of research.registry.all()) {
		await rememberPaper({
			id: source.id,
			arxivId: source.arxivId,
			doi: source.doi,
			title: source.title,
			authors: source.authors,
			year: source.year,
			url: source.url,
			citedBy: source.citedBy,
			depth: source.depth
		});
	}

	// Three different questions, three different answers, and conflating any two
	// of them produces a wrong document:
	//   cited — what the digest refers to, and therefore its reference list
	//   read  — what was opened in full, and therefore the honest "N papers read"
	//   all   — everything retrieved, which goes to the library either way
	const cited = research.registry.cited();
	const read = research.registry.read();
	const sources = cited.map((s) => s.id);

	// The references are appended here rather than asked for, so the document is
	// complete in the database and identical everywhere it is rendered. Only on a
	// digest that will actually be read: a withheld or failed run keeps its raw
	// draft, which is what makes a rejected draft useful for tuning the gate.
	const references = formatReferences(cited);
	const outcome: SweepResult['verdict'] = failure
		? 'failed'
		: verdict && !verdict.worthSending
			? 'withheld'
			: 'passed';
	const title = titleOf(body, subscription);

	const document =
		outcome === 'passed' && references && !/^##\s+references/im.test(body)
			? `${body.trimEnd()}\n\n${references}\n`
			: body;

	const digest = await recordDigest({
		subscriptionId: subscription.id,
		title,
		body: document,
		sources,
		verdict: outcome,
		reason: failure ?? verdict?.reason
	});

	// Marked swept even when withheld: the period *was* examined, and not
	// advancing the mark would make tomorrow re-read the same papers and reach
	// the same verdict. A failure does not advance it, so the next run retries.
	if (!failure) await markSwept(subscription.id);

	/*
	 * Delivery, after the digest is safely on disk.
	 *
	 * Three things worth being deliberate about:
	 *
	 * 1. It happens *after* `recordDigest`, so a provider outage costs the email
	 *    and never the writing. The digest is readable in the app either way.
	 * 2. A delivery failure does **not** make the sweep a failure. The research
	 *    happened, the gate approved, the text exists; calling that "failed"
	 *    would un-advance `lastSweptAt` and re-read the whole period tomorrow to
	 *    produce a digest that already exists.
	 * 3. With no mail configured it simply does not run. `deliveredAt` stays
	 *    null with no `deliveryError` beside it, which is the pair's way of
	 *    saying "never attempted" as distinct from "attempted and refused".
	 */
	let delivered = false;
	let deliveryError: string | undefined;

	if (outcome === 'passed' && isMailConfigured()) {
		try {
			await sendDigest({
				topic: subscription.query,
				subject: title,
				markdown: document,
				papersRead: read.length
			});
			await markDelivered(digest.id);
			delivered = true;
		} catch (error) {
			deliveryError = error instanceof Error ? error.message : String(error);
			await markDeliveryFailed(digest.id, deliveryError);
		}
	}

	return {
		subscriptionId: subscription.id,
		query: subscription.query,
		verdict: outcome,
		title,
		reason: failure ?? verdict?.reason,
		sources,
		delivered,
		deliveryError,
		ms: Date.now() - startedAt
	};
}

/**
 * Sweep everything due.
 *
 * Sequential rather than parallel, deliberately: a Vercel Hobby function has
 * 300 seconds and 2 GB, and three concurrent research runs would contend for
 * both while making the provider rate-limit more likely. Sequential also means
 * a partial run leaves earlier subscriptions correctly swept rather than all of
 * them half-done.
 */
export async function sweepAllDue(limit = 5): Promise<SweepResult[]> {
	const due = (await dueSubscriptions()).slice(0, limit);
	const results: SweepResult[] = [];
	for (const subscription of due) {
		results.push(await sweepOne(subscription));
	}
	return results;
}
