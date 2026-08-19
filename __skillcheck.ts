import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { createWorkflow, createStep, createWorkflowStateReader, mapVariable } from '@mastra/core/workflows'
import { createSkill } from '@mastra/core/skills'
import { Workspace, WORKSPACE_TOOLS } from '@mastra/core/workspace'
import { createScorer } from '@mastra/core/evals'
import { SpanType } from '@mastra/core/observability'
import type { Processor } from '@mastra/core/processors'
import type { ChunkType } from '@mastra/core/stream'
import { MastraCompositeStore } from '@mastra/core/storage'
import { Mastra } from '@mastra/core'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

const openai = createOpenAI({ apiKey: 'x' })

// --- tools ---
export const weatherTool = createTool({
  id: 'weather-tool',
  description: 'Fetches weather for a location',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ location: z.string(), temperatureCelsius: z.number() }),
  execute: async ({ location }, { abortSignal, requestContext, agent, writer }) => {
    void abortSignal; void requestContext; void agent
    await writer?.custom({ type: 'data-progress', data: { pct: 50 }, transient: true })
    return { location, temperatureCelsius: 21 }
  },
})

// --- agent ---
export const agent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: 'Use weatherTool for current conditions.',
  model: openai('gpt-5'),
  tools: { [weatherTool.id]: weatherTool },
  hooks: {
    beforeToolCall: ({ toolName, input }) => { void toolName; void input; return { proceed: true } as const },
    afterToolCall: ({ toolName, output, error }) => { void toolName; void output; void error },
  },
})

// --- structured output ---
export async function so() {
  const res = await agent.generate('Plan my day.', {
    structuredOutput: {
      schema: z.object({ name: z.string() }),
      errorStrategy: 'fallback',
      fallbackValue: { name: '' },
      jsonPromptInjection: 'auto',
    },
  })
  return res.object
}

// --- modelSettings ---
export async function ms() {
  return agent.stream('hi', {
    modelSettings: { temperature: 0.2, maxOutputTokens: 100, topP: 1, maxRetries: 2, timeout: { totalMs: 1, stepMs: 1 }, stopSequences: ['x'] },
    toolChoice: 'auto',
    memory: { resource: 'r', thread: { id: 't', title: 'x' } },
  })
}

// --- HITL ---
export const del = createTool({ id: 'delete-record', description: 'd', requireApproval: true })
export async function hitl() {
  const stream = await agent.stream('Delete abc-123', {
    requireToolApproval: ({ toolName }) => /^delete_/.test(toolName),
  })
  for await (const c of stream.fullStream) {
    if (c.type === 'tool-call-approval') {
      const next = await agent.approveToolCall({ runId: stream.runId, toolCallId: c.payload.toolCallId })
      for await (const t of next.textStream) process.stdout.write(t)
    }
  }
  await agent.declineToolCall({ runId: 'r', toolCallId: 'tc', reason: 'not allowed' })
  await agent.approveToolCallGenerate({ runId: 'r', toolCallId: 'tc' })
  await agent.listSuspendedRuns({ threadId: 't', resourceId: 'r' })
}

// --- workflow ---
const step1 = createStep({
  id: 'step-1',
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ value: z.number() }),
  execute: async ({ inputData, state, setState, suspend, resumeData, suspendData, getStepResult, getInitData, mastra, runId, requestContext, retryCount }) => {
    void state; void setState; void suspend; void resumeData; void suspendData
    void getStepResult; void getInitData; void mastra; void runId; void requestContext; void retryCount
    return { value: inputData.value + 1 }
  },
})
export const wf = createWorkflow({
  id: 'wf',
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ value: z.number() }),
}).then(step1).commit()

export async function runwf() {
  const run = await wf.createRun({ disableScorers: false })
  const result = await run.start({ inputData: { value: 1 }, outputOptions: { includeState: true } })
  const stream = run.stream({ inputData: { value: 1 }, closeOnSuspend: false })
  for await (const chunk of stream.fullStream) void chunk
  void (await stream.result); void (await stream.usage); void stream.status
  if (result.status === 'suspended') {
    await run.resume({ step: result.suspended[0], resumeData: { approved: true }, forEachIndex: 0 })
  }
  const st = await wf.getWorkflowRunById('id')
  void createWorkflowStateReader
  void mapVariable
  return st
}

// --- skills ---
const codeReview = createSkill({
  name: 'code-review',
  description: 'Reviews diffs for correctness.',
  instructions: '# Code review',
  references: { 'checklist.md': '...' },
  'user-invocable': true,
})
export const reviewer = new Agent({ id: 'reviewer', name: 'Reviewer', instructions: 'r', model: openai('gpt-5'), skills: [codeReview, './skills/testing'] })
void Workspace; void WORKSPACE_TOOLS

// --- subagents ---
const research = new Agent({ id: 'research-agent', name: 'Research', instructions: 'r', description: 'Gathers facts.', model: openai('gpt-5-mini') })
export const parent = new Agent({ id: 'parent', name: 'Parent', instructions: 'p', model: openai('gpt-5'), agents: { researchAgent: research } })
export async function delegate() {
  await parent.stream('...', {
    maxSteps: 10,
    onIterationComplete: async () => ({ continue: true }),
    delegation: {
      onDelegationStart: async c => ({ proceed: true, modifiedPrompt: `${c.prompt}\nBe brief.`, modifiedMaxSteps: 5 }),
      onDelegationComplete: async c => (c.error ? (c.bail(), { feedback: `failed` }) : { resultText: '...' }),
      messageFilter: ({ messages }) => messages.slice(-10),
      hookErrorStrategy: 'throw',
      includeSubAgentToolResultsInModelContext: true,
    },
  })
}

// --- processors ---
export class Guard implements Processor {
  id = 'guard'
  async processOutputStream({ part }: { part: ChunkType }): Promise<ChunkType | null> {
    if (part.type === 'text-delta' && part.payload.text.includes('secret')) return null
    return part
  }
  async processOutputStep({ text, abort, retryCount }: any) {
    if (!text && retryCount < 3) abort('Too vague', { retry: true, metadata: { kind: 'quality' } })
    return []
  }
}

// --- scorers ---
export const sources = createScorer({ id: 'sources', description: 'Has sources',
  judge: { model: openai('gpt-5-mini'), instructions: 'Be strict.' } })
  .analyze({ description: 'Detect sources', outputSchema: z.object({ hasSources: z.boolean() }),
             createPrompt: ({ run }) => `Sources present?\n${run.output}` })
  .generateScore(({ results }) => (results.analyzeStepResult.hasSources ? 1 : 0))

export async function score() {
  const r = await sources.run({ input: 'i', output: 'o' })
  return [r.score, r.analyzeStepResult, r.reason]
}

// --- observability child span ---
export const spanTool = createTool({
  id: 'span-tool', description: 'd',
  execute: async (_i, context) => {
    const span = context?.tracingContext?.currentSpan?.createChildSpan({ type: SpanType.GENERIC, name: 'n', input: {} })
    span?.end({ output: {} })
  },
})

void Mastra; void MastraCompositeStore
