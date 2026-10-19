import type { Context } from 'hono'
import { z } from 'zod'
import { invalidInput } from '../data/errors.js'

export const assetParentInput = {
  drama_id: z.number().int().positive(),
  episode_id: z.number().int().positive().optional(),
}
export const assetMediaInput = {
  image_url: z.string().min(1).nullable().optional(),
  imageUrl: z.string().min(1).nullable().optional(),
  local_path: z.string().min(1).nullable().optional(),
  localPath: z.string().min(1).nullable().optional(),
  final_prompt: z.string().nullable().optional(),
  finalPrompt: z.string().nullable().optional(),
}
export const assetGenerationInput = z.object({
  episode_id: z.number().int().positive(),
  force: z.boolean().optional(),
  model: z.string().trim().min(1).optional(),
  config_id: z.number().int().positive().optional(),
  text_model: z.string().trim().min(1).optional(),
  text_config_id: z.number().int().positive().optional(),
}).strict()

export async function readInput<T extends z.ZodType>(c: Context, input: T): Promise<z.output<T>> {
  let body: unknown
  try { body = await c.req.json() } catch (error) {
    if (error instanceof SyntaxError) invalidInput('请求必须是有效的 JSON')
    throw error
  }
  const result = input.safeParse(body)
  if (!result.success) invalidInput('请求参数无效')
  return result.data
}

export function mediaFields(body: z.infer<z.ZodObject<typeof assetMediaInput>>) {
  if (body.image_url !== undefined && body.imageUrl !== undefined && body.image_url !== body.imageUrl ||
    body.local_path !== undefined && body.localPath !== undefined && body.local_path !== body.localPath ||
    body.final_prompt !== undefined && body.finalPrompt !== undefined && body.final_prompt !== body.finalPrompt) {
    invalidInput('同一字段不能提供不同的值')
  }
  const choose = <T>(first: T | undefined, second: T | undefined) => first !== undefined ? first : second
  const prompt = choose(body.final_prompt, body.finalPrompt)
  return {
    imageUrl: choose(body.image_url, body.imageUrl),
    localPath: choose(body.local_path, body.localPath),
    finalPrompt: prompt === '' ? null : prompt,
  }
}
