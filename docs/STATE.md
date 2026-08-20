# Where things stand

**Read this first after a context compaction.** `CLAUDE.md` has the load-bearing
technical facts; this has the situation.

_Last updated: 2026-08-20, during the /loop session._

## What this is

Colophon: a deep-research companion that follows fields, reads papers, writes
digests worth reading — plus an X-ray of the agent doing it, for teaching.
Sibling to [harnessXray](https://github.com/NeoVand/harnessXray), which does the
same for Deep Agents. Colophon runs on **Mastra**.

Repo: <https://github.com/NeoVand/colophon> (public; the vault is not)
Live: <https://colophon-woad.vercel.app> (password-gated)

The user is **Neo Mohsenvand** (MIT Media Lab). One reader, one vault.

## Running it

```bash
cd ~/repos/colophon
npm run dev -- --port 5180 --strictPort   # dev server
npm run check                              # svelte-check — keep at 0 errors
npx vitest run --project=server            # 90 tests, all must pass
LIVE=1 npx vitest run --project=server     # + network/paid tests (opt-in)
npx vercel deploy --prod --yes             # deploy
```

Password for the deployed app: `grep COLOPHON_PASSWORD .env | cut -d= -f2`

**Testing through the gate needs an `Origin` header** — SvelteKit's CSRF
protection rejects form POSTs without one, and curl does not send it:

```bash
ORIGIN=https://colophon-woad.vercel.app
curl -c jar -X POST "$ORIGIN/login" -H "Origin: $ORIGIN" -d "password=$PASSWORD"
```

## Done and verified in production

| Milestone | What works                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| M0        | Mastra runs in a browser tab (7/7 at `/lab/probe`); deployed; SSE unbuffered                                              |
| M1        | Streaming chat; chunk projection (~30 KB → 580 bytes per run)                                                             |
| M2        | Neon connected; Mastra memory persists; **resource-scoped working memory verified** — a new thread still knows the reader |
| M3        | search → fetch → cite → bibliography, live. Citations structurally cannot be invented                                     |
| M3+       | **paper-reader subagent** — two ran in parallel, provenance crossed the delegation boundary while the text did not        |
| M4        | Subscriptions, sweep, daily cron, **delivery gate**. A real 75s sweep produced a good digest                              |
| M4+       | **Image generation** (gpt-image-2) behind `requireApproval: true`, verified end to end                                    |

## In flight

**Approval is done** — verified with a real round trip: the run paused, the
approval arrived in a separate request, the image rendered (788 KB) and served
at `/figures/…`. Next is Resend delivery, then the X-ray panels.

Historical note on why it works. The agent is now
registered on a `Mastra` instance with storage so a suspended run survives into
a _different_ HTTP request — without that, `approveToolCall()` fails with
"snapshot not found".

**Known limitation to be honest about:** the source registry is in-memory per
request, so a tool needing it cannot currently be approved across requests.
Only `generate_image` requires approval today and it does not touch the
registry, so this is not yet a bug — but it will be if `cite` ever needs a gate.

## Next, in order

1. Finish approval: endpoint emits it, `/api/agent/approve` resumes, UI card.
2. **Email delivery** via Resend → `mmv@mit.edu` (address confirmed).
3. **The X-ray panels** (M5) — wire plane, event taxonomy, ported panels.
4. **The book** — see `docs/BOOK.md`. Neo reviews plates before they ship.
5. Typst/LaTeX authoring; the vault as a document store.

## Waiting on Neo

- **Blob storage.** Images are in Postgres behind a 64 MB cap (~37 images),
  which is wrong for a book. **Vercel Blob is the answer** — 1 GB and 10 GB
  transfer free on Hobby, ~580 images, provisioned exactly like Neon was
  (dashboard → Storage → Create → Blob). No new vendor. R2 is better at scale
  (10 GB, zero egress) but needs a Cloudflare account and is not the constraint
  here. The store is behind an object-store-shaped interface in
  `src/lib/server/blobs.ts`, so either is a one-file swap.
- **Resend account** for actually sending. Address is settled.

## Environment variables

Set locally in `.env` and on Vercel (production + preview). `.env.local` is
written by `vercel env pull` and carries `DATABASE_URL`.

`OPENAI_API_KEY` · `COLOPHON_PASSWORD` · `COLOPHON_SECRET` · `CRON_SECRET` ·
`OPENALEX_MAILTO` (mmv@mit.edu) · `RESEND_TO` (mmv@mit.edu) · `DATABASE_URL`

Not yet set: `RESEND_API_KEY`, blob storage credentials.

## Working agreements

- Neo invoked `/loop`: keep building without stopping unless genuinely blocked.
  Self-paced; re-arm with `ScheduleWakeup` at the end of each turn.
- Every milestone: build → test → verify in a real browser or against
  production → commit → deploy. Finish one before starting the next.
- `npm run check` at 0 errors and the full suite green before every commit.
- **Patches must assert their target exists.** A silent `str.replace()` no-op
  cost an hour when prettier had reformatted the block first. Prefer `Edit`.
- `mv`, `cp` and `ls` are aliased interactively in this shell — use `/bin/ls`,
  and avoid `mv`/`cp` in scripted steps or they hang on a prompt.
- Live/paid tests are gated behind `LIVE=1` so the default suite is hermetic.
- Neo has a sharp eye for the book plates; show him before shipping any.
