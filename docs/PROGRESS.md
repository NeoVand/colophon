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
  - A _withheld_ digest is a successful sweep. `lastSweptAt` advances either
    way, or tomorrow re-reads the same papers to reach the same verdict. Only a
    genuine failure leaves the mark unmoved, so the next run retries.
  - Papers are remembered even when the digest is withheld — the reading
    happened, and forgetting it would mean paying to read them again.
  - `outputProcessors` requires `processToolResult` to be _present_, and
    annotating the return type `: Processor` widens it back to optional, so the
    object stops satisfying the interface it was declared to satisfy. Inferred
    return type, explicitly typed hook args.

## Still needs Neo

- **Resend account** for delivery. Everything up to the send is built; the
  digest is written and stored, it just is not mailed yet.

- **2026-08-20** — the paper-reader subagent. Verified live: two readers ran in
  parallel, each returning ~250 words, and `cite` with `requireRead: true`
  then succeeded for _both_ papers in the parent — provenance crossed the
  delegation boundary while the text did not. 52.9k input, 45.3k cached.

  The reader gets a 200 KB excerpt where the parent gets 24 KB, because its
  context window is discarded when it returns. The cost is paid once instead of
  on every subsequent turn. That asymmetry is the whole reason subagents exist.

  **A bug the bibliography exposed:** the same paper could be keyed by arXiv id
  from a fetch and by URL from a search, because `toSource` looked for the
  arXiv id only in the DOI — OpenAlex often carries a publisher DOI with an
  arXiv landing page. Two registry entries, two library rows. The registry's
  loose matching hid it at citation time, which is exactly why it survived long
  enough to be spotted by reading a bibliography rather than by a test.

  Mastra exposes a subagent as a tool named `agent-<key>` and emits no distinct
  chunk kind for delegation, so that string is the only signal a second context
  window was spent. The projector reads it and tags the event, which is what
  lets the UI draw a lane instead of one more tool chip.

- **2026-08-20** — image generation, gated on approval. Verified end to end:
  gpt-image-2 → 1.72 MB PNG → Postgres bytea → read back with the PNG magic
  number intact, then deleted.

  `generate_image` carries `requireApproval: true`. Every other tool reads;
  this one _spends_, and a loop that decides it wants eight illustrations costs
  real money before anyone notices. What gets approved is the literal prompt the
  model wrote, not a description of one — and the model cannot route around a
  pause it does not control.

  **Two bugs:**
  - drizzle's neon-http driver returns a pg-style `{ fields, rows, … }`, not a
    bare array. Treating it as an array read as "no such blob" — the put
    succeeded, the get returned undefined, and nothing complained. A silent miss
    is the worst shape of bug and it only showed up because the live test
    checked the readback rather than trusting the write.
  - One _low-quality_ 1024×1024 render is 1.72 MB, which settles the storage
    question: 0.5 GB holds about 300 images before the vault has room for
    nothing else. Hence the 64 MB cap and the interface.

- **2026-08-25** — deep research wired end to end, and four dead instruments
  made live. The audit's items 9–12 were one knot: `/api/research` was called
  by no client code, so the workflow, graph and trace panels described a
  pipeline the application never ran.

  The composer's mode now reaches `session.send`, which routes to the pipeline;
  `WorkflowPanel` is mounted with its events, `TracePanel` with real spans, and
  **the graph draws whichever machine is executing** — the pipeline during a
  research run, the agent loop otherwise, read from a new `/api/agent/shape`
  that asks the built agent what it has. Verified on a real 1m 40s run: five
  stages lighting in turn, twenty-four papers in the library with the three the
  writer cited marked as such, 89,479 tokens on the spend bar.

  **Four bugs, every one found by running it rather than by testing it:**
  - The research stream carries two vocabularies on one channel — the
    pipeline's stages and the trace — and the client fed both to the workflow
    reducer. A `trace` frame fell through to the branch reading
    `event.usage.input` and threw, and `consume` put
    `Cannot read properties of undefined (reading 'input')` on screen in place
    of the answer.
  - The graph drew an agent with no memory, always. A child's `onMount` runs
    before its parent's, and the parent is where `session.restore()` mints the
    thread — so the shape was fetched with `?thread=` empty and `getMemory()`
    returned undefined. An `$effect` on the thread replaces the mount.
  - **`workflow-finish` reports all-zero token usage** for a pipeline whose
    steps call `agent.generate()`, and publishes no `workflow-step-output`
    chunks to recover them from. Measured against a throwaway one-step workflow
    that had just spent 345 tokens. The spend panel read "Nothing spent yet"
    after a two-minute paid run. Each agent call now reports its own
    `totalUsage` through a meter injected into the workflow.
  - The library sat on "Nothing retrieved yet" through a run that read three
    papers, because the pipeline's retrieval happens inside a step rather than
    as a tool call, and the projector dropped the step's whole output.

  Also: tracing flipped from opt-in to on-unless-off, `TracePanel` no longer
  defaults to claiming it is configured, and the run panel prints `—` for tools
  during a research turn rather than `0` — the pipeline's tool calls are not on
  this wire, and zero would be a claim rather than a gap.

- **2026-08-25** — the X-ray measured against harnessXray, panel by panel, after
  Neo's note that the context breakdown was thin and the event sidebar "just
  terrible".

  **Events open in place.** The payload expands under the row that names it,
  with the same decomposed/raw pair, instead of a sheet over the app behind a
  blurred scrim. `Inspector.svelte` and the sheet are gone.

  **The context panel gained the three things that made harnessXray's worth
  having**: rows that open onto the actual piece, a raw view of the whole body,
  and a pager across every model call in the turn drawn as one bar per call to
  scale. Measured on a real run — 5,643 → 7,924 → 9,065 → 9,472 → 9,574 tokens
  across five calls, 97% of the last a cache hit. Also grouped into system /
  tool schemas / messages, rows in request order with a share bar rather than
  sorted by size, and a gauge against the model's input window.

  **Figures render in the timeline.** `extract_figures` returning `{ count: 6 }`
  is a true summary and a useless one. Verified against arXiv:2404.14082.

  **A third bug, found by looking**: the harness panel's seven tabs ran off the
  edge of a narrow pane and `mcp` and `trace` were unreachable, 72px past the
  header, with nothing saying so — the audit's failure in a new costume. The
  strip now shows what fits behind a `⋯`, and never hides the tab you are on.

  Two things worth keeping:
  - The in-app preview browser delivers **no `ResizeObserver` callbacks**, not
    even for a direct style change. Anything measured with `bind:clientWidth`
    cannot be seen to reflow there; reload at the new width instead.
  - `sizeOf` counts a string as its own length, not its JSON length, so a
    piece's `chars` and its `text.length` agree for strings and differ for
    objects. Asserted in the tests so nobody "fixes" it into agreement.

## Still needs Neo

- **R2 bucket** — images are in Postgres as a stopgap behind a 64 MB cap
  (~37 images). R2 is 10 GB free with zero egress, which matters because a book
  re-reads its plates on every view. The store is behind an interface, so the
  swap is one file.
- **Resend account** for digest delivery.
