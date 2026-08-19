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
