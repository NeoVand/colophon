import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { isStorageConfigured } from '$lib/server/storage';
import { isMailConfigured } from '$lib/server/mail';
import {
	createSubscription,
	deleteSubscription,
	listDigests,
	listSubscriptions,
	setSubscriptionActive
} from '$lib/server/subscriptions';

/**
 * The vault: what is being followed, and what came of it.
 *
 * Until now the sweep wrote digests into a database nobody could read without
 * a SQL client, which makes the most valuable thing the product does also the
 * least visible thing. Everything here already existed; none of it had a door.
 *
 * The digest bodies are sent whole rather than paginated. A digest is a page of
 * prose and fifty of them is well under a megabyte, whereas a second round trip
 * per digest would make reading the archive feel like using a database.
 */
export const load: PageServerLoad = async () => {
	if (!isStorageConfigured()) {
		return { configured: false, mail: false, subscriptions: [], digests: [] };
	}

	const [subscriptions, digests] = await Promise.all([listSubscriptions(), listDigests(50)]);

	return {
		configured: true,
		/** Whether a passing digest would actually be delivered, or only stored. */
		mail: isMailConfigured(),
		subscriptions,
		digests
	};
};

export const actions: Actions = {
	follow: async ({ request }) => {
		const form = await request.formData();
		const query = String(form.get('query') ?? '').trim();
		const notes = String(form.get('notes') ?? '').trim();
		const everyDays = Number(form.get('everyDays') ?? 1);

		if (!query) return fail(400, { message: 'A subscription needs something to search for.' });
		if (!Number.isFinite(everyDays) || everyDays < 1 || everyDays > 30) {
			return fail(400, { message: 'Sweep interval must be between 1 and 30 days.' });
		}

		await createSubscription({ query, notes: notes || undefined, everyDays });
		return { ok: true };
	},

	toggle: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const active = form.get('active') === 'true';
		if (!id) return fail(400, { message: 'No subscription named.' });
		await setSubscriptionActive(id, active);
		return { ok: true };
	},

	unfollow: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'No subscription named.' });
		// Digests cascade with the subscription — see the schema's `onDelete`.
		// That is deliberate: a digest without the thing it was written about is
		// an orphan nobody can interpret.
		await deleteSubscription(id);
		return { ok: true };
	}
};
