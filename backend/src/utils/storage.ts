/**
 * 文件存储工具 — 下载远程文件到本地
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { v4 as uuid } from 'uuid'
import { appConfig } from '../config/env.js'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { resolveTenantPath, saveTenantBytes, writeTenantMedia, StorageLimitError } from './tenant-storage.js'

/**
 * 下载远程文件到本地存储
 */
export async function downloadFile(url: string, subDir: string, timeoutMs = 120_000): Promise<string> {
  const ext = getExtFromUrl(url)
  const filename = `${uuid()}${ext}`
  return writeTenantMedia(`static/${subDir}/${filename}`, async (destination) => {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!resp.ok || !resp.body) throw new Error(`Download failed: ${resp.status}`)
    if (Number(resp.headers.get('content-length')) > appConfig.limits.mediaFileMaxBytes) {
      await resp.body.cancel()
      throw new StorageLimitError()
    }
    await pipeline(Readable.fromWeb(resp.body as never), destination)
  })
}

/**
 * 保存上传的文件
 */
export async function saveUploadedFile(data: ArrayBuffer, subDir: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName) || '.bin'
  const filename = `${uuid()}${ext}`
  return saveTenantBytes(`static/${subDir}/${filename}`, new Uint8Array(data), appConfig.limits.uploadMaxBytes)
}

function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname)
    if (ext && ext.length <= 5) return ext
  } catch {}
  return '.bin'
}

/**
 * 获取本地文件的绝对路径
 */
export function getAbsolutePath(relativePath: string): string {
  return resolveTenantPath(relativePath)
}

/**
 * 保存 Base64 编码的图片数据到本地存储
 * 用于 Gemini 等只返回 base64 数据的厂商
 */
export async function saveBase64Image(base64Data: string, mimeType: string, subDir: string): Promise<string> {
  const ext = mimeTypeToExt(mimeType)
  const filename = `${uuid()}${ext}`
  if (base64Data.length > Math.ceil(appConfig.limits.mediaFileMaxBytes / 3) * 4 + 4) throw new StorageLimitError()
  const buffer = Buffer.from(base64Data, 'base64')
  return saveTenantBytes(`static/${subDir}/${filename}`, buffer)
}

/** 由图片相对路径推导缩略图路径：static/images/x.png → static/images/x_thumb.webp */
export function thumbPathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./]+$/, '_thumb.webp')
}

/**
 * 为已落盘图片生成列表页缩略图（宽 400 WebP，与原图同目录）。
 * 失败直接暴露；派生文件同样受用户额度限制。
 */
export async function generateImageThumb(relativePath: string): Promise<string | null> {
  const thumbRel = thumbPathFor(relativePath)
  return writeTenantMedia(thumbRel, async (destination) => {
    await pipeline(
      sharp(getAbsolutePath(relativePath), { limitInputPixels: appConfig.limits.imageMaxPixels })
        .rotate().resize({ width: 400, withoutEnlargement: true }).webp({ quality: 78 }),
      destination,
    )
  })
}

export function readImageAsDataUrl(relativePath: string): string {
  const filePath = getAbsolutePath(relativePath)
  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = extToMimeType(ext)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

export async function readImageAsCompressedDataUrl(
  relativePath: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  return compressImageAsDataUrl(getAbsolutePath(relativePath), options)
}

/**
 * 下载远程图片并压缩为 data URL（远程参考图归一化，供 multipart/base64 上传类厂商使用）
 */
export async function fetchImageAsCompressedDataUrl(
  url: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!resp.ok) throw new Error(`下载参考图失败: HTTP ${resp.status}`)
  return compressImageAsDataUrl(Buffer.from(await resp.arrayBuffer()), options)
}

/** sharp 输入 → 压缩 JPEG data URL（本地路径与远程下载共享同一压缩管线） */
async function compressImageAsDataUrl(
  input: string | Buffer,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  const maxWidth = options.maxWidth ?? 768
  const maxHeight = options.maxHeight ?? 768
  const quality = options.quality ?? 68

  const resized = sharp(input, { limitInputPixels: appConfig.limits.imageMaxPixels }).rotate().resize({
    width: maxWidth,
    height: maxHeight,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const metadata = await resized.metadata()
  const output = metadata.hasAlpha
    ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    : await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
  const mimeType = 'image/jpeg'
  return `data:${mimeType};base64,${output.toString('base64')}`
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    mimeType: match[1],
    data: match[2],
  }
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return map[mimeType] || '.png'
}

function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  return map[ext] || 'image/png'
}
