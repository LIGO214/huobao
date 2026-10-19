/**
 * 统一生成任务服务 — 图片/视频生成共用 sys_task 表与同一条生命周期：
 * 创建(processing) → 适配器构建请求 → 同步完成或异步轮询 → 用户目录落盘 → 原子发布结果
 */
import { getActiveConfig, getConfigById } from './ai.js'
import { downloadFile, generateImageThumb, readImageAsCompressedDataUrl, saveBase64Image } from '../utils/storage.js'
import { validateAssetImage } from '../utils/asset-media.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { getImageAdapter, getVideoAdapter } from './adapters/registry'
import type { AIConfig } from './adapters/types'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, redactUrl } from '../utils/task-logger.js'
import { requireCurrentTenant, runWithTenant } from '../security/tenant-runtime.js'
import { createGenerationTask, requireGenerationTask, markGenerationPolling, failGenerationTask, completeGenerationTask,
  resolveTaskTargets, type GenerationTask as SysTaskRecord } from '../data/tenant/tasks.js'
import { invalidInput } from '../data/errors.js'

type TaskType = 'image' | 'video'

const taskLabel = (type: TaskType) => (type === 'image' ? 'ImageTask' : 'VideoTask')

// 轮询节奏：图片 5s×120（上限 10 分钟）；视频 10s×300
const POLL_PROFILES: Record<TaskType, { attempts: number; intervalMs: number; maxDurationMs: number | null }> = {
  image: { attempts: 120, intervalMs: 5000, maxDurationMs: 600_000 },
  video: { attempts: 300, intervalMs: 10_000, maxDurationMs: null },
}

// 部分图片模型的同步生成耗时较长；请求上限高于网关的短连接阈值，
// 由上游明确返回或网络断开时立即失败。
const GENERATION_REQUEST_TIMEOUT_MS = 900_000
// Download must finish within this bound before a video can be published.
const VIDEO_CACHE_DOWNLOAD_TIMEOUT_MS = 900_000

interface GenerateImageParams {
  storyboardId?: number
  dramaId?: number
  sceneId?: number
  characterId?: number
  propId?: number
  prompt: string
  model?: string
  size?: string
  referenceImages?: string[]
  frameType?: string
  configId?: number
}

interface GenerateVideoParams {
  storyboardId?: number
  dramaId?: number
  prompt: string
  model?: string
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  referenceFileUrl?: string
  referenceLinkUrl?: string
  generateAudio?: boolean
  duration?: number
  aspectRatio?: string
  resolution?: string
  seed?: number
  promptExtend?: boolean
  watermark?: boolean
  configId?: number
}

