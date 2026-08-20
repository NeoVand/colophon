import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { agentMemory, isStorageConfigured, READER } from '$lib/server/storage';

/**
 * What Colophon has learned about its reader.
 *
 * Separate from the run stream on purpose. Working memory is **resource**-scoped
 * rather than thread-scoped — it is the one thing that outlives a conversation —
 * so tying its readout to a run would make it look like a property of the run,
 * which is exactly backwards. It is fetched on load and after a turn ends,
 * because that is when it can have changed.
 *
 * The reader is allowed to see this. An agent that quietly accumulates a profile
 * of someone and never shows it to them is doing something different from an
 * agent that remembers, and the difference is entirely in whether you can look.
 */
export const GET: RequestHandler = async () => {
	if (!isStorageConfigured()) {
		return json({ configured: false, text: null });
	}

	try {
		// `threadId` is required by the signature but ignored for resource-scoped
		// memory; the resource is what selects the record. Passing the reader id
		// for both keeps it obvious that no particular conversation is involved.
		const text = await agentMemory().getWorkingMemory({
			threadId: READER,
			resourceId: READER
		});
		return json({ configured: true, text });
	} catch (cause) {
		// A memory read must never take down the page that displays it. The panel
		// says so rather than showing an empty profile, which would read as "it
		// has learned nothing about you" — a different and wrong claim.
		return json({
			configured: true,
			text: null,
			error: cause instanceof Error ? cause.message : String(cause)
		});
	}
};
