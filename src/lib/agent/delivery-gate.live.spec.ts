import { describe, it, expect } from 'vitest';
import { deliveryGate } from './delivery-gate';

/**
 * The gate makes a real model call, so this is opt-in:
 *
 *   LIVE=1 npx vitest run src/lib/agent/delivery-gate.live.spec.ts
 *
 * It is worth the money to run before shipping a change to the rubric. The
 * whole product rests on this judgement being sane, and a rubric that quietly
 * drifts to "send everything" turns Colophon into the newsletter it exists not
 * to be.
 */

const THIN = `# This week in mechanistic interpretability

Several papers appeared on interpretability this week. Interest in the area
continues to grow, with contributions spanning sparse autoencoders, circuit
analysis and probing.

One paper studied features in a language model. Another examined attention
patterns. A third proposed a new evaluation. Researchers continue to explore
these directions, and further work is expected.`;

const SUBSTANTIVE = `# Sparse autoencoder features may not compose

Two results this week point the same way, and they cut against how SAE features
are usually used.

Bolik et al. report that active-latent overlap from sparse autoencoders does not
recover human category boundaries better than dense representations, and that
adding a single adjective to a noun phrase changes the active set in ways
inconsistent with bag-of-features compositionality — with substantial
"lost-latent" rates when composing.

That matters practically: pipelines that treat an SAE active set as a stable,
composable description of meaning are relying on a property that does not hold
under ordinary semantic modification. If you are using SAE overlap as a
similarity measure, it is tracking model-internal structure rather than the
human judgements you probably intended.

The disagreement with earlier compositionality claims is direct, and turns on
whether latents are evaluated in isolation or in composed phrases.`;

/** Invoke the processor's hook the way the agent runtime would. */
async function judge(draft: string) {
	let verdict: { worthSending: boolean; reason: string } | undefined;
	const gate = deliveryGate({ onVerdict: (v) => (verdict = v) });

	let aborted: string | undefined;
	const abort = ((reason?: string) => {
		aborted = reason;
		throw new Error(`ABORTED: ${reason}`);
	}) as never;

	try {
		await gate.processOutputResult?.({
			result: { text: draft },
			messages: [],
			abort
		} as never);
	} catch (error) {
		if (!String(error).startsWith('Error: ABORTED')) throw error;
	}

	return { verdict, aborted };
}

describe.skipIf(!process.env.LIVE)('the delivery gate', () => {
	it('withholds a digest that is only a list of what was published', async () => {
		const { verdict, aborted } = await judge(THIN);
		console.log('THIN       →', verdict?.worthSending ? 'SEND' : 'WITHHOLD', '·', verdict?.reason);
		expect(verdict?.worthSending).toBe(false);
		expect(aborted).toBeTruthy();
	}, 90000);

	it('sends a digest carrying a result that changes what someone would do', async () => {
		const { verdict, aborted } = await judge(SUBSTANTIVE);
		console.log('SUBSTANTIVE→', verdict?.worthSending ? 'SEND' : 'WITHHOLD', '·', verdict?.reason);
		expect(verdict?.worthSending).toBe(true);
		expect(aborted).toBeUndefined();
	}, 90000);

	it('refuses an empty draft without spending a model call', async () => {
		const { verdict, aborted } = await judge('');
		expect(verdict?.worthSending).toBe(false);
		expect(aborted).toMatch(/nothing to send/);
	});
});