export async function generateImage(params: GenerateImageParams): Promise<number> {
  const tenant = requireCurrentTenant()
  await resolveTaskTargets(tenant, params)
  if (!params.prompt?.trim()) invalidInput('图片提示词必填')
  if (params.referenceImages && (!Array.isArray(params.referenceImages) || params.referenceImages.length > 6)) {
    invalidInput('图片参考素材最多 6 张')
  }
  const referenceImages: string[] = []
  for (const image of params.referenceImages ?? []) {
    if (typeof image !== 'string' || !image.trim()) invalidInput('参考图片路径无效')
    const owned = await validateAssetImage(tenant, image)
    if (!owned.imageUrl) invalidInput('参考图片路径无效')
    referenceImages.push(owned.imageUrl)
  }
  const config = await resolveGenerationConfig('image', params.configId)
  if (!config) throw new Error('未配置图片模型，请先到「设置」页添加并启用 AI 服务')

  const id = await createTask('image', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    propId: params.propId,
    prompt: params.prompt,
    model: params.model || config.model,
  }, {
    size: params.size || '1920x1080',
    frameType: params.frameType,
    referenceImages,
  })

  logTaskStart('ImageTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    frameType: params.frameType,
    model: params.model || config.model,
  })
  logTaskPayload('ImageTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  await resolveTaskTargets(requireCurrentTenant(), params)
  requireTextOnlyVideo(params)
  if (!params.prompt?.trim()) invalidInput('视频提示词必填')
  const config = await resolveGenerationConfig('video', params.configId)
  if (!config) throw new Error('未配置视频模型，请先到「设置」页添加并启用 AI 服务')

  const id = await createTask('video', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    prompt: params.prompt,
    model: params.model || config.model,
  }, {
    referenceMode: 'text',
    generateAudio: params.generateAudio === false ? 0 : 1,
    duration: params.duration,
    aspectRatio: params.aspectRatio,
    // 统一存为项目内部格式，各适配器再转换为官方大小写与枚举。
    resolution: normalizeStoredVideoResolution(params.resolution),
    seed: params.seed,
    promptExtend: params.promptExtend,
    watermark: params.watermark,
  })

  logTaskStart('VideoTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    referenceMode: 'text',
    duration: params.duration || 5,
  })
  logTaskPayload('VideoTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

async function resolveGenerationConfig(
  purpose: TaskType,
  configId?: number,
): Promise<AIConfig | null> {
  if (configId !== undefined) {
    return getConfigById(configId, purpose)
  }
  return getActiveConfig(purpose)
}

async function createTask(
  type: TaskType,
  config: AIConfig,
  fields: {
    storyboardId?: number
    dramaId?: number
    sceneId?: number
    characterId?: number
    propId?: number
    prompt: string
    model?: string | null
  },
  params: Record<string, unknown>,
): Promise<number> {
  const tenant = requireCurrentTenant()
  const { id } = await createGenerationTask(tenant, type, { ...fields, provider: config.provider }, params)
  runWithTenant(tenant, () => processTask(id, config)).catch(err => {
    logTaskError(taskLabel(type), 'process', { id, error: err.message })
  })
  return id
}

function parseTaskParams(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  const params: unknown = JSON.parse(raw)
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('任务参数无效')
  return params as Record<string, any>
}

async function processTask(id: number, config: AIConfig) {
  try {
    const record = await requireGenerationTask(requireCurrentTenant(), id)
    const type = record.type as TaskType
    const label = taskLabel(type)
    const params = parseTaskParams(record.params)
    logTaskProgress(label, 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      sceneId: record.sceneId,
      characterId: record.characterId,
    })

    let url: string, method: string, headers: Record<string, string>, body: unknown

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      const resolvedReferenceImages = await normalizeReferenceImages(params.referenceImages)
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        size: params.size,
        frameType: params.frameType,
        referenceImages: resolvedReferenceImages.length ? JSON.stringify(resolvedReferenceImages) : null,
      }))
    } else {
      const adapter = getVideoAdapter(config.provider)
      requireTextOnlyVideo(params)
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        referenceMode: 'text',
        generateAudio: params.generateAudio,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        seed: params.seed,
        promptExtend: params.promptExtend,
        watermark: params.watermark,
      }))
    }

    logTaskProgress(label, 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
    })

    const isMultipart = body instanceof FormData
    logTaskPayload(label, 'request payload', {
      id, method, url, headers,
      // multipart 表单（如 OpenAI /v1/images/edits）无法 JSON 化，记录字段摘要
      body: isMultipart ? `[multipart/form-data: ${[...(body as FormData).keys()].join(', ')}]` : body,
    })

    const resp = await executeGenerationRequest(record, {
      url,
      method,
      headers,
      body: isMultipart ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(GENERATION_REQUEST_TIMEOUT_MS),
    })

    if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`)
    const result = await resp.json() as any
    logTaskPayload(label, 'response payload', { id, provider: config.provider, result })

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      const { isAsync, taskId, imageUrl } = adapter.parseGenerateResponse(result)

      if (!isAsync && imageUrl) {
        logTaskProgress(label, 'sync-complete', { id, imageUrl })
        await handleImageComplete(record, imageUrl)
        return
      }

      if (!isAsync && !imageUrl) {
        // 同步模式但无 URL（Gemini 等返回 base64）
        const b64 = adapter.extractImageBase64(result)
        if (b64) {
          logTaskProgress(label, 'sync-base64-complete', { id, mimeType: b64.mimeType })
          await handleImageCompleteBase64(record, b64.data, b64.mimeType)
          return
        }
        throw new Error('No image URL or base64 data in response')
      }

      await markPolling(id, taskId)
      await pollTask(record, config, taskId!)
      return
    }

    const adapter = getVideoAdapter(config.provider)
    const { isAsync, taskId, videoUrl } = adapter.parseGenerateResponse(result)

    if (!isAsync && videoUrl) {
      logTaskProgress(label, 'sync-complete', { id, videoUrl })
      await handleVideoComplete(record, videoUrl, params.duration)
      return
    }

    await markPolling(id, taskId)
    await pollTask(record, config, taskId!)
  } catch (err: any) {
    await failTask(id, err.message)
  }
}

async function markPolling(id: number, taskId: string | undefined) {
  if (!taskId) throw new Error('上游任务缺少 ID')
  await markGenerationPolling(requireCurrentTenant(), id, taskId)
  logTaskProgress('SysTask', 'poll-start', { id, taskId })
}

async function failTask(id: number, message: string) {
  logTaskError('SysTask', 'failed', { id, error: message })
  await failGenerationTask(requireCurrentTenant(), id)
}

async function pollTask(record: SysTaskRecord, config: AIConfig, taskId: string) {
  const type = record.type as TaskType
  const label = taskLabel(type)
  const profile = POLL_PROFILES[type]
  const adapter = type === 'image' ? getImageAdapter(config.provider) : getVideoAdapter(config.provider)
  const startedAt = Date.now()

  for (let i = 0; i < profile.attempts; i++) {
    if (profile.maxDurationMs && Date.now() - startedAt >= profile.maxDurationMs) {
      await failTask(record.id, 'Timeout: Polling exceeded 10 minutes')
      return
    }
    await new Promise(r => setTimeout(r, profile.intervalMs))
    const { url, method, headers } = adapter.buildPollRequest(config, taskId)
    logTaskProgress(label, 'poll-request', {
      id: record.id, taskId, provider: config.provider, method, url: redactUrl(url), attempt: i + 1,
    })
    const remainingMs = profile.maxDurationMs
      ? Math.max(1_000, profile.maxDurationMs - (Date.now() - startedAt))
      : 600_000
    const resp = await executeGenerationRequest(record, {
      url, method, headers, signal: AbortSignal.timeout(remainingMs),
    })
    if (!resp.ok) throw new Error(`Polling failed: HTTP ${resp.status}`)
    const result = await resp.json() as any
    const pollResp: any = adapter.parsePollResponse(result)
    if (pollResp.status === 'failed') throw new Error(pollResp.error || 'Generation failed')
    if (pollResp.status === 'pending' || pollResp.status === 'processing') continue
    if (pollResp.status !== 'completed') throw new Error('Invalid generation status')

    if (type === 'image') {
      if (pollResp.imageUrl) {
        await handleImageComplete(record, pollResp.imageUrl)
        return
      }
      const b64 = (adapter as ReturnType<typeof getImageAdapter>).extractImageBase64(result)
      if (!b64) throw new Error('Completed image task has no image')
      await handleImageCompleteBase64(record, b64.data, b64.mimeType)
    } else {
      if (!pollResp.videoUrl) throw new Error('Completed video task has no video')
      await handleVideoComplete(record, pollResp.videoUrl, pollResp.duration)
    }
    return
  }
  await failTask(record.id, 'Timeout: polling attempts exhausted')
}

async function executeGenerationRequest(
  record: SysTaskRecord,
  request: {
    url: string
    method: string
    headers: Record<string, string>
    body?: BodyInit | null
    signal?: AbortSignal
  },
): Promise<Response> {
  if (record.userId !== requireCurrentTenant().userId) throw new Error('生成任务用户身份不一致')
  return fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    redirect: 'error',
  })
}

async function handleImageComplete(record: SysTaskRecord, imageUrl: string) {
  const localPath = await downloadFile(imageUrl, 'images')
  await generateImageThumb(localPath)
  await completeGenerationTask(requireCurrentTenant(), record.id, {
    resultUrl: imageUrl, localPath, frameType: parseTaskParams(record.params).frameType,
  })

  logTaskSuccess('ImageTask', 'downloaded', { id: record.id, provider: record.provider, localPath })
}

async function handleImageCompleteBase64(record: SysTaskRecord, base64Data: string, mimeType: string) {
  const localPath = await saveBase64Image(base64Data, mimeType, 'images')
  await generateImageThumb(localPath)
  await completeGenerationTask(requireCurrentTenant(), record.id, {
    localPath, frameType: parseTaskParams(record.params).frameType,
  })

  logTaskSuccess('ImageTask', 'saved-base64', { id: record.id, provider: record.provider, mimeType, localPath })
}

async function handleVideoComplete(record: SysTaskRecord, videoUrl: string, duration: number | null | undefined) {
  const localPath = await downloadFile(videoUrl, 'videos', VIDEO_CACHE_DOWNLOAD_TIMEOUT_MS)
  await extractVideoPoster(localPath)
  await completeGenerationTask(requireCurrentTenant(), record.id, { localPath, resultUrl: videoUrl, duration })
  logTaskSuccess('VideoTask', 'downloaded', { id: record.id, storyboardId: record.storyboardId, duration })
}

// ─── 参考素材归一化 ───────────────────────────────────────────────

async function normalizeReferenceImages(refs: string[] | null | undefined): Promise<string[]> {
  if (!refs?.length) return []
  const normalized: string[] = []
  for (const value of new Set(refs)) {
    const owned = await validateAssetImage(requireCurrentTenant(), value)
    if (!owned.imageUrl) invalidInput('参考图片路径无效')
    normalized.push(await readImageAsCompressedDataUrl(owned.imageUrl, { maxWidth: 768, maxHeight: 768, quality: 68 }))
  }
  return normalized
}

function requireTextOnlyVideo(params: Partial<GenerateVideoParams>) {
  if (params.imageUrl || params.firstFrameUrl || params.lastFrameUrl || params.referenceFileUrl || params.referenceLinkUrl ||
    params.referenceImageUrls?.length || params.referenceVideoUrls?.length || params.referenceAudioUrls?.length ||
    (params.referenceMode && !['reference', 'text'].includes(params.referenceMode))) {
    invalidInput('视频参考素材暂未开放，请仅使用文字提示词')
  }
}

function normalizeStoredVideoResolution(resolution: string | null | undefined): string | undefined {
  const value = String(resolution || '').trim().toLowerCase()
  if (value === '480p' || value === '720p' || value === '1080p') return value
  if (value === '2k') return '2K'
  return undefined
}
