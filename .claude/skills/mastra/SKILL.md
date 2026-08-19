---
name: mastra
description: Use when writing or debugging Mastra 1.x code — agents, tools, workflows, memory/storage, agent skills, subagents, scorers, processors, or run observability and stream chunks.
---

# Mastra 1.x

Verified against `@mastra/core@1.60.0`, `@mastra/memory@1.27.0`, `@mastra/pg@1.21.0` (Aug 2026).

## RULE 0 — Colophon must build its model as an AI SDK object

Colophon captures the raw wire by injecting a custom `fetch`. That hook exists **only** on an AI SDK provider object.

```ts
import { createOpenAI } from '@ai-sdk/openai'
const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY, fetch: captureFetch })

new Agent({ id: 'colophon', name: 'Colophon', instructions: '…', model: openai('gpt-5') })  // ✅

model: 'openai/gpt-5'                 // ❌ NEVER — model-router string
model: { id: 'openai/gpt-5', apiKey } // ❌ NEVER — OpenAICompatibleConfig
```

Both wrong forms route through Mastra's provider registry, which builds its own HTTP client and **exposes no `fetch` hook** — wire capture silently stops, with no error and no failing test. Same rule everywhere a model is named: `structuredOutput.model`, scorer `judge.model`, `Memory` embedders, subagent models. Model strings like `'openai/gpt-5.6-sol'` below are copied from upstream docs — substitute `openai('gpt-5')`.

## Imports

| What | From |
|---|---|
| `Agent` / `createTool` / `Mastra` | `@mastra/core/agent` · `@mastra/core/tools` · `@mastra/core` |
| `createWorkflow`, `createStep`, `mapVariable`, `createWorkflowStateReader` | `@mastra/core/workflows` |
| `Memory` · `MastraCompositeStore` | `@mastra/memory` · `@mastra/core/storage` |
| `LibSQLStore`, `LibSQLVector` | `@mastra/libsql` |
| `PostgresStore`, `PgVector`, `WorkflowsPG` | `@mastra/pg` (**not** `PgStore` — docs are wrong) |
| `createSkill` · `Workspace`, `WORKSPACE_TOOLS` | `@mastra/core/skills` · `@mastra/core/workspace` |
| `Processor`, `ChunkType` (types) · `createScorer` | `@mastra/core/processors` · `@mastra/core/evals` |
| `SpanType` · `Observability`, `MastraStorageExporter`, `SpanOutputProcessor`, `AnySpan` | `@mastra/core/observability` · `@mastra/observability` |

## Define an agent

Required: `id`, `name`, `instructions`, `model`. Optional: `description`, `tools`, `agents`, `workflows`, `skills`, `memory`, `hooks`, `defaultOptions`, `scorers`, `goal`, `inputProcessors`/`outputProcessors`/`errorProcessors`, `maxProcessorRetries`, `requestContextSchema`, `maxRetries`. Most accept `DynamicArgument<T>` = `T | (({ requestContext }) => T | Promise<T>)`.

```ts
export const agent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: 'Use weatherTool for current conditions.',
  model: openai('gpt-5'),
  tools: { [weatherTool.id]: weatherTool },   // key = the toolName seen in streams/traces
  memory: new Memory({ storage }),
  hooks: {
    beforeToolCall: ({ toolName, input }) => ({ proceed: true }),  // { proceed:false, output } short-circuits
    afterToolCall: ({ toolName, output, error }) => {},
  },
})
```

Methods: `generate`, `stream`, `resumeGenerate`, `resumeStream`, `approveToolCall(Generate)`, `declineToolCall(Generate)`, `listSuspendedRuns`, `getSkill`, `listSkills`, `getMemory`, `streamUntilIdle`, `generateLegacy`/`streamLegacy` (AI SDK v4 only).

## Add tools

```ts
export const weatherTool = createTool({
  id: 'weather-tool',
  description: 'Fetches weather for a location',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ location: z.string(), temperatureCelsius: z.number() }),
  execute: async ({ location }, { abortSignal, requestContext, agent, writer }) => {
    return { location, temperatureCelsius: 21 }
  },
})
```

