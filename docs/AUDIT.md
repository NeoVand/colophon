# Audit — what actually works

Written 2026-08-20, after Neo's report that the graph was dead, no subagents
were invoked, and "this is kind of like a fake imitation" of harnessXray.

He was right, and the shape of the problem is narrower and more specific than
"built wrong". Almost nothing here is badly built. A great deal of it is **not
connected to anything**, and the app displays it anyway.

## Method

Not by reading. Three passes:

1. Every panel traced to its data source (`grep` for `fetch(` and `session.`),
   then to the props it is actually mounted with in `src/routes/+page.svelte`.
2. Every module in `src/lib/agent/` traced to its importers. A module imported
   only by a panel, and never by `colophon.ts`, describes something the agent
   does not have.
3. The built agent asked what it has, using Mastra's own accessors —
   `listTools()`, `listAgents()`, `listSkills()`, `listScorers()`,
   `getToolsForExecution()`. This is the pass that found the most, because it is
   the only one that cannot be fooled by code that looks finished.

## The single structural finding

**harnessXray's X-ray reads the live agent. Colophon's mostly reads a
description of it.**

`src/lib/agent/graph.ts` in harnessXray calls `getGraphAsync({ xray: true })` on
the running agent and gets the _compiled_ Pregel graph: real middleware node
names, real conditional edges, subagents expanded inline. `GraphView` reloads it
whenever `session.agentVersion` changes, lights each node from `node` events as
they arrive, accumulates visit counts, and a click jumps the timeline to what
that node last did. The map and the territory are the same object.

Colophon's graph fetches `serializedStepGraph` from a **research workflow the
chat agent never runs**, once, at mount. Its "which node is lit" is inferred by
matching tool-call names against workflow step ids, which never match. It is
dead by construction in every ordinary conversation, and no amount of polish on
the drawing would change that.

That difference is not entirely Colophon's fault — LangGraph compiles a graph
you can read back and Mastra does not — but the response to that should have
been to draw what Mastra _does_ expose, not to draw something else and leave it
inert.

## Panel by panel

| Panel            | Source                                 | Live in a chat run?                             |
| ---------------- | -------------------------------------- | ----------------------------------------------- |
| Events timeline  | `session.events`                       | yes                                             |
| Inspector        | timeline selection                     | **yes, since today** — was mounted nowhere      |
| Context          | `session.context`, off the tee'd fetch | yes                                             |
| Run              | `session.usage`, `session.events`      | yes                                             |
| Spend            | `session.usage`                        | yes                                             |
| Library          | `session.papers`                       | yes                                             |
| Figures          | `session.turns`                        | yes                                             |
| Documents        | `/api/documents`                       | yes                                             |
| Crew (subagents) | `session.turns[].tools[].subagent`     | yes, when a reader runs                         |
| Tools            | `/api/tools`                           | yes — **was undercounting by half**             |
| Memory           | `/api/memory`                          | yes                                             |
| Skills           | `session.turns` + `SKILL_CARDS`        | **was impossible** — skills were never attached |
| MCP              | `/api/mcp`                             | listed servers the agent **could not call**     |
| Graph            | `/api/graph`, a workflow               | **no** — draws something that never runs        |
| Workflow         | `events` prop                          | **no** — mounted with no events, ever           |
| Trace            | `spans` prop                           | **no** — mounted with no spans, ever            |

## Findings, and what was done

### Fixed

1. **Skills were never attached.** `COLOPHON_SKILLS` was written, documented,
   unit-tested, exported — and never passed to `new Agent()`. No `skill` tool
   reached any request. The opening screen counted them and `SkillsPanel` listed
   them, so the app advertised two capabilities the model had no way to use.
2. **Scorers were never attached.** `COLOPHON_SCORERS` was imported by nothing
   at all.
3. **MCP tools were never attached.** `toolsForAgent()` was written for exactly
   this and called by nobody, so `MCP_SERVERS` populated a panel of servers the
   agent could not reach — worse than the feature being absent, because it is
   indistinguishable from it working.
4. **The tools panel undercounted the per-call charge by more than half.** It
   assembled its answer from the tool factories, imported one of the three and
   never called it, and could not see the tools Mastra mints. Reported: 6 tools,
   5,900 characters. Actual: 12 tools, 13,306 characters — and the single
   largest line item is `agent-paperReader`, the one it declared uncountable.
   It now measures `getToolsForExecution()`, which is the sender's own object.
5. **The opening screen's counts were literals, and wrong.** "5 tools" against a
   real eleven; "2 skills" against zero attached. Under a comment promising that
   a wrong number there is worse than none.
6. **The inspector was mounted nowhere and the timeline had no selection.** The
   one thing an X-ray is for — getting behind a summary to the object — could
   not be done.
7. **A second approval mid-stream was silently dropped**, stranding the run and
   producing `resumeStream() cannot resume tool call … because it is not
suspended`. This is the error in Neo's screenshot.
8. **The cockpit is removed**, at his call.

### Open

9. **The graph draws the wrong subject.** See above. The fix is to draw the
   agent — model, its real tools, its subagents, its memory — from the built
   agent, and light it from `tool-call` events, which carry names that do match.
10. **`WorkflowPanel` is mounted with no `events`** and can only ever say
    "Nothing has run yet".
11. **`TracePanel` is mounted with no `spans`**, and defaults `configured` to
    true — so it reports tracing as on and idle when it is simply not wired.
12. **The composer's "Deep research" mode is bound to nothing.** `/api/research`
    is called by no client code. Toggling it changes a chip and nothing else,
    which is also why 9–11 are dead: the workflow those three panels describe is
    never run by the application.

Items 9–12 are one knot. Wiring the research mode to `/api/research` makes the
workflow and graph panels live and gives the trace something to collect.

## On forking harnessXray instead

Neo's regret is reasonable and the honest answer is mixed.

A fork would not have carried the graph across: harnessXray's best instrument
depends on LangGraph handing back a compiled topology, and Mastra has no
equivalent. That panel would have had to be rebuilt for Mastra either way.

But a fork would have inherited something this repo lacked, which is the actual
cause of every finding above: **harnessXray's panels are mounted, and driven
from one session store.** There is no equivalent there of a finished component
imported by nothing, because the arrangement grew from working parts rather than
being written alongside them.

The failure here is not the rewrite. It is that features were built to
completion, documented, tested in isolation, and never connected — and that
nothing in the build checked. Unit tests all passed; types were all fine; the UI
looked finished. `colophon.spec.ts` now asks the built agent what it has, which
is the only check that catches this class of thing.

Restarting from a fork now would throw away work that is genuinely good — the
citation guarantee, the context decomposition off the real wire, the capture
seam — to fix a wiring problem, at the cost of everything already spent. The
cheaper path is the one this audit lays out: connect what exists, delete what
should not, and keep the test that makes "defined but not attached" fail.
