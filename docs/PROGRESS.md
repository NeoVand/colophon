# Progress

Updated as milestones land. After a context compaction, read this first.

| #   | Milestone                                                     | Status      |
| --- | ------------------------------------------------------------- | ----------- |
| M0  | Three spikes: browser run, Vercel deploy, SSE through a proxy | **done**    |
| M1  | Skeleton: SvelteKit + auth + proxied model access             | next        |
| M2  | Storage behind one interface (Postgres + blob)                | not started |
| M3  | The research agent (interactive)                              | not started |
| M4  | It runs without you: subscriptions, cron, scorer gate, email  | not started |
| M5  | The X-ray: wire plane, event taxonomy, ported panels          | not started |

## M0 gates

- [x] Scaffold SvelteKit with ai-tools, better-auth, drizzle/neon, vercel adapter
- [x] `CLAUDE.md` written with the load-bearing facts
- [x] Browser shim set ported and a Mastra agent bundles under Vite
- [x] A real streamed Mastra run (server-side, SSE) — `/api/agent/stream`
- [x] A real streamed Mastra run from a Vercel function — live at https://colophon-woad.vercel.app
- [x] SSE is not buffered by Vercel's own edge (ttfb 0.19s, total 4.1s)
- [ ] SSE survives a _corporate_ buffering proxy — **needs Neo to test from a restricted network**
- [x] A Mastra skill authored for this repo (`.claude/skills/mastra/SKILL.md`, 418 lines)

## Log

- **2026-08-19** — repo created, scaffold complete.
- **2026-08-19** — browser gate passes 7/7 at `/lab/probe`, in a real Chrome tab:
  module graph initialises, agent constructs, tools/instructions/model resolve
  through the fetch seam, sha256 shim matches the NIST vector.
  Two findings beyond the original esbuild probe:
  `@ast-grep/napi` (a native N-API addon) must be stubbed, and Vite's dep
  pre-bundler runs a _separate_ esbuild pass that needs the shim table too.
- **2026-08-19** — streaming seam works: `/api/agent/stream` runs a real Mastra
  agent against gpt-5 and forwards `fullStream` as SSE. Key stays server-side.

  Two notes for later:
  - `reasoning-start`/`reasoning-end` chunks carry a multi-kilobyte
    `reasoningEncryptedContent` blob each. The X-ray's event log will need to
    hold these by reference, not inline, or a single run will weigh megabytes.
  - The Mastra skill's verification pass found the docs wrong about
    `PostgresStore` (docs say `PgStore`), and sharpened the model rule: the
    `{ id, apiKey }` config object also exposes no `fetch` hook, not just the
    router string. CLAUDE.md updated.

## Known issues

- ~~The terminal SSE chunks are enormous.~~ **Fixed in M1** by `src/lib/agent/events.ts`.
  Original note kept for the reasoning:

- **The terminal SSE chunks are enormous.** `step-finish` and `finish` each carry
  the full message history, the outgoing request body, and the encrypted
  reasoning blob — repeated across `steps[]`, `messages.all` and
  `messages.nonUser`. One trivial two-word answer produced ~30 KB of terminal
  chunk against ~200 bytes of actual text. Before the chat UI ships, the
  endpoint must project chunks down to what the client needs and keep the fat
  payloads server-side for the X-ray to fetch on demand.

- **A gift hidden in the same chunk:** `step-finish.payload.metadata.request.body`
  is the literal outgoing request. That is the Context panel's data source,
  available without wire capture. Wire capture still earns its place for the raw
  bytes and the response headers, but the assembled prompt is already published.

- **`optimizeDeps.esbuildOptions` is deprecated.** Vite now pre-bundles with
  Rolldown and warns that `rolldownOptions` is the replacement. Our shim plugin
  still works through the compatibility path — the browser probe passes — but
  this will need porting before it is removed.

## Log (continued)

- **2026-08-19** — M1 done. Chunk projection (`src/lib/agent/events.ts`, 14
  tests against chunks captured from a real production run), an SSE reader that
  can POST, and a streaming chat at `/`. Verified in Chrome: streamed answer
  plus a live token readout (46 in / 263 out / 192 reasoning).

  Auth and `db` are lazy, so the chat works with no database at all — which is
  why M1 and M2 were swapped: something usable now, storage next.

  **Design change from the skill's verification pass:** scorers do not gate.
  The M4 "only send if it clears the bar" must be an output processor calling
  `abort()`, or the agent's `goal`. See CLAUDE.md.

- **2026-08-19** — the gate (see commit). Production was public with a key
  behind it; that is closed. Password + HMAC cookie, no database, fails closed.

- **2026-08-19** — M3 groundwork: the source registry and retrieval.

  **A dividend of going server-side:** harnessXray could only use OpenAlex,
  because arXiv's API sends no CORS header. We can now use both — arXiv for
  what appeared this morning (real date/category filters, live within hours),
  OpenAlex for what matters (citation counts, resolved authors, DOIs, but days
  to weeks behind on preprints).

  **Two things live testing caught that fixtures could not:**
  - arXiv defaults multi-term queries to **OR**. `all:mechanistic interpretability`
    was silently read as `all:mechanistic OR all:interpretability` and returned
    papers about neither. Every term is now ANDed. The API echoes its own
    interpretation in the feed title, which is how this was visible at all.
  - OpenAlex's anonymous pool is ~100 requests/day **per IP**. On a server that
    is the whole application's budget, not one user's. `OPENALEX_MAILTO` joins
    the polite pool (~100k/day) and is **not yet set** — see below.

