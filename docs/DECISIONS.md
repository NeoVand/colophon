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

## 2026-08-25 — The graph draws whichever machine is running

The graph panel drew the deep-research workflow's step graph, always — including
during ordinary chat turns, which never execute that workflow. It lit nodes by
matching `tool-call` names against workflow step ids, which cannot match. A
correct picture of the wrong subject, and dead by construction in every normal
run.

The fix is not to pick one subject. **The panel draws the machine that is
executing**: the pipeline while deep research is in flight, the agent loop the
rest of the time. Both are readings of the live system — `/api/graph` returns
`serializedStepGraph`, and the new `/api/agent/shape` returns what the built
agent answers to `getModel()`, `getToolsForExecution()`, `listAgents()`,
`listSkills()` and `getMemory()`. Neither is a diagram anyone maintains.

An agent has no compiled topology — it is a loop, and the loop lives in the
framework. So `agent-topology.ts` assembles the ranks, but every part is
measured, and the back edge a rank-ordered drawing cannot express is written out
as its own row: _back to the model, while it keeps calling tools_.

## 2026-08-25 — Tracing is on unless it is turned off

`COLOPHON_TRACING` used to be opt-in, on the argument that "no configuration, no
spans" cannot surprise anyone. That was written when spans went into a module
store and nothing read them. They are now streamed to the panel that exists to
draw them and dropped when the run leaves the screen, so there is no
accumulation to be surprised by — and what opt-in actually bought was a finished
instrument that showed nothing until you found an undocumented environment
variable. `COLOPHON_TRACING=off` remains, as a kill switch.

## 2026-08-25 — The research pipeline counts its own tokens

Measured, not assumed: a one-step workflow whose step calls `agent.generate()`
finishes with `workflow-finish → output.usage` all zeros, having just spent 345
tokens, and publishes no `workflow-step-output` chunks — so there is no nested
agent feed to recover them from either. Mastra counts steps it runs itself; an
agent called inside an `execute` body is opaque to it.

The consequence was a spend panel reading "Nothing spent yet" after a
two-minute paid run, which is a wrong readout rather than an empty one. Each
agent call now reports its own `totalUsage` through a `meter` injected into
`createResearchWorkflow` — the same pattern, and for the same reason, as the
source registry — and `/api/research` sums them and replaces the engine's zeros.
It steps aside if a later Mastra ever reports a real number.

## 2026-08-25 — A payload opens where it was clicked, not over the app

Clicking an event row opened a right-hand sheet with a blurred scrim behind it.
That is a tempting default and it is wrong here: **it took the run off screen in
order to show a piece of the run.** The question you have while reading a
payload is what came before and after it, and a modal answers it by hiding the
answer; a scrim says "finish here, then go back", which is the wrong shape for
scanning a hundred events.

The detail expands under the row instead, capped and scrolling inside itself so
a two-hundred-kilobyte tool result cannot push the timeline off the panel. Two
events can now be compared by opening both. `Inspector.svelte` and the sheet
were deleted rather than left imported by nothing.

## 2026-08-25 — The context panel's text is fetched, not streamed

The panel could name a piece and never show it. The obvious fix — carry each
piece's text on the event stream — is wrong: the pieces of a request _are_ the
request, so a decomposition carrying text is the request sent twice, on every
call, whether or not anyone opens a row. A twelve-call research turn would push
megabytes to draw a list of labels.

So the stream stays light and `/api/context` serves the one call on screen,
decomposing the same captured body again with `text: true`. There is no second
source of truth — only a second reading of the first, which is why piece ids are
deterministic from the body and the two sides match on id alone.

The cost is a store: the wire capture is now filed under the thread and held
past the request that made it, bounded, in memory, exactly like the trace store.
A call from before a cold start is gone, and the endpoint 404s with a sentence
rather than returning something plausible.

## 2026-08-25 — A tab strip that admits when it does not fit

The harness panel carries seven tabs. On a narrow pane `mcp` and `trace` ran off
the right edge and were unreachable — measured at 72px past the header — with
nothing on screen saying so. That is the audit's failure in a new costume: a
control that is silently absent.

Show what fits, put the rest behind one `⋯` that exists only when something is
hidden, and never hide the active tab. Horizontal scrolling was rejected (it
hides the overflow behind a gesture nobody makes on a desktop instrument) and so
was icons-only (it throws away the labels that make an unfamiliar panel
findable). The widths are measured off a hidden twin rather than counted in
characters, because the labels are text in a variable font and the pane is a
drag handle away from any width at all.

The arithmetic lives in `$lib/xray/tabs` and is tested; the component only
measures and draws. **Note for verifying**: the in-app preview browser delivers
no `ResizeObserver` callbacks at all — not even for a direct style change — so
dragging a divider there will not reflow the strip. A reload at the new width
measures correctly, and a real browser needs neither.
