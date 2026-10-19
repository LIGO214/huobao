import { Hono } from 'hono'
import { z } from 'zod'
import { success, created } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateImage } from '../services/generation.js'
import { ensurePropFinalPrompt } from '../services/final-prompt.js'
import { createProp, updateProp, deleteProp } from '../data/tenant/assets.js'
import { requireEpisode } from '../data/tenant/agent-scripts.js'
import { getPromptProp } from '../data/tenant/image-prompts.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { assetParentInput, assetMediaInput, assetGenerationInput, readInput, mediaFields } from './asset-input.js'

const app = new Hono()
// 道具图：白底单品静物，方形画布
const PROP_IMAGE_SIZE = '1024x1024'
const propFields = { name: z.string().trim().min(1), type: z.string().nullable().optional(), description: z.string().nullable().optional() }
const createInput = z.object({ ...assetParentInput, ...propFields }).strict()
const updateInput = z.object({ ...propFields, ...assetMediaInput }).partial().strict().refine(value => Object.keys(value).length > 0)

// POST /props — 手动新增道具（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const body = await readInput(c, createInput)
  const row = await createProp(requireCurrentTenant(), body.drama_id, body.episode_id, body)
  return created(c, toSnakeCase(row))
})

// DELETE /props/:id — 软删除
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await deleteProp(requireCurrentTenant(), id)
  return success(c)
})

// PUT /props/:id — 更新道具（物品外貌/类型/最终提示词）
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await readInput(c, updateInput)
  await updateProp(requireCurrentTenant(), id, { ...body, ...mediaFields(body) })
  return success(c)
})

// POST /props/:id/generate-prompt — 独立生成/重新生成白底单品最终提示词（不生图）
app.post('/:id/generate-prompt', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await readInput(c, assetGenerationInput)
  const tenant = requireCurrentTenant()
  const ep = await requireEpisode(tenant, body.episode_id)
  const prop = await getPromptProp(tenant, ep.id, ep.dramaId, id)
  const finalPrompt = await ensurePropFinalPrompt(prop, ep.id, body.force ?? false, { model: body.text_model, configId: body.text_config_id })
  return success(c, { final_prompt: finalPrompt })
})

// POST /props/:id/generate-image — 生成道具白底单品图
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await readInput(c, assetGenerationInput)
  const tenant = requireCurrentTenant()
  const ep = await requireEpisode(tenant, body.episode_id)
  const prop = await getPromptProp(tenant, ep.id, ep.dramaId, id)
  const prompt = await ensurePropFinalPrompt(prop, ep.id, false, { model: body.text_model, configId: body.text_config_id })
  const genId = await generateImage({ propId: id, dramaId: ep.dramaId, prompt, model: body.model,
    size: PROP_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
  return success(c, { image_generation_id: genId })
})

export default app
