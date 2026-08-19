# Decisions

Append-only. Dated. Each entry says what was decided and why, so the reasoning
survives a context compaction.

## 2026-08-19 — Mastra, not Deep Agents

Colophon is a sibling to harnessXray, not a replacement. Deep Agents stays the
subject of harnessXray; Mastra is the subject here. Two harnesses side by side is
a curriculum; one is a demo.

## 2026-08-19 — Full stack, not browser-only

harnessXray is a static SPA with no server. Colophon needs a server: scheduled
research, durable runs, delivered reviews, and — decisively — the ability to work
from networks that filter AI providers, which requires proxying all model traffic
through our own origin.

**Both execution modes are kept.** Study (server) is the product. Lab (browser,
no key, no server) is the teaching half and the shareable one; its bundled replay
fixture needs no network at all, which makes it bulletproof for classes on
locked-down wifi.

## 2026-08-19 — Vercel Hobby, with storage kept portable

Cloudflare is better shaped for this workload (15-minute cron CPU, free waiting,
D1+R2+Vectorize in one $5 bill) but its free tier caps CPU at 10 ms per request,
which is unusable for agent work — so it starts at $5/mo, and Mastra on `workerd`
is a real risk surface.

Vercel Hobby runs real Node (Mastra reaches for `execa`, `fs`, `child_process`),
costs nothing, and includes Vercel Workflows with no run-duration limit. Its one
biting limit — once-daily cron — matches arXiv's publishing cadence.

Storage stays behind one interface so the sideways move to Cloudflare at $5 is
cheap. Blobs go to R2 regardless: S3-compatible, zero egress.

## 2026-08-19 — Keys are server-side only

No bring-your-own-key in the browser. All model traffic goes browser → our origin
→ provider. To a filtering proxy this is plain HTTPS to a personal site. This
also removes the key vault, encryption-at-rest and per-user budget UI from scope.

## 2026-08-19 — Public repo, private vault

Code is public so it can be taught from. Research output, reading history and
drafts live in storage and never enter git.

## 2026-08-19 — Typst first, LaTeX in the browser

Typst is the default authoring format — an agent writes it correctly far more
often than LaTeX. Real LaTeX is kept for journal templates and compiles
client-side via WASM (SwiftLaTeX / BusyTeX), because TeX Live does not fit in a
250 MB serverless function.
