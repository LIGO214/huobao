import { Hono } from 'hono'
import { z } from 'zod'
import { success, badRequest } from '../utils/response.js'
import { invalidInput } from '../data/errors.js'
import { toSnakeCaseArray, toSnakeCase } from '../utils/transform.js'
import { getActiveConfigId } from '../services/ai.js'
import { EXTRACT_TARGETS, getExtractionStatus, startExtraction, type ExtractTarget } from '../services/extraction.js'
import { getVideoPromptBatchStatus, startVideoPromptBatch } from '../services/video-prompts.js'
import { createEpisode, updateEpisode, deleteEpisode, listEpisodeCharacters, listEpisodeScenes, listEpisodeProps, getEpisodeGenerationTasks, getEpisodePipeline } from '../data/tenant/episodes.js'
import { readAgentStoryboards } from '../data/tenant/agent-storyboards.js'
import { requireEpisode } from '../data/tenant/agent-scripts.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'

const app = new Hono()
const createInput = z.object({
  drama_id: z.number().int().positive(), title: z.string().trim().min(1).optional(),
  image_config_id: z.number().int().positive().optional(), video_config_id: z.number().int().positive().optional(),
  resolution: z.enum(['480p', '720p', '1080p']).optional(),
}).strict()
const updateInput = z.object({
  title: z.string().trim().min(1).optional(), content: z.string().optional(), script_content: z.string().optional(),
  description: z.string().optional(), status: z.string().optional(), resolution: z.enum(['480p', '720p', '1080p']).optional(),
}).strict()
const batchInput = z.object({
  model: z.string().min(1).optional(), config_id: z.number().int().positive().optional(),
  storyboard_ids: z.array(z.number().int().positive()).optional(),
}).strict()

// POST /episodes — Create a new episode
app.post('/', async (c) => {
  const input = createInput.safeParse(await c.req.json())
  if (!input.success) invalidInput('剧集参数无效')
  const body = input.data

  // 图片/视频配置：显式传入优先，缺省时自动锁定当前启用的最高优先级官方配置
  const imageConfigId = body.image_config_id ?? await getActiveConfigId('image')
  const videoConfigId = body.video_config_id ?? await getActiveConfigId('video')
  if (!imageConfigId) return badRequest(c, '未找到启用的图片生成配置，请先在设置中心添加')
  if (!videoConfigId) return badRequest(c, '未找到启用的视频生成配置，请先在设置中心添加')
  const ep = await createEpisode(requireCurrentTenant(), body.drama_id, {
    title: body.title, imageConfigId, videoConfigId, resolution: body.resolution,
  })
  return success(c, {
    id: ep.id,
    episode_number: ep.episodeNumber,
    title: ep.title,
    image_config_id: ep.imageConfigId,
    video_config_id: ep.videoConfigId,
    resolution: ep.resolution,
  })
})

// PUT /episodes/:id - Update episode fields
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const input = updateInput.safeParse(await c.req.json())
  if (!input.success) invalidInput('剧集参数无效')
  if (!Object.keys(input.data).length) return badRequest(c, '没有可更新的字段')
  const { script_content, ...fields } = input.data
  await updateEpisode(requireCurrentTenant(), id, { ...fields, scriptContent: script_content })
  return success(c)
})

// DELETE /episodes/:id - Soft delete episode（其分镜/生成记录保留但不可达）
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await deleteEpisode(requireCurrentTenant(), id)
  return success(c)
})

// GET /episodes/:id/characters — characters linked to this episode
app.get('/:id/characters', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const result = await listEpisodeCharacters(requireCurrentTenant(), episodeId)
  return success(c, toSnakeCaseArray(result))
})

// GET /episodes/:id/scenes — scenes linked to this episode
app.get('/:id/scenes', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const result = await listEpisodeScenes(requireCurrentTenant(), episodeId)
  return success(c, toSnakeCaseArray(result))
})

// GET /episodes/:id/props — props linked to this episode
app.get('/:id/props', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const result = await listEpisodeProps(requireCurrentTenant(), episodeId)
  return success(c, toSnakeCaseArray(result))
})

// POST /episodes/:id/extract — 异步提取资产（target: characters | scenes | props），立即返回，前端轮询状态
app.post('/:id/extract', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const target = body.target as ExtractTarget
  if (!EXTRACT_TARGETS.includes(target)) return badRequest(c, 'target 必须是 characters / scenes / props')
  const ep = await requireEpisode(requireCurrentTenant(), id)
  const started = await startExtraction(ep.id, ep.dramaId, target, { model: body.model || undefined, configId: body.config_id ?? undefined })
  return success(c, { target, status: 'running', already_running: !started })
})

// GET /episodes/:id/extract-status — 查询三类资产提取任务状态
app.get('/:id/extract-status', async (c) => {
  const id = Number(c.req.param('id'))
  return success(c, await getExtractionStatus(id))
})

// POST /episodes/:id/generate-video-prompts — 异步批量为缺少视频提示词的分镜生成（立即返回，前端轮询状态）
app.post('/:id/generate-video-prompts', async (c) => {
  const id = Number(c.req.param('id'))
  const input = batchInput.safeParse(await c.req.json())
  if (!input.success) invalidInput('批量提示词参数无效')
  const body = input.data
  const ep = await requireEpisode(requireCurrentTenant(), id)
  const result = await startVideoPromptBatch(ep.id, ep.dramaId, { model: body.model, configId: body.config_id }, body.storyboard_ids)
  if (result.total === -1) return success(c, { status: 'running', already_running: true })
  if (!result.started) return success(c, { status: 'idle', total: 0 })
  return success(c, { status: 'running', total: result.total })
})

// GET /episodes/:id/video-prompts-status — 查询批量视频提示词任务状态
app.get('/:id/video-prompts-status', async (c) => {
  const id = Number(c.req.param('id'))
  return success(c, await getVideoPromptBatchStatus(id))
})

// GET /episodes/:episode_id/storyboards
app.get('/:episode_id/storyboards', async (c) => {
  const episodeId = Number(c.req.param('episode_id'))
  const tenant = requireCurrentTenant()
  const episode = await requireEpisode(tenant, episodeId)
  const { entries, characters, props } = await readAgentStoryboards(tenant, episodeId, episode.dramaId)
  return success(c, entries.map(({ row, characterIds, propIds }) => ({
    ...toSnakeCase(row),
    character_ids: characterIds,
    prop_ids: propIds,
    characters: characters.rows
      .filter(ch => characterIds.includes(ch.id))
      .map(ch => toSnakeCase(ch)),
    props: props.rows
      .filter(p => propIds.includes(p.id))
      .map(p => toSnakeCase(p)),
  })))
})

// GET /episodes/:id/pipeline-status — 流水线进度
// GET /episodes/:id/generation-tasks — 按集聚合 sys_task + video_merges
// sys_task 无 episode_id,通过 storyboard/scene/character/prop 关联键归属到当前集
app.get('/:id/generation-tasks', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const { tasks, merges } = await getEpisodeGenerationTasks(requireCurrentTenant(), episodeId)

  return success(c, {
    tasks: toSnakeCaseArray(tasks),
    merges: toSnakeCaseArray(merges),
  })
})

app.get('/:id/pipeline-status', async (c) => {
  const episodeId = Number(c.req.param('id'))
  return success(c, await getEpisodePipeline(requireCurrentTenant(), episodeId))
})

export default app
