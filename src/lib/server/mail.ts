import { env } from '$env/dynamic/private';
import { renderMarkdown, toPlainText, type StyleMap } from '$lib/markdown';

/**
 * Delivery.
 *
 * The last link in the chain, and the one that makes the rest matter: a digest
 * that only exists in a database is something you have to remember to go and
 * look at, which is precisely the chore Colophon exists to remove.
 *
 * ── Resend, by REST ─────────────────────────────────────────────────────────
 * No SDK. The API is one POST, the SDK is a dependency plus a Node runtime
 * assumption, and the `fetchImpl` seam below is what makes this testable
 * without either. Same reasoning as `images.ts`.
 *
 * ── Two facts about a fresh Resend account ──────────────────────────────────
 * Until a domain is verified, Resend allows exactly one route: from
 * `onboarding@resend.dev`, to **the address the account was registered with**.
 * Anything else returns 403 with "You can only send testing emails to your own
 * email address". That is not a misconfiguration to debug — it is the free tier
 * working as documented, and it is why `RESEND_FROM` defaults to the sandbox
 * sender rather than to something that looks nicer and fails.
 *
 * The free tier is 100 emails/day, 3000/month. One reader with a handful of
 * subscriptions will not come close.
 */

const ENDPOINT = 'https://api.resend.com/emails';

/** The sandbox sender, which works before any domain is verified. */
const DEFAULT_FROM = 'Colophon <onboarding@resend.dev>';

export class MailNotConfigured extends Error {
	constructor() {
		super('RESEND_API_KEY or RESEND_TO is not set; there is nowhere to deliver.');
		this.name = 'MailNotConfigured';
	}
}

export class MailFailed extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'MailFailed';
	}
}

export function isMailConfigured(): boolean {
	return Boolean(env.RESEND_API_KEY && env.RESEND_TO);
}

/* ── how a digest looks in a mail client ──────────────────────────────────── */

/**
 * The house style, inlined.
 *
 * Same reasoning as the app: a near-neutral grey with a slight cool bias, one
 * ink, hairlines rather than boxes, and a monospace micro-label where a
 * structural fact needs saying. No accent colour at all — a research digest
 * gains nothing from a brand hue, and the restraint is the identity.
 *
 * Hex, not `oklch`. Outlook and several mobile clients drop declarations they
 * cannot parse, and a dropped `color` on a light background is invisible text.
 *
 * These are the values behind the app's tokens, resolved: `#09090b` is
 * `oklch(0.141 0.005 285.823)`, `#71717a` is `oklch(0.552 0.016 285.938)`,
 * `#e4e4e7` is `oklch(0.92 0.004 286.32)`. Keeping them written out here rather
 * than importing is deliberate — an email cannot resolve a custom property, so
 * pretending it shares the app's variables would be a lie that renders wrong.
 */
const INK = '#09090b';
const MUTED = '#71717a';
const RULE = '#e4e4e7';
const PAPER = '#ffffff';
const WASH = '#f4f4f5';

const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

export const EMAIL_STYLES: StyleMap = {
	h1: `margin:0 0 14px;font:600 24px/1.25 ${SERIF};color:${INK};letter-spacing:-0.01em`,
	h2: `margin:28px 0 10px;font:600 17px/1.3 ${SERIF};color:${INK}`,
	h3: `margin:22px 0 8px;font:600 15px/1.35 ${SERIF};color:${INK}`,
	h4: `margin:18px 0 6px;font:600 14px/1.35 ${SERIF};color:${INK}`,
	h5: `margin:18px 0 6px;font:600 13px/1.35 ${SERIF};color:${INK}`,
	h6: `margin:18px 0 6px;font:600 13px/1.35 ${SERIF};color:${MUTED}`,
	p: `margin:0 0 14px;font:400 16px/1.65 ${SERIF};color:${INK}`,
	ul: `margin:0 0 14px;padding-left:22px`,
	ol: `margin:0 0 14px;padding-left:22px`,
	li: `margin:0 0 6px;font:400 16px/1.6 ${SERIF};color:${INK}`,
	a: `color:${INK};text-decoration:underline;text-underline-offset:2px`,
	strong: `font-weight:600`,
	em: `font-style:italic`,
	code: `font:400 13px/1.5 ${MONO};background:${WASH};padding:1px 4px;border-radius:3px`,
	pre: `margin:0 0 14px;padding:12px 14px;background:${WASH};border-radius:4px;overflow-x:auto`,
	blockquote: `margin:0 0 14px;padding:2px 0 2px 16px;border-left:2px solid ${RULE}`,
	hr: `margin:24px 0;border:0;border-top:1px solid ${RULE}`
};

