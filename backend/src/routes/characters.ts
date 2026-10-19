import { Hono } from 'hono'
import { z } from 'zod'
import { success, created } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateImage } from '../services/generation.js'
import { ensureCharacterFinalPrompt } from '../services/final-prompt.js'
import { createCharacter, updateCharacter, deleteCharacter } from '../data/tenant/assets.js'
import { requireEpisode } from '../data/tenant/agent-scripts.js'
import { getPromptCharacter } from '../data/tenant/image-prompts.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { assetParentInput, assetMediaInput, assetGenerationInput, readInput, mediaFields } from './asset-input.js'

const app = new Hono()
const CHARACTER_IMAGE_SIZE = '1920x1080'
const characterFields = { name: z.string().trim().min(1), role: z.string().nullable().optional(),
  description: z.string().nullable().optional(), appearance: z.string().nullable().optional(), styling: z.string().nullable().optional() }
const createInput = z.object({ ...assetParentInput, ...characterFields }).strict()
const updateInput = z.object({ ...characterFields, ...assetMediaInput }).partial().strict().refine(value => Object.keys(value).length > 0)
const batchInput = assetGenerationInput.extend({ character_ids: z.array(z.number().int().positive()).min(1) })

// POST /characters — 手动新增角色（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const body = await readInput(c, createInput)
  const row = await createCharacter(requireCurrentTenant(), body.drama_id, body.episode_id, body)
  return created(c, toSnakeCase(row))
})

// PUT /characters/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await readInput(c, updateInput)
  await updateCharacter(requireCurrentTenant(), id, { ...body, ...mediaFields(body) })
  return success(c)
})

// DELETE /characters/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await deleteCharacter(requireCurrentTenant(), id)
  return success(c)
})

// POST /characters/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await readInput(c, assetGenerationInput)
  const tenant = requireCurrentTenant()
  const ep = await requireEpisode(tenant, body.episode_id)
  const char = await getPromptCharacter(tenant, ep.id, ep.dramaId, id)
  const prompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id })
  const genId = await generateImage({ characterId: id, dramaId: ep.dramaId, prompt, model: body.model,
    size: CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
  return success(c, { image_generation_id: genId })
})

// POST /characters/:id/generate-prompt — 独立生成/重新生成三视图最终提示词（不生图）
app.post('/:id/generate-prompt', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await readInput(c, assetGenerationInput)
  const tenant = requireCurrentTenant()
  const ep = await requireEpisode(tenant, body.episode_id)
  const char = await getPromptCharacter(tenant, ep.id, ep.dramaId, id)
  const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, body.force ?? false, { model: body.text_model, configId: body.text_config_id })
  return success(c, { final_prompt: finalPrompt })
})

// POST /characters/batch-generate-images
app.post('/batch-generate-images', async (c) => {
  const body = await readInput(c, batchInput)
  const tenant = requireCurrentTenant()
  const ep = await requireEpisode(tenant, body.episode_id)
  // Validate the entire selection before starting paid model work.
  const characters = await Promise.all([...new Set(body.character_ids)].map(id => getPromptCharacter(tenant, ep.id, ep.dramaId, id)))
  const results: number[] = []
  for (const char of characters) {
    const prompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id })
    results.push(await generateImage({ characterId: char.id, dramaId: ep.dramaId, prompt, model: body.model,
      size: CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined }))
  }
  return success(c, { count: results.length, ids: results })
})

export default app
