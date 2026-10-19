import { z } from 'zod'

const id = z.number().int().positive()
const url = z.string().trim().min(1)
const mediaInput = z.object({ type: z.enum(['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio', 'file', 'link']), url }).strict()
const videoParameters = {
  duration: z.number().int().positive().optional(), ratio: z.string().trim().min(1).optional(),
  resolution: z.enum(['480p', '720p', '1080p', '2K']).optional(), seed: z.number().int().optional(),
  prompt_extend: z.boolean().optional(), watermark: z.boolean().optional(),
}

export const generationInput = z.object({
  type: z.enum(['image', 'video']), prompt: z.string().optional(), model: z.string().trim().min(1).optional(),
  drama_id: id.optional(), storyboard_id: id.optional(), scene_id: id.optional(), character_id: id.optional(), prop_id: id.optional(),
  config_id: id.optional(), size: z.string().trim().min(1).optional(),
  reference_images: z.array(url).max(6).optional(), frame_type: z.enum(['first_frame', 'last_frame', 'composed']).optional(),
  image_url: url.optional(), first_frame_url: url.optional(), last_frame_url: url.optional(), file_url: url.optional(), link_url: url.optional(),
  reference_image_urls: z.array(url).max(10).optional(), reference_video_urls: z.array(url).max(5).optional(), reference_audio_urls: z.array(url).max(5).optional(),
  generate_audio: z.boolean().optional(), duration: videoParameters.duration, aspect_ratio: videoParameters.ratio,
  resolution: videoParameters.resolution, seed: videoParameters.seed, prompt_extend: videoParameters.prompt_extend, watermark: videoParameters.watermark,
  input: z.object({ prompt: z.string().optional(), media: z.array(mediaInput).max(20).optional() }).strict().optional(),
  parameters: z.object({ ...videoParameters, audio: z.boolean().optional() }).strict().optional(),
}).strict()

const queryId = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(id)
export const taskListInput = z.object({ type: z.enum(['image', 'video']).optional(), drama_id: queryId.optional(), storyboard_id: queryId.optional() }).strict()
