import type { TenantContext } from '../types/tenant.js'
import { validateTenant, runWithTenant } from '../security/tenant-runtime.js'
import { createAgentJob, finishAgentJob } from '../data/tenant/agent-jobs.js'
import { agentTypeInput } from '../agents/catalog.js'

type AgentJob = Awaited<ReturnType<typeof createAgentJob>>

/** Every Agent entry reserves a job before execution and shares the same admission limits. */
export async function executeAgentJob<T>(context: TenantContext, job: AgentJob, execute: () => Promise<T>,
  resultSummary: (result: T) => unknown = () => null): Promise<T> {
  if (validateTenant(context).userId !== job.userId || job.status !== 'processing') {
    throw new Error('Agent task identity or state is invalid')
  }
  const agentType = agentTypeInput.parse(job.agentType)
  let result: T
  let summary: unknown
  try {
    result = await runWithTenant(context, execute)
    summary = resultSummary(result)
  } catch (error) {
    await finishAgentJob(context, agentType, job.id, { status: 'failed' })
    throw error
  }
  await finishAgentJob(context, agentType, job.id, { status: 'completed', result: summary })
  return result
}
