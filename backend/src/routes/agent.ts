/**
 * Agent 聊天路由 — 非流式版本
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { agentTypeInput, type AgentType } from '../agents/catalog.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { mastra } from '../mastra/index.js'
import { success } from '../utils/response.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { createAgentJob, requireAgentJob } from '../data/tenant/agent-jobs.js'
import { executeAgentJob } from '../services/agent-execution.js'
import { invalidInput } from '../data/errors.js'
import { readInput } from './asset-input.js'

const app = new Hono()
const requestInput = z.object({
  message: z.string().trim().min(1), drama_id: z.number().int().positive(), episode_id: z.number().int().positive(),
  model: z.string().trim().min(1).optional(), config_id: z.number().int().positive().optional(),
}).strict()

// Mastra v1.17 的 ToolCallChunk / ToolResultChunk 结构：
// { type: 'tool-call', payload: { toolCallId, toolName, args } }
// { type: 'tool-result', payload: { toolCallId, toolName, result, isError } }
function normalizeToolName(entry: any) {
  return entry?.payload?.toolName
    || entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || entry?.type
    || null
}

function normalizeToolResult(entry: any) {
  const result = entry?.payload?.result ?? entry?.result ?? entry?.payload?.output ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

function readAgentType(value: string): AgentType {
  const parsed = agentTypeInput.safeParse(value)
  if (!parsed.success) invalidInput('无效的 Agent 类型')
  return parsed.data
}

async function executeAgent(agentType: AgentType, body: z.infer<typeof requestInput>, requestContext: Awaited<ReturnType<typeof buildAgentRequestContext>>) {
  const { message, drama_id, episode_id } = body
  const agent = mastra.getAgent(agentType)!

  logTaskStart('Agent', agentType, { dramaId: drama_id, episodeId: episode_id })

  const startTime = performance.now()

  try {
    const result = await agent.generate(
      [{ role: 'user', content: message }],
      { maxSteps: 20, requestContext },
    )

    const elapsed = Math.round(performance.now() - startTime) / 1000
    logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed })

    // 收集所有 tool calls 和 results
    const toolCalls = result.toolCalls || []
    const toolResults = result.toolResults || []
    const normalizedToolCalls = toolCalls.map((tc: any) => ({
      toolName: normalizeToolName(tc),
      args: tc?.payload?.args ?? tc?.args ?? tc?.input ?? null,
    }))
    const normalizedToolResults = toolResults.map((tr: any) => ({
      toolName: normalizeToolName(tr),
      result: normalizeToolResult(tr),
    }))

    logTaskProgress('Agent', 'tool-summary', {
      count: normalizedToolCalls.length,
    })

    return {
      type: 'done',
      text: result.text || '',
      toolCalls: normalizedToolCalls,
      toolResults: normalizedToolResults,
    }
  } catch (err: any) {
    const elapsed = Math.round(performance.now() - startTime) / 1000
    logTaskError('Agent', agentType, { elapsedSeconds: elapsed, error: err.message })
    throw err
  }
}

// POST /agent/:type/start — 将长耗时 Agent 放入后台，前端改为轮询任务状态。
// 目前剧本改写使用此入口，避免浏览器或中间代理断开长达数分钟的 HTTP 请求。
app.post('/:type/start', async (c) => {
  const tenant = requireCurrentTenant()
  const agentType = readAgentType(c.req.param('type'))
  const body = await readInput(c, requestInput)
  const requestContext = await buildAgentRequestContext({ agentType, episodeId: body.episode_id, dramaId: body.drama_id,
    modelOverride: body.model, textConfigId: body.config_id })
  const job = await createAgentJob(tenant, agentType, body.drama_id, body.episode_id)
  void executeAgentJob(tenant, job, () => executeAgent(agentType, body, requestContext), result => result)
    .catch(() => logTaskError('Agent', 'job-failed', { task_id: job.id }))
  return success(c, { job_id: job.id, status: 'processing' })
})

// GET /agent/:type/jobs/:id — 查询后台 Agent 任务状态。
app.get('/:type/jobs/:id', async (c) => {
  const job = await requireAgentJob(requireCurrentTenant(), readAgentType(c.req.param('type')), Number(c.req.param('id')))
  return success(c, job)
})

// POST /agent/:type/chat — 非流式 Agent 对话（保留给需要同步结果的短操作）
app.post('/:type/chat', async (c) => {
  const tenant = requireCurrentTenant()
  const agentType = readAgentType(c.req.param('type'))
  const body = await readInput(c, requestInput)
  const requestContext = await buildAgentRequestContext({ agentType, episodeId: body.episode_id, dramaId: body.drama_id,
    modelOverride: body.model, textConfigId: body.config_id })
  const job = await createAgentJob(tenant, agentType, body.drama_id, body.episode_id)
  const result = await executeAgentJob(tenant, job, () => executeAgent(agentType, body, requestContext), result => result)
  return success(c, result)
})

// GET /agent/:type/debug
app.get('/:type/debug', async (c) => {
  const agentType = readAgentType(c.req.param('type'))
  return success(c, { agent_type: agentType, valid: true })
})

export default app
