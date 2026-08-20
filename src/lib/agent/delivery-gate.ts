import type { Processor } from '@mastra/core/processors';
import { model } from '$lib/server/model';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';

/**
 * The delivery gate.
 *
 * An agent that mails you something every morning whether or not it has
 * anything to say is a newsletter you will mute within a week. One that stays
 * quiet for four days and then sends something genuinely worth reading is a
 * tool you keep for years. This is the difference, and it is the single most
 * important behaviour in the product.
 *
 * ── Why a processor and not a scorer ────────────────────────────────────────
 * The obvious construction is a scorer: score the draft, send if it clears the
 * bar. It does not work. **Mastra scorers record a score; they do not block a
 * result.** That was established by compiling the docs' own examples against
 * the installed package — Mastra's documentation reads as though `scorers: {}`
 * gates delivery, and it does not.
 *
 * The mechanisms that actually stop a result are an output processor calling
 * `abort()`, and the agent's `goal`. So the gate is a processor: `abort()`
 * raises a TripWire, which surfaces as a `tripwire` chunk the caller can see
 * and act on. Refusal is structural rather than advisory — exactly the same
 * move the `cite` tool makes for citations.
 *
 * Use a scorer to *measure*, a processor to *refuse*.
 */

const VERDICT = z.object({
	worthSending: z.boolean().describe('True only if a busy researcher would be glad this arrived.'),
	reason: z.string().describe('One sentence. If withholding, what was missing.')
});

/**
 * The bar, stated once.
 *
 * Written as things that are *not* enough, because the failure mode is a digest
 * that is technically accurate and completely pointless — "several papers were
 * published on this topic this week" is true of every topic every week.
 */
const RUBRIC = `You decide whether a research digest is worth sending to someone
who follows this field closely and is short of time.

Send it only if it contains at least one of:
- a result that changes what a practitioner would do,
- a genuine disagreement between papers, or
- something that answers a question the reader is already holding.

Withhold it if it is only:
- a list of what was published,
- restated abstracts,
- "interest in X continues to grow",
- or a single incremental result with no consequence.

A thin week is a real outcome and staying quiet is the correct response to one.
You are not being asked whether the writing is good. You are being asked whether
receiving this would be worth the reader's attention.`;

export interface GateOptions {
	/** Minimum characters before the gate even consults a model. */
	minChars?: number;
	/** Called whenever the gate reaches a verdict, sent or withheld. */
	onVerdict?: (verdict: { worthSending: boolean; reason: string }) => void;
}

/**
 * Judge the draft, and abort the run if it does not clear the bar.
 *
 * The judgement is a separate, small model call rather than a self-assessment
 * by the writer: an agent asked whether its own draft is good says yes. The
 * judge sees the text and the rubric and nothing else — not the effort that
 * went into producing it, which is precisely the sunk cost that should not
 * count.
 */
export function deliveryGate({ minChars = 200, onVerdict }: GateOptions = {}): Processor {
	return {
		id: 'delivery-gate',

		async processOutputResult({ result, messages, abort }) {
			const draft = result?.text ?? '';

			// Too short to be worth a model call. The gate should be cheap on the
			// obvious cases and thoughtful only on the arguable ones.
			if (draft.trim().length < minChars) {
				const reason = `Draft was ${draft.trim().length} characters — nothing to send.`;
				onVerdict?.({ worthSending: false, reason });
				abort(reason, { metadata: { gate: 'too-short' } });
			}

			const judge = new Agent({
				id: 'delivery-judge',
				name: 'Delivery judge',
				instructions: RUBRIC,
				// Through the factory, like every model in this codebase.
				model: model()
			});

			const { object } = await judge.generate(
				`Here is the draft digest. Decide whether to send it.\n\n---\n${draft}\n---`,
				{ structuredOutput: { schema: VERDICT } }
			);

			const verdict = object as z.infer<typeof VERDICT>;
			onVerdict?.(verdict);

			if (!verdict.worthSending) {
				// The reason travels with the abort so a withheld digest can be
				// stored with an explanation. A gate whose rejections vanish is
				// impossible to tune — you cannot tell "quiet week" from "gate too
				// strict" without the rejected drafts and their reasons.
				abort(verdict.reason, { metadata: { gate: 'below-bar', reason: verdict.reason } });
			}

			return messages;
		}
	};
}
