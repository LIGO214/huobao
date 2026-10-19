/**
 * Agent 请求上下文 — 通过 Mastra RequestContext 按请求注入
 * 路由层 build → generate({ requestContext }) → 工具 execute 内读取
 */
import { RequestContext } from '@mastra/core/request-context'
import { getConfigById } from '../services/ai.js'
import { getContentLanguage, type ContentLanguage } from '../services/app-settings.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import type { TenantContext } from '../types/tenant.js'
import { requireAgentEpisode } from '../data/tenant/agent-scripts.js'
import { buildAgentInstructionSnapshot, type AgentInstructionSnapshot } from '../services/agent-instructions.js'
import { agentTypeInput, type AgentType } from './catalog.js'

export interface AgentRequestContextValues {
  agentType: AgentType
  episodeId: number
  dramaId: number
  modelOverride?: string
  textConfigId?: number
  userId?: number
  /** Resolved once per run from the user's own settings. */
  language?: ContentLanguage
  instructionSnapshot?: AgentInstructionSnapshot
}

export async function buildAgentRequestContext(values: AgentRequestContextValues): Promise<RequestContext<AgentRequestContextValues>> {
  const tenant = requireCurrentTenant()
  if (values.userId !== undefined && values.userId !== tenant.userId) throw new Error('Agent 用户身份不一致')
  await requireAgentEpisode(tenant, values.episodeId, values.dramaId)
  if (values.textConfigId !== undefined) await getConfigById(values.textConfigId, 'text')
  const rc = new RequestContext<AgentRequestContextValues>()
  rc.set('episodeId', values.episodeId)
  rc.set('dramaId', values.dramaId)
  if (values.modelOverride) rc.set('modelOverride', values.modelOverride)
  if (values.textConfigId) rc.set('textConfigId', values.textConfigId)
  rc.set('userId', tenant.userId)
  const language = values.language ?? await getContentLanguage()
  rc.set('language', language)
  rc.set('agentType', agentTypeInput.parse(values.agentType))
  rc.set('instructionSnapshot', await buildAgentInstructionSnapshot(tenant, values.agentType, language))
  return rc
}

export function getEpisodeId(requestContext: RequestContext | undefined): number | null {
  getAgentTenantContext(requestContext)
  const v = requestContext?.get('episodeId' as never)
  return typeof v === 'number' ? v : null
}

export function getDramaId(requestContext: RequestContext | undefined): number | null {
  getAgentTenantContext(requestContext)
  const v = requestContext?.get('dramaId' as never)
  return typeof v === 'number' ? v : null
}

/** 读取请求上下文中的内容语言；未设置返回 null（调用方按 zh 处理） */
export function getContentLanguageFromRC(requestContext: RequestContext | undefined): ContentLanguage | null {
  const v = requestContext?.get('language' as never)
  return typeof v === 'string' && v ? (v as ContentLanguage) : null
}

export function getAgentTenantContext(requestContext: RequestContext | undefined): TenantContext {
  const tenant = requireCurrentTenant()
  if (requestContext?.get('userId' as never) !== tenant.userId) throw new Error('Agent 用户身份缺失或不一致')
  return tenant
}
