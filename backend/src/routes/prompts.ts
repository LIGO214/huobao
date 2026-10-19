/** Built-in instructions are read-only; saves affect only the current user's text. */
import { Hono } from 'hono'
import { z } from 'zod'
import { success } from '../utils/response.js'
import { agentTypeInput, contentLanguageInput, validAgentTypes } from '../agents/catalog.js'
import { loadAgentPromptFile } from '../agents/prompts.js'
import { getUserPrompt, saveUserPrompt, resetUserPrompt, promptInput } from '../data/tenant/agent-customizations.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { invalidInput } from '../data/errors.js'
import { readInput } from './asset-input.js'
import { logTaskSuccess } from '../utils/task-logger.js'
import { appConfig } from '../config/env.js'

const app = new Hono()
const saveInput = z.object({ user_prompt: promptInput, lang: contentLanguageInput.optional() }).strict()
function agentType(value: string) {
  const result = agentTypeInput.safeParse(value)
  if (!result.success) invalidInput('未知的 Agent 类型')
  return result.data
}
function language(value?: string) {
  const result = contentLanguageInput.safeParse(value ?? 'zh')
  if (!result.success) invalidInput('不支持的内容语言')
  return result.data
}

app.get('/', async c => {
  const tenant = requireCurrentTenant()
  const list = await Promise.all(validAgentTypes.map(async type => {
    const file = await loadAgentPromptFile(type)
    if (!file) throw new Error('内置 Prompt 缺失')
    return { agent_type: type, name: file.name, model: file.model, read_only: true,
      is_default: true, user_prompt: await getUserPrompt(tenant, type) }
  }))
  return success(c, list)
})

app.get('/:type', async c => {
  const type = agentType(c.req.param('type'))
  const lang = language(c.req.query('lang'))
  const file = await loadAgentPromptFile(type, lang)
  if (!file) throw new Error('内置 Prompt 缺失')
  return success(c, { agent_type: type, lang, name: file.name, model: file.model,
    system_prompt: file.instructions, is_default: true, read_only: true,
    max_length: appConfig.limits.promptMaxLength,
    user_prompt: await getUserPrompt(requireCurrentTenant(), type, lang) })
})

app.put('/:type', async c => {
  const type = agentType(c.req.param('type'))
  const body = await readInput(c, saveInput)
  if (c.req.query('lang') !== undefined && body.lang !== undefined && c.req.query('lang') !== body.lang) invalidInput('内容语言不一致')
  const lang = language(c.req.query('lang') ?? body.lang)
  const instructions = await saveUserPrompt(requireCurrentTenant(), type, lang, body.user_prompt)
  logTaskSuccess('Prompt', 'save')
  return success(c, { agent_type: type, lang, user_prompt: instructions })
})

app.post('/:type/reset', async c => {
  const type = agentType(c.req.param('type'))
  const lang = language(c.req.query('lang'))
  await resetUserPrompt(requireCurrentTenant(), type, lang)
  logTaskSuccess('Prompt', 'reset')
  return success(c, { agent_type: type, lang, user_prompt: '' })
})

export default app
