import { Hono } from 'hono'
import { requireMergeEpisode, listEpisodeMerges } from '../data/tenant/merges.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { success, badRequest } from '../utils/response.js'
import { generateEpisodeSubtitles, getEpisodeSubtitles, mergeEpisodeVideos, saveEpisodeSubtitles } from '../services/ffmpeg-merge.js'
import { toSnakeCase } from '../utils/transform.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

app.get('/episodes/:id/subtitles', async (c) => {
  return success(c, { content: await getEpisodeSubtitles(Number(c.req.param('id'))) })
})

app.post('/episodes/:id/subtitles/generate', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const episode = await requireMergeEpisode(requireCurrentTenant(), episodeId)
  try {
    return success(c, { content: await generateEpisodeSubtitles(episodeId, episode.dramaId) })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.put('/episodes/:id/subtitles', async (c) => {
  try {
    const body = await c.req.json()
    const path = await saveEpisodeSubtitles(Number(c.req.param('id')), body?.content)
    return success(c, { path })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// POST /episodes/:id/merge — 拼接镜头视频(body.storyboard_ids 可选,只拼所选)
app.post('/episodes/:id/merge', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const ep = await requireMergeEpisode(requireCurrentTenant(), episodeId)

  const text = await c.req.text()
  const body = text ? JSON.parse(text) : {}
  const storyboardIds = body.storyboard_ids
  if (storyboardIds !== undefined && (!Array.isArray(storyboardIds) || storyboardIds.length === 0 ||
    storyboardIds.some((id: unknown) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0))) {
    return badRequest(c, '请选择有效的分镜编号')
  }

  try {
    logTaskStart('MergeAPI', 'episode-merge', { episodeId, dramaId: ep.dramaId, storyboardIds })
    const mergeId = await mergeEpisodeVideos(episodeId, ep.dramaId, storyboardIds)
    logTaskSuccess('MergeAPI', 'episode-merge', { episodeId, mergeId })
    return success(c, { merge_id: mergeId, status: 'processing' })
  } catch (err: any) {
    logTaskError('MergeAPI', 'episode-merge', { episodeId, error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /episodes/:id/merge — 查询最新拼接状态
app.get('/episodes/:id/merge', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const merges = await listEpisodeMerges(requireCurrentTenant(), episodeId)
  const latest = merges[0]
  if (!latest) return success(c, null)

  return success(c, toSnakeCase(latest))
})

// GET /episodes/:id/merges — 成片列表(全部拼接记录,新的在前)
app.get('/episodes/:id/merges', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const merges = await listEpisodeMerges(requireCurrentTenant(), episodeId)
  return success(c, merges.slice(0, 30).map(toSnakeCase))
})

export default app
