import { Hono } from 'hono'
import { success, created, badRequest } from '../utils/response.js'
import { generateImage, generateVideo } from '../services/generation.js'
import { getDramaStylePrompt } from '../services/style-preset.js'
import { logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { deleteGenerationTask, listGenerationTasks, requireGenerationTask, requireTaskConfig, resolveTaskTargets } from '../data/tenant/tasks.js'
import { invalidInput } from '../data/errors.js'
import { readInput } from './asset-input.js'
import { generationInput, taskListInput } from './task-input.js'

const app = new Hono()

type TaskType = 'image' | 'video'

const WAN_MEDIA_TYPES = new Set([
  'first_frame',
  'last_frame',
  'reference_image',
  'reference_video',
  'reference_audio',
  'file',
  'link',
])

/**
 * 兼容项目原有扁平入参，也支持 Wan 3.0 官方 model/input/parameters 结构。
 */
function normalizeVideoRequest(body: any) {
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}
  const parameters = body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
    ? body.parameters
    : {}
  const media = Array.isArray(input.media) ? input.media : []

  const mediaUrls = (type: string) => media
    .filter((item: any) => item?.type === type)
    .map((item: any) => item?.url)

  return {
    ...body,
    prompt: body.prompt ?? input.prompt ?? '',
    reference_image_urls: body.reference_image_urls ?? mediaUrls('reference_image'),
    reference_video_urls: body.reference_video_urls ?? mediaUrls('reference_video'),
    reference_audio_urls: body.reference_audio_urls ?? mediaUrls('reference_audio'),
    first_frame_url: body.first_frame_url ?? mediaUrls('first_frame')[0],
    last_frame_url: body.last_frame_url ?? mediaUrls('last_frame')[0],
    file_url: body.file_url ?? mediaUrls('file')[0],
    link_url: body.link_url ?? mediaUrls('link')[0],
    generate_audio: body.generate_audio ?? parameters.audio,
    duration: body.duration ?? parameters.duration,
    aspect_ratio: body.aspect_ratio ?? parameters.ratio,
    resolution: body.resolution ?? parameters.resolution,
    seed: body.seed ?? parameters.seed,
    prompt_extend: body.prompt_extend ?? parameters.prompt_extend,
    watermark: body.watermark ?? parameters.watermark,
    official_media: media,
  }
}

function validateVideoRequest(body: any, provider?: string): string | null {
  for (const key of ['reference_image_urls', 'reference_video_urls', 'reference_audio_urls']) {
    if (body[key] !== undefined && !Array.isArray(body[key])) return `${key} 必须为数组`
    if (Array.isArray(body[key]) && body[key].some((url: any) => typeof url !== 'string' || !url.trim())) {
      return `${key} 中的每个 URL 都必须为非空字符串`
    }
  }

  if (body.official_media.length) {
    for (const item of body.official_media) {
      if (!item || typeof item !== 'object' || !WAN_MEDIA_TYPES.has(item.type) || typeof item.url !== 'string' || !item.url.trim()) {
        return 'input.media 中的每项都必须包含官方支持的 type 和非空 url'
      }
    }
    for (const type of ['first_frame', 'last_frame', 'file', 'link']) {
      if (body.official_media.filter((item: any) => item.type === type).length > 1) {
        return `Wan 3.0 input.media 中 ${type} 最多 1 项`
      }
    }
  }

  const imgs = body.reference_image_urls.length
  const vids = body.reference_video_urls.length
  const auds = body.reference_audio_urls.length
  const first = Boolean(body.first_frame_url)
  const last = Boolean(body.last_frame_url)
  const file = Boolean(body.file_url)
  const link = Boolean(body.link_url)

  if ((provider || '').toLowerCase() === 'aliyun') {
    if (imgs > 10 || vids > 5 || auds > 5) return 'Wan 3.0 参考素材超限：图片≤10、视频≤5、音频≤5'
    if (last && !first) return 'Wan 3.0 尾帧必须与首帧同时传入'
    if (file && link) return 'Wan 3.0 file 与 link 不能同时传入'
    if ((first || last) && (imgs + vids + auds > 0 || file || link)) {
      return 'Wan 3.0 的 first_frame/last_frame 不能与 reference_image/reference_video/reference_audio/file/link 混用'
    }
    const total = imgs + vids + auds + Number(first) + Number(last) + Number(file) + Number(link)
    if (total > 20) return 'Wan 3.0 input.media 最多 20 项'
  } else {
    if (imgs > 9 || vids > 3 || auds > 3) return '参考素材超限：图片≤9、视频≤3、音频≤3'
    if (auds > 0 && imgs + vids === 0) return '参考音频需要至少 1 个参考图片或视频'
  }

  if (!String(body.prompt || '').trim() && imgs + vids + auds === 0 && !first && !last && !file && !link) {
    return '视频生成需要至少一个参考素材或 prompt'
  }
  return null
}

