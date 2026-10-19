import { Hono, type Context } from 'hono'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import { appConfig } from '../config/env.js'
import { success, badRequest } from '../utils/response.js'
import { saveUploadedFile, generateImageThumb } from '../utils/storage.js'

const app = new Hono()
const formats = {
  image: new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  video: new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']),
  audio: new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac']),
}

async function saveMediaUpload(c: Context, kind: keyof typeof formats) {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return badRequest(c, '文件必填')
  }
  const limits = appConfig.limits
  const maxBytes = kind === 'image' ? limits.imageUploadMaxBytes
    : kind === 'audio' ? limits.audioUploadMaxBytes : limits.uploadMaxBytes
  if (!file.size || file.size > maxBytes) {
    return c.json({ code: 413, message: '文件为空或超过大小上限' }, 413)
  }
  const buffer = await file.arrayBuffer()
  const detected = await fileTypeFromBuffer(new Uint8Array(buffer))
  if (!detected || !formats[kind].has(detected.mime)) {
    return badRequest(c, '文件内容不是支持的媒体格式')
  }
  if (kind === 'image') {
    const metadata = await sharp(buffer, { limitInputPixels: limits.imageMaxPixels }).metadata()
    if (!metadata.width || !metadata.height ||
      metadata.width * metadata.height * (metadata.pages ?? 1) > limits.imageMaxPixels) {
      return c.json({ code: 413, message: '图片解码像素超过上限' }, 413)
    }
  }
  const path = await saveUploadedFile(buffer, 'uploads', `upload.${detected.ext}`)
  if (kind === 'image') await generateImageThumb(path)
  return success(c, { url: `/${path}`, path })
}

app.post('/image', (c) => saveMediaUpload(c, 'image'))
app.post('/video', (c) => saveMediaUpload(c, 'video'))
app.post('/audio', (c) => saveMediaUpload(c, 'audio'))

export default app