`execute(input, context)` — **validated input is the first arg**, destructured directly. The old `({ context, runtimeContext })` shape is gone; the context arg carries `requestContext` (not `runtimeContext`), `abortSignal`, `agent`, `workflow`, `mcp`, `observe`, `writer`.

Other params: `strict`, `toModelOutput`, `transform`, `suspendSchema`, `resumeSchema`, `requireApproval`, `requestContextSchema`, `providerOptions`, `inputExamples`, `background`, `mcp`, plus `onInputStart`/`onInputDelta`/`onInputAvailable`/`onOutput`. Schemas are Standard JSON Schema (Zod/ArkType direct).

Emit into the stream from a tool — the `await` is mandatory or you get `WritableStream is locked`:

```ts
await context?.writer?.custom({ type: 'data-progress', data: { pct: 50 }, transient: true }) // top-level chunk
await context?.writer?.write({ … })   // nested under a `tool-output` chunk
```

## Run an agent

Both are async — `await` before touching `.textStream` / `.fullStream` / `.runId`.

```ts
const res    = await agent.generate(messages, opts)
const stream = await agent.stream(messages, opts)   // MastraModelOutput
```

| Option | Notes |
|---|---|
| `modelSettings` | `temperature`, `maxOutputTokens` (**not** `maxTokens`), `topP`, `maxRetries`, `timeout:{totalMs,stepMs}`, `stopSequences` |
| `maxSteps`, `stopWhen`, `prepareStep` | agentic-loop control |
| `toolChoice` | `'auto'\|'none'\|'required'\|{type:'tool',toolName}` |
| `activeTools`, `toolsets`, `clientTools`, `toolCallConcurrency` | tool surface |
| `memory` | `{ resource, thread }`; thread may be `{ id, title, metadata }` |
| `structuredOutput`, `requireToolApproval`, `autoResumeSuspendedTools` | see below |
| `requestContext`, `providerOptions`, `instructions`/`system`, `runId`, `savePerStep`, `abortSignal` | |
| `onChunk`, `onStepFinish`, `onFinish`, `onError`, `onAbort` | callbacks |
| `scorers`, `tracingOptions`, `hooks`, `inputProcessors`/`outputProcessors` | per-call processors **replace** the agent's array |

## Structured output

```ts
const res = await agent.generate('Plan my day.', {
  structuredOutput: {
    schema: z.object({ name: z.string() }),
    errorStrategy: 'fallback',      // 'strict' (default, throws) | 'warn' | 'fallback'
    fallbackValue: { name: '' },
    jsonPromptInjection: 'auto',
  },
})
res.object
```

Streaming: `await stream.object`, or watch `chunk.type === 'object-result'` on `fullStream`. Omit `structuredOutput.model` unless you want a second LLM call (a structuring agent); add `useAgent: true` if that model must also see memory. `options.output` is deprecated; `experimental_output` exists only on the legacy v4 paths.

## Human-in-the-loop (tool approval)

```ts
const del = createTool({ id: 'delete-record', requireApproval: true, /* … */ })

const stream = await agent.stream('Delete abc-123', {
  requireToolApproval: ({ toolName }) => /^delete_/.test(toolName),
})
for await (const c of stream.fullStream) {
  if (c.type === 'tool-call-approval') {
    const next = await agent.approveToolCall({ runId: stream.runId, toolCallId: c.payload.toolCallId })
    for await (const t of next.textStream) process.stdout.write(t)   // MUST consume the NEW stream
  }
}
await agent.declineToolCall({ runId, reason: 'not allowed' })
```

`generate()` path: `requireToolApproval: true` → `finishReason === 'suspended'` + `suspendPayload {toolCallId, toolName, args}` → `approveToolCallGenerate({ runId, toolCallId })` / `declineToolCallGenerate({ …, reason })`.

Suspend from inside a tool to ask for data:

