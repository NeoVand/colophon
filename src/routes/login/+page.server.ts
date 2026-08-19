import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, issueSession, passwordMatches } from '$lib/server/gate';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.authenticated) redirect(303, url.searchParams.get('next') ?? '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const password = String(form.get('password') ?? '');

		if (!passwordMatches(password)) {
			// No detail: "wrong password" and "no password set" look identical from
			// outside, and the delay makes a guessing loop expensive.
			await new Promise((r) => setTimeout(r, 600));
			return fail(401, { wrong: true });
		}

		const session = await issueSession();
		cookies.set(SESSION_COOKIE, session.value, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: session.maxAge
		});

		redirect(303, url.searchParams.get('next') ?? '/');
	}
};
