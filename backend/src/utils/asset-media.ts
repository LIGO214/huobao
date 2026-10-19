import fs from 'node:fs/promises'
import { fileTypeFromFile } from 'file-type'
import type { TenantContext } from '../types/tenant.js'
import { runWithTenant } from '../security/tenant-runtime.js'
import { MediaPathError, resolveTenantPath } from './tenant-storage.js'
import { invalidInput, resourceNotFound } from '../data/errors.js'

/** Client-selected images must already exist inside the current user's media directory. */
export async function validateAssetImage(context: TenantContext, imageUrl?: string | null, localPath?: string | null) {
  if (imageUrl === undefined && localPath === undefined) return {}
  if (imageUrl === null && localPath === null) return { imageUrl: null, localPath: null }
  const selected = imageUrl ?? localPath
  if (!selected || !/^\/?static\//.test(selected)) invalidInput('只能选择自己的站内图片')
  const relative = selected.replace(/^\//, '')
  if (imageUrl != null && imageUrl.replace(/^\//, '') !== relative ||
    localPath != null && localPath.replace(/^\//, '') !== relative) invalidInput('图片地址与本地路径不一致')
  try {
    const absolute = runWithTenant(context, () => resolveTenantPath(relative))
    const stat = await fs.stat(absolute)
    if (!stat.isFile()) resourceNotFound()
    const type = await fileTypeFromFile(absolute)
    if (!type || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type.mime)) invalidInput('文件不是支持的图片')
  } catch (error) {
    if (error instanceof MediaPathError) invalidInput('图片路径无效')
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') resourceNotFound()
    throw error
  }
  return { imageUrl: relative, localPath: relative }
}
