import { Hono } from 'hono'
import { z } from 'zod'
import { toSnakeCase } from '../utils/transform.js'
import { createScene, updateScene, deleteScene } from '../data/tenant/assets.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { assetParentInput, assetMediaInput, assetGenerationInput, readInput, mediaFields } from './asset-input.js'
import { success, created } from '../utils/response.js'
import { generateImage } from '../services/generation.js'
import { ensureSceneFinalPrompt } from '../services/final-prompt.js'
import { requireEpisode } from '../data/tenant/agent-scripts.js'
import { getPromptScene } from '../data/tenant/image-prompts.js'

const app = new Hono()
const sceneFields = { location: z.string().trim().min(1), time: z.string().optional(),
  prompt: z.string().optional(), description: z.string().optional(), lighting: z.string().nullable().optional() }
const createInput = z.object({ ...assetParentInput, ...sceneFields }).strict()
const updateInput = z.object({ ...sceneFields, ...assetMediaInput }).partial().strict().refine(value => Object.keys(value).length > 0)

// POST /scenes — 手动新增场景（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const body = await readInput(c, createInput)
  const row = await createScene(requireCurrentTenant(), body.drama_id, body.episode_id, { ...body, prompt: body.description ?? body.prompt })
  return created(c, toSnakeCase(row))
})

// PUT /scenes/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await readInput(c, updateInput)
  await updateScene(requireCurrentTenant(), id, { ...body, prompt: body.description ?? body.prompt, ...mediaFields(body) })
  return success(c)
})

// POST /scenes/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await readInput(c, assetGenerationInput)
  const tenant = requireCurrentTenant()
  const ep = await requireEpisode(tenant, body.episode_id)
  const scene = await getPromptScene(tenant, ep.id, ep.dramaId, id)

  const prompt = await ensureSceneFinalPrompt(scene, ep.id, false, { model: body.text_model, configId: body.text_config_id })
  const genId = await generateImage({ sceneId: id, dramaId: ep.dramaId, prompt, model: body.model, configId: body.config_id ?? ep.imageConfigId ?? undefined })
  return success(c, { image_generation_id: genId })
})

// POST /scenes/:id/generate-prompt — 独立生成/重新生成固定视角最终提示词（不生图）
app.post('/:id/generate-prompt', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await readInput(c, assetGenerationInput)
  const tenant = requireCurrentTenant()
  const ep = await requireEpisode(tenant, body.episode_id)
  const scene = await getPromptScene(tenant, ep.id, ep.dramaId, id)
  const finalPrompt = await ensureSceneFinalPrompt(scene, ep.id, body.force ?? false, { model: body.text_model, configId: body.text_config_id })
  return success(c, { final_prompt: finalPrompt })
})

// DELETE /scenes/:id — 软删除（保留历史生成记录）
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await deleteScene(requireCurrentTenant(), id)
  return success(c)
})

export default app
