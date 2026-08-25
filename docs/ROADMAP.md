# What is actually left

**Read this with `STATE.md`.** That file says where things stand; this one says
how far there is to go, and exists because a context compaction lost the answer
once. Neo had to point out that the book is nowhere near the last thing.

## The honest scoreboard

harnessXray ships **21 X-ray panels, 9 cockpit instruments, 10 top-level
components and a 10-chapter book**. Colophon ships **5 panels and 6
components**. It is roughly a third of the surface, and — worse — it is missing
most of the features that would make it a _Mastra_ X-ray rather than a smaller
harnessXray.

Mastra's own headline capabilities, and whether Colophon touches them:

| Capability                             | Entry point                       | Colophon            |
| -------------------------------------- | --------------------------------- | ------------------- |
| Agents, tools, subagents               | `@mastra/core/agent`              | ✅ done             |
| Memory, resource-scoped                | `@mastra/memory`                  | ✅ done             |
| Output processors (refusal)            | `@mastra/core/processors`         | ✅ done             |
| Human-in-the-loop approval             | `requireApproval`                 | ✅ done             |
| **Workflows** — steps, branch, suspend | `@mastra/core/workflows`          | ❌ **none**         |
| **MCP** — tools from outside           | `@mastra/core/mcp`, `@mastra/mcp` | ❌ **none**         |
| **Skills**                             | `@mastra/core/skills`             | ❌ **none**         |
| **Scorers** — measurement              | `@mastra/core/scores`             | ❌ **none**         |
| **Observability / AI tracing**         | `@mastra/core/observability`      | ❌ **none**         |
| Input processors                       | `@mastra/core/processors`         | ❌ none             |
| Vector / semantic recall               | `@mastra/core/vector`             | ❌ none             |
| Schedules                              | `@mastra/core/schedules`          | n/a — see CLAUDE.md |

`createWorkflow`, `createStep`, `cloneWorkflow`, `createSkill`, `wrapMastra`
and `MCPServerBase` are all confirmed present in the installed package. None of
this is speculative.

## Order of work, and why

**1. Workflows.** The single biggest gap, and it pays twice: Mastra's headline
feature, and the thing that finally gives the X-ray a **graph** to draw.
harnessXray's GraphView reads a real LangGraph topology; Mastra's equivalent is
a workflow's step DAG. Deep research is genuinely a pipeline — scope, search,
select, read in parallel, synthesise, verify, deliver — and today it is one
agent loop with no structure to show. Suspend/resume is also the honest home
for approval.

**2. MCP.** Tools from outside the codebase, which is the point of the protocol
and something harnessXray cannot do at all. Needs a UI to add a server, list
what it exposes, and show those tools arriving in the tool panel alongside the
built-ins.

**3. The graph view.** Draws (1). Nodes light as steps commit.

**4. Skills.** `createSkill` — a named, reusable bundle of instructions and
tools. harnessXray has a SkillsPanel; Colophon has nowhere for one.

**5. Scorers.** The counterpart to the delivery gate: **a scorer measures, a
processor refuses.** Having both on screen is the clearest possible statement of
a distinction that Mastra's own docs blur.

**6. Observability.** Mastra emits AI tracing spans. Surfacing them gives a
per-step latency and cost breakdown the chunk stream cannot.

**7. Inspector.** Click an event, unfold its payload — decomposed and raw. The
X-ray currently summarises everything and lets you see nothing.

**8. Threads.** A history list. There is a "new thread" button and no way back
to an old one, which quietly loses work.

**9. Settings.** Bring-your-own-key, and the model picker.

**10. Cockpit.** harnessXray's drawn-instrument mode. Last, because it is a
second presentation of panels that must exist first.

**11. The book.** Chapters and plates. Plates go in `static/book/` and are
committed, exactly as harnessXray does it — they are authored assets, not
generated content, so this does **not** wait on blob storage.

**12. Typst / LaTeX authoring**, and the vault as a document store.

## Standing traps

- Do not use Mastra's scheduler; platform cron only. See `CLAUDE.md`.
- Do not use `DurableAgent`. Vercel Workflows if a sweep outgrows 300s.
- Every model through `model()` or the X-ray goes dark silently.