```ts
const { resumeData, suspend } = context?.agent ?? {}
if (!resumeData) return await suspend({ question: 'Which city?' })   // must `return` — suspend() does not throw
```
→ chunk `tool-call-suspended` (`chunk.payload.suspendPayload`) → `agent.resumeStream({ location: 'London' }, { runId })`. After a restart: `agent.listSuspendedRuns({ threadId, resourceId })` → `{ runs, total }`. HITL needs storage on the `Mastra` instance, else "snapshot not found"; snapshots are deleted when the run finishes.

## Add memory

```ts
new Memory({
  storage: new LibSQLStore({ id: 's', url: 'file:/abs/path/local.db' }),
  vector:  new LibSQLVector({ id: 'v', url: 'file:/abs/path/local.db' }),
  embedder: openai.embedding('text-embedding-3-small'),   // AI SDK object, per RULE 0
  options: {
    lastMessages: 10,                                     // number | false; default 10
    semanticRecall: { topK: 3, messageRange: 2, scope: 'resource' },
    workingMemory: { enabled: true, scope: 'resource', schema: z.object({ name: z.string().optional() }) },
    generateTitle: true,
  },
})

await agent.generate('hi', { memory: { thread: 'thread-123', resource: 'user-456' } })
```

| Concept | Facts |
|---|---|
| Scope | `workingMemory.scope` and `semanticRecall.scope` both default to **`'resource'`** — omitting `resource` in the call throws at runtime |
| Working memory | `template` (Markdown, **replace** semantics) XOR `schema` (**deep-merge**; arrays replace, `null` deletes). Mutually exclusive in the types |
| Write tool | `updateWorkingMemory` (→ `setWorkingMemory` when `useStateSignals: true`, experimental) |
| Semantic recall | needs `vector` + `embedder`; defaults `topK: 4`, `messageRange: {before:1, after:1}`; `filter` uses Mongo ops on metadata frozen at embed time |
| Query APIs | `memory.recall({ threadId, vectorSearchString, threadConfig })`, `listThreads`, `getThreadById`, `createThread`, `updateWorkingMemory`, `cloneThread`, `deleteMessages` |
| Resource scope needs | `mastra_resources` support: libSQL, PostgreSQL, OracleDB, Upstash, MongoDB only |

## Storage

Domains: `memory, workflows, observability, scores, datasets, experiments, backgroundTasks, schedules, threadState`. Configure Mastra-wide (`new Mastra({ storage })`) or per-`Memory` to override for one agent. Split domains across adapters with `new MastraCompositeStore({ id, default, domains: { workflows: new WorkflowsPG({ connectionString }) } })` — the composite class comes from `@mastra/core/storage` while the per-domain classes (`WorkflowsPG`, `MemoryPG`, …) come from the adapter package.

Serverless Postgres (Neon/Supabase/RDS) uses `PostgresStore` — there is no `@mastra/neon`. Documented pattern: init once unpooled, then run pooled with `disableInit: true`.

```ts
await new PostgresStore({ id: 'init', connectionString: process.env.DATABASE_URL_UNPOOLED! }).init()
new PostgresStore({ id: 'app', connectionString: process.env.DATABASE_URL!, disableInit: true })
```

Every adapter constructor takes a required `id`. `@mastra/pg` uses the node `pg` driver — Node runtime only, not edge.

## Write a workflow

```ts
const step1 = createStep({
  id: 'step-1',
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ value: z.number() }),
  // also: resumeSchema, suspendSchema, stateSchema (subset of workflow's), retries, scorers
  execute: async ({ inputData, state, setState, suspend, resumeData, suspendData, getStepResult,
                    getInitData, mastra, runId, requestContext, retryCount }) => ({ value: inputData.value + 1 }),
})

export const wf = createWorkflow({ id: 'wf', inputSchema, outputSchema, stateSchema })
  .then(step1).then(step2)
  .parallel([a, b])                                       // output keyed by step id
  .branch([[async ({ inputData }) => inputData.v > 10, stepA],
           [async ({ inputData }) => inputData.v <= 10, stepB]])
  .dowhile(step, async ({ inputData, iterationCount }) => inputData.n < 10)   // dountil = loop until true
  .foreach(step, { concurrency: 4 })
  .map(async ({ inputData, getStepResult, getInitData }) => ({ bar: inputData.foo }))
  .commit()                                               // MANDATORY, must be last
```

