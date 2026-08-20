import { describe, it, expect, vi, beforeEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { isMailConfigured, sendDigest, renderDigestEmail, MailNotConfigured, MailFailed } =
	await import('./mail');

beforeEach(() => {
	env.RESEND_API_KEY = 're_test_key';
	env.RESEND_TO = 'mmv@mit.edu';
	env.RESEND_FROM = undefined;
});

const ok = (body: unknown) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

const DIGEST = {
	topic: 'sparse autoencoders',
	subject: 'Two results worth your week',
	markdown: '# Two results\n\nThe **first** matters. See [the paper](https://arxiv.org/abs/1).',
	papersRead: 3
};

describe('configuration', () => {
	it('needs both a key and an address before it will claim to be configured', () => {
		expect(isMailConfigured()).toBe(true);
		env.RESEND_API_KEY = undefined;
		expect(isMailConfigured()).toBe(false);
		env.RESEND_API_KEY = 're_test_key';
		env.RESEND_TO = undefined;
		expect(isMailConfigured()).toBe(false);
	});

	it('refuses to send rather than silently doing nothing', async () => {
		env.RESEND_TO = undefined;
		await expect(sendDigest(DIGEST)).rejects.toBeInstanceOf(MailNotConfigured);
	});
});

describe('the request', () => {
	it('posts to Resend with the key, the address and both body parts', async () => {
		const fetchImpl = ok({ id: 'msg_1' });
		const sent = await sendDigest(DIGEST, { fetchImpl: fetchImpl as unknown as typeof fetch });

		expect(sent).toEqual({ id: 'msg_1', to: 'mmv@mit.edu' });

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.resend.com/emails');
		expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test_key');

		const body = JSON.parse(init.body as string);
		expect(body.to).toEqual(['mmv@mit.edu']);
		expect(body.subject).toBe('Two results worth your week');
		expect(body.html).toContain('Two results');
		expect(body.text).toContain('TWO RESULTS');
	});

	it('defaults to the sandbox sender, which is the only one a fresh account can use', async () => {
		const fetchImpl = ok({ id: 'msg_1' });
		await sendDigest(DIGEST, { fetchImpl: fetchImpl as unknown as typeof fetch });
		const body = JSON.parse(
			(fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		);
		expect(body.from).toBe('Colophon <onboarding@resend.dev>');
	});

	it('uses RESEND_FROM once a domain is verified', async () => {
		env.RESEND_FROM = 'Colophon <digest@colophon.dev>';
		const fetchImpl = ok({ id: 'msg_1' });
		await sendDigest(DIGEST, { fetchImpl: fetchImpl as unknown as typeof fetch });
		const body = JSON.parse(
			(fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		);
		expect(body.from).toBe('Colophon <digest@colophon.dev>');
	});
});

describe('failures', () => {
	it('explains the unverified-account 403 instead of surfacing it raw', async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response('You can only send testing emails to your own email address.', {
					status: 403
				})
		);
		await expect(
			sendDigest(DIGEST, { fetchImpl: fetchImpl as unknown as typeof fetch })
		).rejects.toThrow(/registered with|verify a domain/);
	});

	it('carries the status through on any other failure', async () => {
		const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));
		await expect(
			sendDigest(DIGEST, { fetchImpl: fetchImpl as unknown as typeof fetch })
		).rejects.toMatchObject({ name: 'MailFailed', status: 429 });
	});

	it('treats a 200 with no message id as a failure, not a success', async () => {
		const fetchImpl = ok({});
		await expect(
			sendDigest(DIGEST, { fetchImpl: fetchImpl as unknown as typeof fetch })
		).rejects.toBeInstanceOf(MailFailed);
	});
});

describe('what lands in the inbox', () => {
	it('shows the topic as an eyebrow and the papers read in the footer', () => {
		const { html, text } = renderDigestEmail(DIGEST);
		expect(html).toContain('Colophon · sparse autoencoders');
		expect(html).toContain('3 papers read');
		expect(text).toContain('COLOPHON · sparse autoencoders');
	});

	it('says "1 paper", not "1 papers"', () => {
		expect(renderDigestEmail({ ...DIGEST, papersRead: 1 }).html).toContain('1 paper read');
	});

	it('escapes a topic or subject that contains markup', () => {
		const { html } = renderDigestEmail({ ...DIGEST, topic: 'a <b> & c', subject: 'x" onload="y' });
		expect(html).toContain('a &lt;b&gt; &amp; c');
		// The subject reaches an attribute, so the quote must be neutralised there
		// rather than merely absent from the visible text.
		expect(html).toContain('<title>x&quot; onload=&quot;y</title>');
	});

	/**
	 * The drift guard.
	 *
	 * Adding a tag to the renderer without adding it to EMAIL_STYLES produces an
	 * email that is correct, unstyled and ugly — a failure nobody sees until it
	 * is in someone's inbox. This renders a document exercising every block kind
	 * and insists each tag in the body arrived with a style attribute.
	 */
	it('styles every tag the renderer can emit', () => {
		const everything = [
			'# h1',
			'## h2',
			'### h3',
			'#### h4',
			'##### h5',
			'###### h6',
			'',
			'A paragraph with **bold**, *italic*, `code` and [a link](https://a.org).',
			'',
			'- bullet',
			'',
			'1. numbered',
			'',
			'> quoted',
			'',
			'```\nfenced\n```',
			'',
			'---'
		].join('\n');

		const { html } = renderDigestEmail({ ...DIGEST, markdown: everything });

		const tags = [
			...html.matchAll(/<(h[1-6]|p|ul|ol|li|a|strong|em|code|pre|blockquote|hr)(\s[^>]*)?>/g)
		];
		// Without this the filter below would pass on an empty match set, which is
		// the shape of a test that checks nothing and stays green forever.
		expect(tags.length).toBeGreaterThan(15);

		const unstyled = tags.filter(([, , attrs]) => !attrs?.includes('style=')).map(([, tag]) => tag);

		expect(unstyled).toEqual([]);
	});

	it('omits the footer link when there is no permalink', () => {
		const { html } = renderDigestEmail({ topic: 't', subject: 's', markdown: 'body' });
		expect(html).not.toContain('read in Colophon');
	});
});