## Needs Neo

- **Neon.** `vercel integration accept-terms` requires an interactive terminal
  and human confirmation, so it cannot be provisioned from here. Dashboard →
  project → Storage → Create Database → Neon (free).
- **Claude in Chrome is not connected**, so the dashboard cannot be driven for
  him either. Extension + side-panel sign-in would fix it.
- **`OPENALEX_MAILTO`** — a contact address raises the OpenAlex limit from
  ~100/day to ~100k/day. Deliberately not defaulted to his address without
  asking, since it is sent to a third party on every search.

- **2026-08-20** — M2 done. Neon connected, Mastra memory persisting, the gate shipped.

  Verified: a second request in the same thread recalls the conversation, and a
  request in a _brand new thread_ still knows the reader's field — that is
  resource-scoped working memory, and it is the feature the whole "memory is
  the moat" idea rests on.

  **Three bugs worth remembering:**
  - `PostgresStore` requires an `id`. Undocumented; without it the constructor
    throws `MASTRA_STORAGE_PG_INITIALIZATION_FAILED` with "id must be provided".
    The skill's verifier had flagged @mastra/pg as unverifiable (not installed
    at the time) — it was right to flag it.
  - The scaffold's placeholder `DATABASE_URL` in `.env` shadowed the real one in
    `.env.local`, so `isStorageConfigured()` returned false and memory was
    silently never attached. Removed the placeholder.
  - **A patch failed silently.** `str.replace()` on a block prettier had
    reformatted matched nothing and reported success, so the memory wiring was
    never actually written while every check passed. Patches now assert their
    target exists first. This cost more time than the other two combined.

- **2026-08-20** — `fetch_paper`. HTML edition (LaTeXML) with an abstract
  fallback. 77 tests passing, 2 network tests gated behind `LIVE=1`.

  **Two things the live fetch taught us:**
  - arXiv's "Report GitHub Issue" modal was landing at the top of every paper's
    extracted text — its form labels, verbatim, ahead of the title. Found by
    printing the first 180 characters of a real fetch. `articleOnly()` now keeps
    only `<article class="ltx_document">`, which is ~4.6 KB of furniture removed
    per paper, on every turn that carries it.
  - **arXiv has backfilled LaTeXML further than harnessXray assumed.** Attention
    Is All You Need (2017) has a full HTML edition. The PDF path is therefore
    much less important than planned — worth deferring rather than building now.

  `OPENALEX_MAILTO` is set to mmv@mit.edu, locally and on Vercel, so the polite
  pool is in effect (~100k/day rather than ~100/day per IP).

- **2026-08-20** — M3 done. The agent researches for real.

  Verified live end to end: `search_papers` → `fetch_paper` → `cite` →
  `bibliography`, producing a correctly attributed two-sentence summary of a
  2026 paper it had never seen before. 35.5k input tokens for that turn, 25.6k
  of them cached.

  **On the citation guarantee:** asked to cite a fabricated paper, the model
  declined _without calling the tool_ — the instructions were enough. That is
  the desired outcome and proves nothing about the structure, so the refusal is
  now tested at the tool layer directly: unretrieved ids, plausible-but-absent
  ids, listed-but-unread papers, and registry isolation between runs.

  `EXCERPT_CHARS` caps a paper at 24k characters in a tool result. A full paper
  is 40–200 KB and a tool result is re-sent on _every_ later turn, so an
  uncapped read would dominate the bill for the rest of the conversation. The
  real fix is a paper-reader subagent with its own context window; the cap is
  what stands in until then.

- **2026-08-20** — M4: it runs without you. A real sweep, end to end, in 75s:
  found papers since the high-water mark, read one, wrote a digest, the gate
  judged it worth sending, and the whole thing was stored with its verdict.
  The digest led with the practice-changing result, gave concrete deltas, and
  named its own caveat unprompted.

  Unauthenticated cron call → 401. Authenticated → runs.

  **Design notes worth keeping:**
  - A *withheld* digest is a successful sweep. `lastSweptAt` advances either
    way, or tomorrow re-reads the same papers to reach the same verdict. Only a
    genuine failure leaves the mark unmoved, so the next run retries.
  - Papers are remembered even when the digest is withheld — the reading
    happened, and forgetting it would mean paying to read them again.
  - `outputProcessors` requires `processToolResult` to be *present*, and
    annotating the return type `: Processor` widens it back to optional, so the
    object stops satisfying the interface it was declared to satisfy. Inferred
    return type, explicitly typed hook args.

## Still needs Neo

- **Resend account** for delivery. Everything up to the send is built; the
  digest is written and stored, it just is not mailed yet.