Schema chain: first step input = workflow input; last step output = workflow output; each step's output must satisfy the next step's input, else insert `.map()`.

`createWorkflow` also takes `requestContextSchema`, `schedule`, and `options`: `tracingPolicy`, `validateInputs`, `shouldPersistSnapshot`, `pruneSnapshot`, `onStart`, `onFinish`, `onError`. Only `onStart` propagates thrown errors (it rejects `start()`/`stream()`) and it does not fire on resume/restart. `createStep(agent, { structuredOutput })` wraps an agent — **step id is the agent's name**, input `{ prompt }`, output `{ text }`. A committed workflow is usable anywhere a step is: `.foreach(wf)`, `.parallel([wfA, wfB])`, nesting.

```ts
const run = await workflow.createRun({ runId?, resourceId?, disableScorers? })   // async!
const result = await run.start({ inputData, initialState, requestContext, outputOptions: { includeState: true } })
// result.status: 'success' | 'failed' | 'suspended' | 'tripwire'

const stream = await run.stream({ inputData, closeOnSuspend: false })
for await (const chunk of stream.fullStream) { /* workflow-step-start | -output | -progress | -result */ }
const final = await stream.result   // also stream.usage, stream.status
```

### Suspend, resume, state

```ts
execute: async ({ resumeData, suspendData, suspend }) => {
  const { approved } = resumeData ?? {}
  if (!approved) return await suspend({ reason: 'approval required' })
  return { output: `ok ${suspendData?.reason}` }
}
await run.resume({ step: result.suspended[0], resumeData: { approved: true }, forEachIndex: 0 })
```

`result.suspended` is an array of **paths** (e.g. `['nested-workflow','step-1']`); pass one element straight to `step`. Recover from storage: `workflow.getWorkflowRunById(id)` → `createWorkflowStateReader(state)` → `.getSuspendedStep()` / `.getResumeLabel(label)`, then `workflow.createRun({ runId: state.runId })`. `.sleep(ms)`/`.sleepUntil(date)` give status `waiting`, distinct from `suspended`.

Workflow state is a shared store outside the input/output flow; it survives suspend/resume and propagates into nested workflows. Seed with `run.start({ inputData, initialState: { count: 0 } })`.

```ts
execute: async ({ state, setState }) => { await setState({ ...state, count: state.count + 1 }); return {} }
```

## Add a skill

```ts
import { createSkill } from '@mastra/core/skills'

const codeReview = createSkill({
  name: 'code-review',                     // slug; name/description/instructions required or it throws
  description: 'Reviews diffs for correctness.',
  instructions: '# Code review\n…',
  references: { 'checklist.md': '…' },     // served by the skill_read tool
  'user-invocable': true,                  // hyphenated — must be quoted in TS
})

new Agent({ id: 'reviewer', model: openai('gpt-5'), skills: [codeReview, './skills/testing'] })
```

Agent `skills` is `SkillInput[]`: inline skill objects, directory/`SKILL.md` paths, or an async resolver `({ requestContext, tracingContext }) => SkillInput[]` (runs once per RequestContext inside a `resolve-skills` span). Workspace `skills` is **paths only** (`string[]`, globs allowed) — passing a `createSkill()` object there is wrong.

Whenever any skills exist, three tools auto-register: `skill` (activate by name or full path), `skill_read` (one file from `references/`|`scripts/`|`assets/`), `skill_search`. They are stateless — re-call `skill` after compaction. Programmatic: `agent.getSkill(name)`, `agent.listSkills()`. On-disk `SKILL.md` = YAML frontmatter (`name`, `description`, optional `version`, `tags`) + body, with sibling `references/`, `scripts/`, `assets/`. Precedence: agent-level beats workspace; local > managed (`.mastra/`) > external (`node_modules/`).

