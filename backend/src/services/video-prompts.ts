/**
 * 批量视频提示词任务 — 异步为缺少 video_prompt 的分镜逐个运行 prompt_generator Agent
 * 进程内内存态：按集跟踪一份任务，运行中不重复启动；重启后状态丢失
 */
import { listEpisodeStoryboards, requireStoryboard } from '../data/tenant/agent-storyboards.js'
import { requireEpisode, requireAgentEpisode } from '../data/tenant/agent-scripts.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { createAgentJob } from '../data/tenant/agent-jobs.js'
import { executeAgentJob } from './agent-execution.js'
import { requireResourceId, resourceNotFound } from '../data/errors.js'
import { getConfigById } from './ai.js'
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

export interface VideoPromptBatchStatus {
  status: 'running' | 'done' | 'error'
  total: number
  completed: number
  failed: number
  current_storyboard_id?: number
  started_at: string
  finished_at?: string
  error?: string
}

const tasks = new Map<string, VideoPromptBatchStatus>()
const keyOf = (userId: number, episodeId: number) => `${userId}:${episodeId}`

/** 启动批量生成（立即返回）；运行中返回 started:false,total:-1；无待生成分镜返回 started:false,total:0；
 *  传入 storyboardIds 时只处理所选分镜（即使已有提示词也重新生成），否则处理全部缺失提示词的分镜 */
export async function startVideoPromptBatch(
  episodeId: number,
  dramaId: number,
  opts: { model?: string; configId?: number } = {},
  storyboardIds?: number[],
): Promise<{ started: boolean; total: number }> {
  const tenant = requireCurrentTenant()
  const ep = await requireAgentEpisode(tenant, episodeId, dramaId)
  const key = keyOf(tenant.userId, episodeId)
  const sbs = (await listEpisodeStoryboards(tenant, episodeId)).map(entry => entry.row)
  if (storyboardIds !== undefined) {
    storyboardIds.forEach(requireResourceId)
    if (storyboardIds.some(id => !sbs.some(sb => sb.id === id))) resourceNotFound()
  }
  const pending = storyboardIds !== undefined
    ? sbs.filter(sb => storyboardIds.includes(sb.id))
    : sbs.filter(sb => !(sb.videoPrompt || '').trim())
  if (!pending.length) return { started: false, total: 0 }

  // 视频模型标签：跟随该集锁定的视频配置，供 Agent 按模型特性生成
  let videoLabel = '默认'
  if (ep.videoConfigId) {
    const cfg = await getConfigById(ep.videoConfigId, 'video')
    if (!cfg) throw new Error('视频配置不存在或已停用')
    videoLabel = `${cfg.model} (${cfg.provider})`
  }
  const requestContext = await buildAgentRequestContext({ agentType: 'prompt_generator', episodeId, dramaId, modelOverride: opts.model, textConfigId: opts.configId })
  if (tasks.get(key)?.status === 'running') return { started: false, total: -1 }

  const task: VideoPromptBatchStatus = {
    status: 'running',
    total: pending.length,
    completed: 0,
    failed: 0,
    started_at: new Date().toISOString(),
  }
  tasks.set(key, task)
  let job: Awaited<ReturnType<typeof createAgentJob>>
  try {
    job = await createAgentJob(tenant, 'prompt_generator', dramaId, episodeId)
  } catch (error) {
    tasks.delete(key)
    throw error
  }

  logTaskStart('VideoPrompt', 'batch', { episodeId, dramaId, total: pending.length, model: opts.model || undefined })
  void executeAgentJob(tenant, job, async () => {
    const agent = mastra.getAgent('prompt_generator')
    if (!agent) throw new Error('视频提示词 Agent 不可用')
    for (const sb of pending) {
      task.current_storyboard_id = sb.id
      logTaskProgress('VideoPrompt', 'batch-shot', { episodeId, storyboardId: sb.id, index: task.completed + task.failed + 1, total: task.total })
      try {
        await agent.generate([{
          role: 'user',
          content: `请为分镜 #${sb.storyboardNumber}(ID:${sb.id})生成视频提示词(video_prompt)。视频模型:${videoLabel},请根据该模型的特性和时长限制生成。
请先调用 read_storyboard_context 获取该分镜的画面描述(含【镜头N】子镜头与台词/旁白)、氛围及时长，据此生成 video_prompt(第一行是信息头：列出该分镜出场的人物与场景，用 @角色名/@场景名 引用；之后按 3 秒分段换行、用 @角色名/@场景名/@道具名 引用参考素材；段落内允许多镜头切镜，段与段可以是不同景别/角度/对象，但不跨场景，切镜点对齐分镜 description 的【镜头N】结构),然后调用 update_storyboard 保存到分镜 ID:${sb.id}。update_storyboard 参数只传 storyboard_id 和 video_prompt 两个键,不要回传该分镜的其他任何字段,不要重新拆分整集。`,
        }], { maxSteps: 8, requestContext })
        // 以实际落库为准判定成败
        const { row: fresh } = await requireStoryboard(tenant, sb.id)
        if ((fresh?.videoPrompt || '').trim()) task.completed++
        else {
          task.failed++
          logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: 'agent finished but video_prompt is empty' })
        }
      } catch (err: any) {
        task.failed++
        logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: err?.message })
      }
    }
  })
    .then(() => {
      task.status = 'done'
      task.finished_at = new Date().toISOString()
      task.current_storyboard_id = undefined
      logTaskSuccess('VideoPrompt', 'batch', { episodeId, total: task.total, completed: task.completed, failed: task.failed })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = '批量生成失败'
      logTaskError('VideoPrompt', 'batch', { episodeId, error: err?.message })
    })
  return { started: true, total: pending.length }
}

export async function getVideoPromptBatchStatus(episodeId: number): Promise<VideoPromptBatchStatus | null> {
  const tenant = requireCurrentTenant()
  await requireEpisode(tenant, episodeId)
  return tasks.get(keyOf(tenant.userId, episodeId)) || null
}