// POST /tasks — 发起生成任务（body.type: image | video）
app.post('/', async (c) => {
  const tenant = requireCurrentTenant()
  const body = await readInput(c, generationInput)
  const type = body.type as TaskType
  if (type !== 'image' && type !== 'video') return badRequest(c, 'type 必须为 image 或 video')

  if (type === 'image') {
    if (!body.prompt?.trim()) return badRequest(c, '提示词必填')
  }

  const videoBody = type === 'video' ? normalizeVideoRequest(body) : null
  if (videoBody && (body.reference_images?.length || videoBody.image_url || videoBody.first_frame_url || videoBody.last_frame_url || videoBody.file_url || videoBody.link_url ||
    videoBody.reference_image_urls.length || videoBody.reference_video_urls.length || videoBody.reference_audio_urls.length || videoBody.official_media.length)) {
    return badRequest(c, '视频参考素材暂未开放，请仅使用文字提示词')
  }

  const targets = await resolveTaskTargets(tenant, { dramaId: body.drama_id, storyboardId: body.storyboard_id,
    sceneId: body.scene_id, characterId: body.character_id, propId: body.prop_id })
  const ep = targets.episode
  const locked = type === 'image' ? ep?.imageConfigId : ep?.videoConfigId
  const configId = body.config_id ?? locked ?? undefined
  let episodeResolution: string | undefined
  if (type === 'video' && ep?.resolution) episodeResolution = ep.resolution
  const selectedConfig = configId === undefined ? undefined : await requireTaskConfig(tenant, configId, type)

  if (type === 'video' && videoBody) {
    const validationError = validateVideoRequest(videoBody, selectedConfig?.provider ?? 'volcengine')
    if (validationError) return badRequest(c, validationError)
  }

  logTaskStart('TaskAPI', 'generate', {
    type, storyboardId: body.storyboard_id, sceneId: body.scene_id, characterId: body.character_id, dramaId: targets.dramaId,
  })

  let videoPrompt = videoBody?.prompt
  if (type === 'video' && String(videoPrompt || '').trim() && targets.dramaId !== undefined) {
    const stylePrompt = await getDramaStylePrompt(targets.dramaId)
    if (stylePrompt) videoPrompt = `${stylePrompt}，\n${videoPrompt}`
  }

  const id = type === 'image'
      ? await generateImage({
        storyboardId: body.storyboard_id,
        dramaId: targets.dramaId,
        sceneId: body.scene_id,
        characterId: body.character_id,
        propId: body.prop_id,
        prompt: body.prompt!,
        model: body.model,
        size: body.size,
        referenceImages: body.reference_images,
        frameType: body.frame_type,
        configId,
      })
      : await generateVideo({
        storyboardId: body.storyboard_id,
        dramaId: targets.dramaId,
        prompt: videoPrompt,
        model: videoBody!.model,
        referenceMode: 'reference',
        imageUrl: videoBody!.image_url,
        firstFrameUrl: videoBody!.first_frame_url,
        lastFrameUrl: videoBody!.last_frame_url,
        referenceImageUrls: videoBody!.reference_image_urls,
        referenceVideoUrls: videoBody!.reference_video_urls,
        referenceAudioUrls: videoBody!.reference_audio_urls,
        referenceFileUrl: videoBody!.file_url,
        referenceLinkUrl: videoBody!.link_url,
        generateAudio: videoBody!.generate_audio,
        duration: videoBody!.duration,
        aspectRatio: videoBody!.aspect_ratio,
        resolution: episodeResolution || videoBody!.resolution,
        seed: videoBody!.seed,
        promptExtend: videoBody!.prompt_extend,
        watermark: videoBody!.watermark,
        configId,
      })

  const record = await requireGenerationTask(tenant, id)
  logTaskSuccess('TaskAPI', 'generate', { task_id: id, type, provider: record.provider })
  return created(c, record)
})

// GET /tasks/:id — 轮询任务状态
app.get('/:id', async (c) => {
  return success(c, await requireGenerationTask(requireCurrentTenant(), Number(c.req.param('id'))))
})

// GET /tasks — 按 type / storyboard_id / drama_id 过滤
app.get('/', async (c) => {
  const parsed = taskListInput.safeParse(c.req.query())
  if (!parsed.success) invalidInput('任务筛选参数无效')
  const filters = parsed.data
  return success(c, await listGenerationTasks(requireCurrentTenant(), {
    type: filters.type, dramaId: filters.drama_id, storyboardId: filters.storyboard_id,
  }))
})

// DELETE /tasks/:id
app.delete('/:id', async (c) => {
  await deleteGenerationTask(requireCurrentTenant(), Number(c.req.param('id')))
  return success(c)
})

export default app
