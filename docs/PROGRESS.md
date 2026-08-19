# Progress

Updated as milestones land. After a context compaction, read this first.

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Three spikes: browser run, Vercel deploy, SSE through a proxy | in progress |
| M1 | Skeleton: SvelteKit + auth + proxied model access | not started |
| M2 | Storage behind one interface (Postgres + blob) | not started |
| M3 | The research agent (interactive) | not started |
| M4 | It runs without you: subscriptions, cron, scorer gate, email | not started |
| M5 | The X-ray: wire plane, event taxonomy, ported panels | not started |

## M0 gates

- [x] Scaffold SvelteKit with ai-tools, better-auth, drizzle/neon, vercel adapter
- [x] `CLAUDE.md` written with the load-bearing facts
- [x] Browser shim set ported and a Mastra agent bundles under Vite
- [x] A real streamed Mastra run (server-side, SSE) — `/api/agent/stream`
- [ ] A real streamed Mastra run from a Vercel function (measure bundle vs 250 MB)
- [ ] SSE survives a buffering proxy (or the fallback does)
- [x] A Mastra skill authored for this repo (`.claude/skills/mastra/SKILL.md`, 418 lines)

## Log

- **2026-08-19** — repo created, scaffold complete.
- **2026-08-19** — browser gate passes 7/7 at `/lab/probe`, in a real Chrome tab:
  module graph initialises, agent constructs, tools/instructions/model resolve
  through the fetch seam, sha256 shim matches the NIST vector.
  Two findings beyond the original esbuild probe:
  `@ast-grep/napi` (a native N-API addon) must be stubbed, and Vite's dep
  pre-bundler runs a *separate* esbuild pass that needs the shim table too.
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
