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
- [ ] Browser shim set ported and a Mastra agent bundles under Vite
- [ ] A real streamed Mastra run in a browser tab
- [ ] A real streamed Mastra run from a Vercel function (measure bundle vs 250 MB)
- [ ] SSE survives a buffering proxy (or the fallback does)
- [ ] A Mastra skill authored for this repo

## Log

- **2026-08-19** — repo created, scaffold complete.
