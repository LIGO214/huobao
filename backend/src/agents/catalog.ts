import { z } from 'zod'

/** The published Agent types and their built-in text skills. */
export const agentCatalog = Object.freeze({
  script_rewriter: { skillPrefixes: ['script-rewriter'] },
  extractor: { skillPrefixes: ['extractor'] },
  storyboard_breaker: { skillPrefixes: ['storyboard-breaker'] },
  prompt_generator: { skillPrefixes: [
    'prompt-generator/character-prompt', 'prompt-generator/scene-prompt',
    'prompt-generator/prop-prompt', 'prompt-generator/video-prompt',
  ] },
})

export type AgentType = keyof typeof agentCatalog
export const validAgentTypes = Object.freeze(Object.keys(agentCatalog) as AgentType[])
export const agentTypeInput = z.enum(validAgentTypes as [AgentType, ...AgentType[]])
export const contentLanguageInput = z.enum(['zh', 'en', 'ja', 'ko'])
export type ContentLanguage = z.infer<typeof contentLanguageInput>
