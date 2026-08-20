import { Agent } from '@mastra/core/agent';
import { model } from '$lib/server/model';
import { agentMemory, isStorageConfigured, READER } from '$lib/server/storage';
import { createResearchTools } from './tools';
import { deliveryGate } from './delivery-gate';
import {
	dueSubscriptions,
	markSwept,
	recordDigest,
	rememberPaper,
	sweepSince,
	type Subscription
} from '$lib/server/subscriptions';

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
	verdict: 'sent' | 'withheld' | 'failed';
	title: string;
	reason?: string;
	sources: string[];
	ms: number;
}

function buildPrompt(subscription: Subscription, since: Date): string {
	const day = since.toISOString().slice(0, 10);
	return `Sweep the literature for: ${subscription.query}

Only papers published on or after ${day}.

${subscription.notes ? `Why this is being followed, in the reader's words:\n"${subscription.notes}"\n\nLet that decide what is worth mentioning and what is not.` : ''}

Search by recency. Read the two or three papers that actually matter — not
every result. Then write a short digest:

- Open with the single most consequential thing, or say plainly that nothing
  this period changes anything.
- Cite everything through the cite tool.
- End with the bibliography tool.

Title the digest on its first line as a markdown heading.

If the period genuinely contained nothing worth the reader's attention, say so
in a sentence and stop. Padding a thin week is worse than silence.`;
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
		tools: research.tools,
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

	const sources = research.registry.read().map((s) => s.id);
	const outcome: SweepResult['verdict'] = failure
		? 'failed'
		: verdict && !verdict.worthSending
			? 'withheld'
			: 'sent';

	await recordDigest({
		subscriptionId: subscription.id,
		title: titleOf(body, subscription),
		body,
		sources,
		verdict: outcome,
		reason: failure ?? verdict?.reason
	});

	// Marked swept even when withheld: the period *was* examined, and not
	// advancing the mark would make tomorrow re-read the same papers and reach
	// the same verdict. A failure does not advance it, so the next run retries.
	if (!failure) await markSwept(subscription.id);

	return {
		subscriptionId: subscription.id,
		query: subscription.query,
		verdict: outcome,
		title: titleOf(body, subscription),
		reason: failure ?? verdict?.reason,
		sources,
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
