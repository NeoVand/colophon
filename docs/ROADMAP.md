# What is actually left

**Read this with `STATE.md`.** That file says where things stand; this one says
how far there is to go, and exists because a context compaction lost the answer
once. Neo had to point out that the book is nowhere near the last thing.

## The honest scoreboard

_Rewritten 2026-08-25. The table below had gone stale in the worst direction —
it reported four capabilities as absent that had shipped, which is the same
class of wrong readout the audit is about, in a document rather than a panel._

harnessXray ships **21 X-ray panels, 9 cockpit instruments, 10 top-level
components and a 10-chapter book**. Colophon ships **16 panels**, all of them
mounted and driven from one session store.

Mastra's own headline capabilities, and whether Colophon touches them:

| Capability                             | Entry point                       | Colophon                                                                               |
| -------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| Agents, tools, subagents               | `@mastra/core/agent`              | ✅ done                                                                                |
| Memory, resource-scoped                | `@mastra/memory`                  | ✅ done                                                                                |
| Output processors (refusal)            | `@mastra/core/processors`         | ✅ done                                                                                |
| Human-in-the-loop approval             | `requireApproval`                 | ✅ done                                                                                |
| **Workflows** — steps, branch, suspend | `@mastra/core/workflows`          | ✅ done — run from the composer                                                        |
| **MCP** — tools from outside           | `@mastra/core/mcp`, `@mastra/mcp` | ✅ attached                                                                            |
| **Skills**                             | `@mastra/core/skills`             | ✅ attached                                                                            |
| **Scorers** — measurement              | `@mastra/core/scores`             | ✅ attached                                                                            |
| **Observability / AI tracing**         | `@mastra/core/observability`      | ⚠️ spans recorded and drawn; Mastra's own exporter still needs `@mastra/observability` |
| Input processors                       | `@mastra/core/processors`         | ❌ none — the graph draws them the day there are any                                   |
| Vector / semantic recall               | `@mastra/core/vector`             | ❌ none                                                                                |
| Schedules                              | `@mastra/core/schedules`          | n/a — see CLAUDE.md                                                                    |

`createWorkflow`, `createStep`, `cloneWorkflow`, `createSkill`, `wrapMastra`
and `MCPServerBase` are all confirmed present in the installed package. None of
this is speculative.

## Order of work, and why

_Items 1–7 have landed. What is left, in order:_

**1. The book.** Ten chapters of prose and no plates. Chalk-on-black house
style — `docs/BOOK.md`. Plates go in `static/book/` and are committed, exactly
as harnessXray does it: they are authored assets, not generated content, so this
does **not** wait on blob storage. **Neo reviews every plate before it ships.**

**2. A surface for digests and subscriptions.** They exist in the database, run
on a daily cron, and have no UI at all — which is the same shape of gap the
audit was about, seen from the other side: a feature that works and cannot be
seen.

**3. Settings.** Bring-your-own-key, and the model picker (`model` in
`+page.svelte` is bound to a sheet and reaches no request yet — the one binding
of that kind left).

**4. Typst / LaTeX authoring**, and the vault as a document store.

**5. Input processors.** The one Mastra headline still untouched. The graph
already draws a rank for them, so the day one is configured it appears with no
edit to the drawing.

**6. Mastra's own tracing spans.** The hand-recorded trace is real and useful,
but `@mastra/core` alone ships `NoOpObservability`. Installing
`@mastra/observability` and passing an `Observability` to `new Mastra({...})`
makes `attachTracing()` start filing Mastra's spans into the same store, beside
the ones the endpoints record, with no other change.

**7. Cockpit.** harnessXray's drawn-instrument mode. Removed at Neo's call once;
only worth revisiting if he asks.

## Standing traps

- Do not use Mastra's scheduler; platform cron only. See `CLAUDE.md`.
- Do not use `DurableAgent`. Vercel Workflows if a sweep outgrows 300s.
- Every model through `model()` or the X-ray goes dark silently.