## Subagents

```ts
const research = new Agent({ id: 'research-agent', description: 'Gathers facts.', model: openai('gpt-5-mini') })
const parent = new Agent({ id: 'parent', model: openai('gpt-5'), agents: { researchAgent: research }, memory })

await parent.stream('...', {
  maxSteps: 10,
  onIterationComplete: async () => ({ continue: true }),   // TOP-LEVEL, not under delegation
  delegation: {
    onDelegationStart: async c => ({ proceed: true, modifiedPrompt: `${c.prompt}\nBe brief.`, modifiedMaxSteps: 5 }),
    onDelegationComplete: async c => (c.error ? (c.bail(), { feedback: `failed` }) : { resultText: '...' }),
    messageFilter: ({ messages }) => messages.slice(-10),
    hookErrorStrategy: 'throw',
    includeSubAgentToolResultsInModelContext: true,
  },
})
```

Subagents surface as tools named `agent-<key>`, workflows as `workflow-<key>`. `backgroundTasks.tools` is keyed by the record **key**; `context.primitiveId` and `versions.agents` use the agent **`id`**.

## Gate output

`scorers: {}` on an agent or workflow step is **observability only** — it runs async and never blocks the response. To actually gate:

**(a) Output processor `abort()`** — the real guardrail.

```ts
import type { Processor, ChunkType } from '@mastra/core/processors'

export class Guard implements Processor {
  id = 'guard'
  async processOutputStream({ part }): Promise<ChunkType | null> {
    if (part.type === 'text-delta' && part.payload.text.includes('secret')) return null  // drops ONE chunk
    return part                                    // forgetting this deletes the whole stream
  }
  async processOutputStep({ text, abort, retryCount }) {
    if (!ok(text) && retryCount < 3) abort('Too vague', { retry: true, metadata: { kind: 'quality' } })
    return []
  }
}
```

`abort()` throws `TripWire`: streams emit `{ type:'tripwire', payload:{ reason, retry, metadata, processorId } }`; `generate()` gives `result.tripwire` with `finishReason === 'other'`. `retry: true` needs `maxProcessorRetries` on the agent/call (it defaults to 10 only when `errorProcessors` are configured).

Processor hooks: `processInput`, `processInputStep`, `processLLMRequest` (transient, never persisted), `processLLMResponse`, `processOutputStream`, `processOutputStep`, `processOutputResult`, `processAPIError`. `state` is per-request, keyed by processor `id`, shared across the three output hooks.

**(b) Agent `goal: { judge, maxRuns, prompt?, scorer? }`** — scores each loop iteration and stops/continues, emitting a `goal` chunk.

**Scorers** (measurement, not gating):

```ts
import { createScorer } from '@mastra/core/evals'

const sources = createScorer({ id: 'sources', description: 'Has sources',
  judge: { model: openai('gpt-5-mini'), instructions: 'Be strict.' } })
  .analyze({ description: 'Detect sources', outputSchema: z.object({ hasSources: z.boolean() }),
             createPrompt: ({ run }) => `Sources present?\n${run.output}` })
  .generateScore(({ results }) => (results.analyzeStepResult.hasSources ? 1 : 0))   // REQUIRED step

const r = await sources.run({ input, output })   // r.score, r.analyzeStepResult, r.reason
```

Chain `.preprocess()` → `.analyze()` → `.generateScore()` (required) → `.generateReason()`. Each step is a function OR a prompt object; the `judge` LLM runs only for prompt objects. Prompt-mode `generateScore` **also requires** `calculateScore({ run, results, analyzeStepResult }) => number`.

## Observe a run

