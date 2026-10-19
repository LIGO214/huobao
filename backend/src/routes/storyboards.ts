import { Hono } from 'hono'
import { z } from 'zod'
import { success, created } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { createStoryboard, deleteStoryboard, requireStoryboard, updateAgentStoryboard, selectStoryboardVideo } from '../data/tenant/agent-storyboards.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { invalidInput } from '../data/errors.js'

const app = new Hono()

const fields = z.object({
  title: z.string().optional(), description: z.string().optional(), shot_type: z.string().optional(),
  angle: z.string().optional(), movement: z.string().optional(), duration: z.number().int().nonnegative().optional(),
  video_prompt: z.string().optional(), image_prompt: z.string().optional(), scene_id: z.number().int().positive().nullable().optional(),
  location: z.string().optional(), time: z.string().optional(), atmosphere: z.string().optional(), result: z.string().optional(),
  bgm_prompt: z.string().optional(), sound_effect: z.string().optional(),
  character_ids: z.array(z.number().int().positive()).optional(), prop_ids: z.array(z.number().int().positive()).optional(),
})
const createInput = fields.extend({ episode_id: z.number().int().positive(), storyboard_number: z.number().int().positive().default(1) }).strict()
const updateInput = fields.extend({ video_url: z.string().min(1).optional() }).strict()

// POST /storyboards
app.post('/', async (c) => {
  const input = createInput.safeParse(await c.req.json())
  if (!input.success) invalidInput('分镜参数无效')
  const { episode_id, storyboard_number, ...values } = input.data
  const { row, characterIds, propIds } = await createStoryboard(requireCurrentTenant(), episode_id, { ...values, shot_number: storyboard_number })
  return created(c, { ...toSnakeCase(row), character_ids: characterIds, prop_ids: propIds })
})

// PUT /storyboards/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const tenant = requireCurrentTenant()
  const { row, episode } = await requireStoryboard(tenant, id)
  const input = updateInput.safeParse(await c.req.json())
  if (!input.success) invalidInput('分镜参数无效')
  const { video_url, ...values } = input.data
  if (video_url !== undefined) {
    if (Object.keys(values).length) invalidInput('选择视频不能同时修改分镜内容')
    await selectStoryboardVideo(tenant, id, video_url)
  } else {
    if (!Object.keys(values).length) invalidInput('没有可更新的字段')
    await updateAgentStoryboard(tenant, row.episodeId, episode.dramaId, id, values)
  }
  return success(c)
})

// DELETE /storyboards/:id
app.delete('/:id', async (c) => {
  await deleteStoryboard(requireCurrentTenant(), Number(c.req.param('id')))
  return success(c)
})

export default app