export interface DigestMail {
	/** The subscription's query, shown as the eyebrow. */
	topic: string;
	subject: string;
	markdown: string;
	/** How many papers were actually opened, for the footer's one honest number. */
	papersRead?: number;
	/** Where to read it in the app. */
	permalink?: string;
}

/**
 * The frame around the digest.
 *
 * A table, because that is still the only layout primitive every mail client
 * agrees on — Outlook's word-rendering engine ignores most of flexbox and all
 * of grid. The width cap is on the inner cell rather than the table so the
 * background reaches the edges on mobile while the measure stays readable.
 */
export function renderDigestEmail(mail: DigestMail): { html: string; text: string } {
	const body = renderMarkdown(mail.markdown, EMAIL_STYLES);
	const label = `font:500 11px/1.4 ${MONO};letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}`;

	const footerBits = [
		mail.papersRead !== undefined
			? `${mail.papersRead} paper${mail.papersRead === 1 ? '' : 's'} read`
			: undefined,
		mail.permalink
			? `<a href="${mail.permalink}" style="color:${MUTED};text-decoration:underline">read in Colophon</a>`
			: undefined
	].filter(Boolean);

	const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeAttr(mail.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${WASH};-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${WASH}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;background:${PAPER};border:1px solid ${RULE};border-radius:6px">
<tr><td style="padding:32px 36px 28px">
<p style="${label};margin:0 0 20px">Colophon · ${escapeText(mail.topic)}</p>
${body}
<hr style="margin:28px 0 14px;border:0;border-top:1px solid ${RULE}" />
<p style="${label};margin:0">${footerBits.join(' &nbsp;·&nbsp; ') || 'Colophon'}</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

	const text = [
		`COLOPHON · ${mail.topic}`,
		'',
		toPlainText(mail.markdown),
		'',
		'—'.repeat(40),
		footerBits.length
			? [
					mail.papersRead !== undefined
						? `${mail.papersRead} paper${mail.papersRead === 1 ? '' : 's'} read`
						: undefined,
					mail.permalink
				]
					.filter(Boolean)
					.join('  ·  ')
			: 'Colophon'
	].join('\n');

	return { html, text };
}

function escapeText(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
	return escapeText(s).replace(/"/g, '&quot;');
}

/* ── the transport ────────────────────────────────────────────────────────── */

export interface Sent {
	id: string;
	to: string;
}

/**
 * Send one digest.
 *
 * Throws rather than returning a failure flag, because the caller has exactly
 * one sensible response to a delivery failure — record that the digest was not
 * delivered — and a boolean invites forgetting to check it.
 */
export async function sendDigest(
	mail: DigestMail,
	{ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}
): Promise<Sent> {
	if (!isMailConfigured()) throw new MailNotConfigured();

	const to = env.RESEND_TO as string;
	const { html, text } = renderDigestEmail(mail);

	const response = await fetchImpl(ENDPOINT, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${env.RESEND_API_KEY}`
		},
		body: JSON.stringify({
			from: env.RESEND_FROM || DEFAULT_FROM,
			to: [to],
			subject: mail.subject,
			html,
			text
		})
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		// Worth naming, because it is the single most likely failure on a new
		// account and reads like a bug rather than the documented free tier.
		if (response.status === 403 && /own email address|testing emails/i.test(detail)) {
			throw new MailFailed(
				`Resend refused: an unverified account can only send to the address it was ` +
					`registered with. RESEND_TO is "${to}" — either register the account with ` +
					`that address or verify a domain.`,
				403
			);
		}
		throw new MailFailed(
			`Resend returned HTTP ${response.status}: ${detail.slice(0, 300)}`,
			response.status
		);
	}

	const json = (await response.json()) as { id?: string };
	if (!json.id) throw new MailFailed('Resend accepted the request but returned no message id.');
	return { id: json.id, to };
}