```ts
import { SpanType } from '@mastra/core/observability'
import { Observability, MastraStorageExporter } from '@mastra/observability'

new Mastra({ observability: new Observability({ configs: { default: {
  serviceName: 'colophon',
  sampling: { type: 'ratio', probability: 0.1 },        // tracing uses `probability`
  excludeSpanTypes: [SpanType.MODEL_CHUNK],
  spanOutputProcessors: [new Lower()],                  // sync only: process(span): AnySpan
  spanFilter: span => span.type !== SpanType.TOOL_CALL,
  exporters: [new MastraStorageExporter()],
} } }) })
```

Export order: internal spans dropped → `excludeSpanTypes` → `spanOutputProcessors` → `spanFilter`. Child spans: `context?.tracingContext.currentSpan?.createChildSpan({ type:'generic', name, input })` then `span.end({ output })` / `span.error({ error })`. `result.traceId` / `result.spanId` exist on both generate and stream.


**Stream chunks** — every chunk is `{ type, runId, from, payload }`, `from ∈ AGENT|USER|SYSTEM|WORKFLOW`. Use `stream.fullStream` (the 40+ member `ChunkType` union), not the streaming guide's 7-type list.

```ts
for await (const chunk of stream.fullStream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.payload.text)
  if (chunk.type === 'tool-call')  log(chunk.payload.toolName, chunk.payload.toolCallId)
  if (chunk.type === 'finish')     log(chunk.payload.output.usage, chunk.payload.stepResult.reason)
  if (chunk.type === 'tripwire')   { log(chunk.payload.processorId, chunk.payload.reason); break }
}
```

Types include `start, step-start, step-finish, finish, text-*, reasoning-*, tool-call, tool-result, tool-error, tool-call-delta, tool-output, step-output, object, source, file, raw, error, abort, response-metadata, watch, goal, tripwire, background-task-*`, plus custom `data-*`.

## Deployment constraints

| Constraint | Detail |
|---|---|
| **Scheduler** | Mastra's built-in scheduler (`schedule` on a workflow, the `schedules` domain) needs a **long-lived host** — it does not work on serverless. Setting `schedule` also silently auto-promotes the workflow to the evented execution engine, changing runtime behavior. |
| **DurableAgent** | Wants **Inngest** on serverless. |
| **Memory default storage** | `new Memory()` with no `storage` silently falls back to `file:memory.db` — fine locally, loses everything on an ephemeral host. Always set storage explicitly. |
| **`@mastra/pg`** | Node runtime only; tune `max`/`idleTimeoutMillis` down on serverless. |
| **`file:./mastra.db`** | Resolves per-process cwd — `mastra dev` alongside the app gives two different databases. Use an absolute `file:/abs/path`. |

## Gotchas

### Agents & tools
- `toolName` in streams and traces comes from the **object key** in `tools`, not `tool.id`. Use `tools: { [weatherTool.id]: weatherTool }` to make them match.
- Result tool arrays are chunk-shaped: read `toolCall.payload.toolName` / `.payload.args` and `toolResult.payload.result`. `toolCall.toolName` is `undefined`.
- Sampling knobs live under `modelSettings`, and it's `maxOutputTokens`, not `maxTokens`.
- `suspend()` lives at `context.agent.suspend` and does **not** throw — code after it keeps running. Always `return await suspend(…)`.
- `approveToolCall()`/`resumeStream()` return a **new** `MastraModelOutput`; the original stream is finished. Consume the returned one or you see nothing.
- Function-form `requireToolApproval` works only on plain `stream()`/`generate()`. Durable/stored agents serialize options, so a function silently degrades to "approve every tool call".
- `autoResumeSuspendedTools` resumes data-bearing `suspend()` flows only; it never auto-approves `requireApproval: true` tools, and needs memory + same thread/resource + a `resumeSchema`.
- `toolCallConcurrency` defaults to 1 when approval may be required, else 10 — approval flows serialize.
- `stream()`/`generate()` are V2+-model only and throw on a V1 model; V1 needs `streamLegacy()`, which also skips `errorProcessors`.

