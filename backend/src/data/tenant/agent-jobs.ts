import { and, eq, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { agentTypeInput, type AgentType } from '../../agents/catalog.js'
import { appConfig } from '../../config/env.js'
import { invalidInput, requireResourceId, resourceNotFound } from '../errors.js'
import { requireAgentEpisode } from './agent-scripts.js'
import { now } from '../../utils/response.js'

function requireAgentType(value: AgentType) {
  if (!agentTypeInput.safeParse(value).success) invalidInput('无效的 Agent 类型')
}

/** A short global lock makes the existing job admission check and insert atomic. */
export async function createAgentJob(context: TenantContext, agentType: AgentType, dramaId: number, episodeId: number) {
  const { userId } = validateTenant(context)
  requireAgentType(agentType)
  await requireAgentEpisode(context, episodeId, dramaId)
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73642, 1)`)
    const [running] = await tx.select({ total: sql<number>`count(*)::int`,
      own: sql<number>`count(*) FILTER (WHERE ${schema.agentTasks.userId} = ${userId})::int` }).from(schema.agentTasks)
      .where(eq(schema.agentTasks.status, 'processing'))
    if (running.total >= appConfig.limits.agentGlobal) throw new HTTPException(429, { message: 'Agent 任务已达到全局并发上限' })
    if (running.own >= appConfig.limits.agentPerUser) {
      throw new HTTPException(429, { message: '当前用户 Agent 任务已达到并发上限' })
    }
    const timestamp = now()
    const [job] = await tx.insert(schema.agentTasks).values({ userId, agentType, dramaId, episodeId,
      status: 'processing', createdAt: timestamp, updatedAt: timestamp }).returning()
    return job
  })
}

export async function requireAgentJob(context: TenantContext, agentType: AgentType, id: number) {
  const { userId } = validateTenant(context)
  requireAgentType(agentType)
  requireResourceId(id)
  const [job] = await db.select().from(schema.agentTasks).where(and(eq(schema.agentTasks.userId, userId),
    eq(schema.agentTasks.id, id), eq(schema.agentTasks.agentType, agentType)))
  if (!job) resourceNotFound()
  await requireAgentEpisode(context, job.episodeId, job.dramaId)
  return job
}

/** Terminal results cannot be replaced by a late callback. */
export async function finishAgentJob(context: TenantContext, agentType: AgentType, id: number,
  outcome: { status: 'completed'; result: unknown } | { status: 'failed' }) {
  const { userId } = validateTenant(context)
  requireAgentType(agentType)
  requireResourceId(id)
  // Completion must remain possible after a parent project has been soft-deleted.
  const [job] = await db.select({ id: schema.agentTasks.id }).from(schema.agentTasks).where(and(
    eq(schema.agentTasks.userId, userId), eq(schema.agentTasks.id, id), eq(schema.agentTasks.agentType, agentType)))
  if (!job) resourceNotFound()
  const timestamp = now()
  const rows = await db.update(schema.agentTasks).set({ status: outcome.status,
    result: outcome.status === 'completed' ? JSON.stringify(outcome.result) : null,
    errorMsg: outcome.status === 'failed' ? 'Agent 执行失败' : null, updatedAt: timestamp, completedAt: timestamp,
  }).where(and(eq(schema.agentTasks.userId, userId), eq(schema.agentTasks.id, id),
    eq(schema.agentTasks.agentType, agentType), eq(schema.agentTasks.status, 'processing'))).returning({ id: schema.agentTasks.id })
  return rows.length === 1
}
