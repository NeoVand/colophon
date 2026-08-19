import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
// A: ChunkType from processors (skill claims this path)
import type { Processor, ChunkType } from '@mastra/core/processors'
import { createOpenAI } from '@ai-sdk/openai'
const openai = createOpenAI({ apiKey: 'x' })

// B: createChildSpan with plain string 'generic'
export const t = createTool({
  id: 't', description: 'd',
  execute: async (_i, context) => {
    context?.tracingContext?.currentSpan?.createChildSpan({ type: 'generic', name: 'n', input: {} })
  },
})

// C: Agent missing name + instructions (skill's subagent / skills examples)
export const a = new Agent({ id: 'research-agent', description: 'Gathers facts.', model: openai('gpt-5-mini') })

// D: suspend from inside a tool, skill's destructure form
export const t2 = createTool({
  id: 't2', description: 'd',
  suspendSchema: (await import('zod')).z.object({ question: (await import('zod')).z.string() }),
  execute: async (_i, context) => {
    const { resumeData, suspend } = context?.agent ?? {}
    if (!resumeData) return await suspend!({ question: 'Which city?' })
  },
})

export type _P = Processor
export type _C = ChunkType