### Workflows
- `.commit()` is mandatory and must be last. `createRun()` is async — `await` it.
- `.parallel()`/`.branch()` outputs are **keyed by step id**; the next step's `inputSchema` must model that object, with `.optional()` keys for branches. `.branch()` runs only the **first** matching condition, in declaration order.
- Branch/loop conditions receive `inputData` (plus `iterationCount`, first eval = 1). The reference page's `({ context })` is stale docs.
- `.foreach()` default `concurrency` is **1**. The step inside gets one item; the step **after** gets the whole array. Chaining `.foreach().foreach()` yields array-of-arrays — flatten, or nest a committed workflow inside one `.foreach()`.
- `.parallel()` has no concurrency cap, and one throwing step fails the whole block — try/catch inside and return a typed `{ result, failed }`. `.parallel()`/`.foreach()` are sync points; nothing streams onward early.
- `await setState(…)` (the Step reference types it sync; every example awaits) and it **replaces** state — always spread.
- `resumeData` is undefined on the first pass; `suspendData` exists only on the resume pass. Branch on `resumeData ?? {}`.
- Omit `run.resume({ step })` only when exactly one step is suspended. Resuming a suspended `.foreach()` without `forEachIndex` resumes **all** iterations with the same data.
- `run.stream()` defaults to `closeOnSuspend: true` — the stream ends at a suspension. Pass `false` for one stream across the whole lifecycle.
- `status: 'tripwire'` is a distinct terminal status from `'failed'`. Code checking only success/failed/suspended mishandles it.

### Memory & storage
- `PgStore` does not exist — use `PostgresStore`. `PgVector` is real.
- `indexConfig` nests tuning params: `{ type, metric, ivf:{lists}, hnsw:{m, efConstruction} }` — the docs' flat `m`/`efConstruction` is ignored.
- `lastMessages: false` disables history **entirely** (nothing loaded *or saved*). For load-without-write use `readOnly: true`; for unlimited use `Number.MAX_SAFE_INTEGER`.
- From a client, send only the newest message — Mastra loads history from storage, and resending duplicates it.
- Semantic recall `filter` matches metadata frozen at save time; editing thread metadata later does not re-index existing embeddings.
- Memory enforces **no access control** — authorize `resourceId` in app code before calling `listThreads`/`recall`. `recall()` is the real query API; `listMessages` appears in prose but is not a documented `Memory` method.

### Skills & subagents
- `skill`, `skill_read`, `skill_search` are **not** in `WORKSPACE_TOOLS` — they can't be renamed, disabled, or gated with `requireApproval`.
- Duplicate skill names with the same source type make `get()` throw at runtime; agent-level skills silently override workspace ones.
- Delegation hooks swallow their own errors by default — set `hookErrorStrategy: 'throw'`. Use `resultText` (immediate) not `feedback` (next turn) to correct the parent; a subagent stopping on a tool-calls step returns empty text.
- The delegated `requestContext` is a shallow copy minus run-scoped identity keys; mutations do not flow back. Set values in `onDelegationStart`.

### Processors, scorers, tracing
- Sampling key names differ: tracing is `{ type:'ratio', probability }`, live agent scorers are `{ type:'ratio', rate }`.
- `processOutputStream` returning `undefined` drops the chunk exactly like `null` — always `return part`.
- Memory processors bracket yours: input `[Memory] → [yours]`, output `[yours] → [Memory]`. That's why an **output** `abort()` prevents the message being saved; an input-side abort gives no such guarantee.
- `spanOutputProcessors` are synchronous; per-exporter `customSpanFormatter` is the async-capable one. `excludeSpanTypes` runs before processors, `spanFilter` after, and a throwing `spanFilter` **keeps** the span.
- `SpanType` imports from `@mastra/core/observability`; everything else tracing-related from `@mastra/observability`.
- Message text lives at `message.content.parts[]` filtered by `part.type === 'text'` — not `message.content`.
- If every scorer step is a function, `judge` is never invoked. `generateReason` prompt objects take no `outputSchema`. Scorer `run` shapes are documented three incompatible ways — verify against the installed types.
