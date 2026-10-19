import { z } from 'zod'

export const modelPurposeInput = z.enum(['text', 'image', 'video'])
const baseUrl = z.string().trim().url().refine(value => {
  const url = new URL(value)
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
}, '接口地址必须是无凭据、查询参数和片段的 HTTP 地址')
const fields = {
  service_type: modelPurposeInput, provider: z.string().trim().min(1), name: z.string().trim().min(1).max(200),
  base_url: baseUrl, api_key: z.string().trim().min(1).max(4096),
  model: z.array(z.string().trim().min(1).max(300)).min(1).max(100), priority: z.number().int().min(0).max(1_000_000),
  is_active: z.boolean(), temperature: z.number().min(0).max(2).nullable(),
}
export const createModelConfigInput = z.object({ ...fields, priority: fields.priority.optional(),
  is_active: fields.is_active.optional(), temperature: fields.temperature.optional() }).strict()
export const updateModelConfigInput = z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0)
export const probeModelConfigInput = z.object({ ...fields, config_id: z.number().int().positive() }).partial().strict()
export const modelConfigListInput = z.object({ service_type: modelPurposeInput.optional() }).strict()
