# Colophon

> A colophon is the note at the back of a book recording how it was made — the
> press, the typeface, the paper. This project is a research companion that
> records how its own thinking was made.

**Two things in one app:**

1. **Study** — a deep-research agent that follows a field for you. Finds papers,
   reads them, writes reviews, draws real figures, remembers everything it has
   read, and mails you something finished when it has something worth saying.
2. **Lab** — an X-ray of that same agent, running in the browser, for teaching.

Successor/sibling to [harnessXray](https://github.com/NeoVand/harnessXray), which
does the same for Deep Agents. Colophon runs on **Mastra**.

---

## Load-bearing facts

These cost real time to establish. Re-read this file after any context
compaction rather than re-deriving them.

### The capture seam — the whole X-ray hangs off this

`MastraModelConfig` accepts a raw AI SDK model object, and every AI SDK provider
factory takes `fetch?: FetchFunction`. That is the observation port:

```ts
const openai = createOpenAI({ fetch: instrumentedFetch });
new Agent({ model: openai('gpt-5'), tools, skills });
```

**Never use the convenient `model: 'openai/gpt-5'` string form.** It routes
through Mastra's own provider registry and exposes no `fetch` hook — the wire
plane goes dark and the X-ray shows nothing. This is the single easiest way to
silently break the core feature.

### Browser shims (proven against @mastra/core 1.60.0)

`@mastra/core/agent` fails to bundle for a browser with 148 esbuild errors and
closes to zero with the aliases below. 4.3 MB minified, 1.0 MB gzipped.

| Specifier                          | Replacement          | Note                                            |
| ---------------------------------- | -------------------- | ----------------------------------------------- |
| `node:stream/web`                  | web globals          | `ReadableStream` & co. are native — a re-export  |
| `node:async_hooks`                 | ALS shim             | ported from harnessXray verbatim                 |
| `node:path`, `node:path/posix`     | `path-browserify`    |                                                 |
| `node:crypto`                      | webcrypto            | `createHash` needs a tiny FNV/sha impl           |
| `node:events`                      | **real** EventEmitter | Mastra builds a PubSub at module init — a throwing stub is not enough |
| `execa`, `cross-spawn`             | throwing stub        | 67 of the 148 errors; local process sandbox      |
| `node:fs`, `child_process`, `net`… | throwing stubs       | reachable, never executed                        |

**`globalThis.process` needs a four-field stub** (`env`, `platform`, `versions`,
`cwd`) in `app.html`. This is **not** a build-time define — Mastra probes it at
module init, so a `define` cannot reach it. Identical bug and identical remedy to
harnessXray's LangChain issue. Symptom: `ReferenceError: process is not defined`
from `workspace-*.js` at import time.

### Scheduling — do not use Mastra's scheduler

Mastra's built-in scheduler is a `setInterval` tick loop that assumes a
long-lived host process. Its own docs say it does **not** work on Vercel,
Netlify, Lambda or Cloudflare Workers. Platform cron fires a route; the route
starts a workflow. `mastra.schedules` may still hold the *subscriptions* — it is
just not the thing that fires them.

### Durability — do not use Mastra's `DurableAgent`

On serverless it wants Inngest: a third vendor and a third bill. Vercel Workflows
already provides durability. **Outer shape is a Vercel Workflow whose steps each
make one bounded Mastra call** (search → read a paper → draw a figure →
synthesize → send). Each step fits inside the 300 s function limit; the run as a
whole has no limit.

### Platform limits that shape the design

- **Vercel Hobby**: 300 s max function (hard cap), 2 GB / 1 vCPU, cron **once per
  day** with ±59 min precision. The daily limit is not a problem — arXiv
  publishes once a day, so a morning sweep is the correct cadence.
- **Vercel Workflows on Hobby**: 50,000 events/month + 1 GB written included. No
  run-duration limit, no sleep limit. Retention 1 day after completion.
- Natural upgrade is **sideways to Cloudflare Workers Paid ($5)**, not up to
  Vercel Pro ($20). Keep storage behind one interface so that move stays cheap.

### Networking — this must work through hostile proxies

Colophon must be usable from networks that filter AI services. Therefore:

- **All model traffic is proxied through our own origin.** The browser never
  talks to `api.openai.com`. Keys live in server env only and are never sent to
  the client.
- SSE can be **buffered by corporate proxies**, which silently kills token
  streaming while everything else looks healthy. Always set
  `X-Accel-Buffering: no` and `Cache-Control: no-transform`, send a heartbeat
  comment frame, and keep a chunked-poll fallback if the first byte does not
  arrive within a few seconds.

### Authoring — Typst first, LaTeX via WASM

- **Typst is the default authoring format**; it compiles in milliseconds and an
  agent writes it correctly far more often than it writes LaTeX (no "Missing $
  inserted" loops burning tokens).
- **LaTeX compiles in the browser, never on the server.** TeX Live is far too big
  for a 250 MB serverless function. Use SwiftLaTeX (XeTeX/pdfTeX WASM, exact
  TeX Live output) or BusyTeX; `typst.ts` for Typst. Prior art: TeXlyre.
- Agent writes `.typ`/`.tex` into the workspace → browser compiles → PDF to blob
  storage.

### Mastra vs Deep Agents — differences that matter

- Mastra **publishes** what harnessXray had to infer: 87 typed stream chunk types
  and ~35 span types. Far less detective work; the wire plane matters more as the
  honesty anchor.
- **Skills are first class** (`createSkill()`, plus `skill` / `skill_read` /
  `skill_search` tools, `agent.listSkills()`).
- The plan primitive is **incremental** (`task_write` / `task_update` /
  `task_check` / `task_complete`), unlike Deep Agents' last-write-wins
  `write_todos`. Good teaching contrast; keep both explanations.
- A Mastra agent is a **loop, not a graph** — there is no compiled topology to
  read. Draw the loop from introspection (`listConfiguredInputProcessors()`,
  `getToolsForExecution()`, `listSkills()`); draw workflows as real step graphs.
- @mastra/core ships **full source maps with original TypeScript and comments**,
  so the lab can quote real framework source rather than paraphrase it.

---

## Repository rules

**The repo is public. The vault is private.** Research output, reading history,
notes, drafts and any personal content live in blob/database storage and must
**never** enter git. If you add a feature that writes to disk, add its path to
`.gitignore` in the same commit. When in doubt, do not commit it.

Never commit `.env`. Keys are server-side only.

## Conventions

- Match the surrounding code's comment density and naming.
- Comments explain *why*, especially where a decision above is being honoured.
- Every milestone ends in a commit and an update to `docs/PROGRESS.md`.
- Decisions that change the architecture get a dated entry in
  `docs/DECISIONS.md`.
