import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable, Transform, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { appConfig } from '../config/env.js'
import { getTenantStorageRoot } from './paths.js'

export class StorageLimitError extends Error {
  readonly status = 413
  constructor() {
    super('当前文件或用户媒体存储已达到上限')
  }
}

const writers = new Map<string, Promise<void>>()

export class MediaPathError extends Error {}

export function resolveTenantPath(relativePath: string): string {
  const root = path.resolve(getTenantStorageRoot())
  const relative = relativePath.replace(/^\/?static\//, '')
  if (!relative || path.isAbsolute(relative) || /[\\:\x00-\x1f<>"|?*]/.test(relative) ||
    relative.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new MediaPathError('非法媒体路径')
  }
  const target = path.resolve(root, relative)
  if (!target.startsWith(`${root}${path.sep}`)) throw new MediaPathError('媒体路径超出用户目录')
  // Reject symlinks in existing ancestors, including the tenant directory.
  let current = target
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new MediaPathError('媒体路径不能包含符号链接')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return target
}

async function usedBytes(directory: string): Promise<number> {
  let entries
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let total = 0
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('用户媒体目录不能包含符号链接')
    if (entry.isDirectory()) total += await usedBytes(full)
    else if (entry.isFile()) total += (await fsp.stat(full)).size
  }
  return total
}

async function withWriter<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = writers.get(root) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => { release = resolve })
  writers.set(root, next)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (writers.get(root) === next) writers.delete(root)
  }
}

export type MediaProducer = (destination: Writable) => Promise<void>

/** A producer can publish only after its bounded stream finishes successfully. */
export async function writeTenantMedia(
  relativePath: string,
  producer: MediaProducer,
  maxBytes = appConfig.limits.mediaFileMaxBytes,
  validate?: (temporaryPath: string) => Promise<void>,
): Promise<string> {
  const root = getTenantStorageRoot()
  const target = resolveTenantPath(relativePath)
  return withWriter(root, async () => {
    const available = appConfig.limits.mediaQuotaBytes - await usedBytes(root)
    const limit = Math.min(available, maxBytes)
    if (limit <= 0) throw new StorageLimitError()
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const temporary = path.join(path.dirname(target), `.pending-${randomUUID()}`)
    let written = 0
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length
        if (written > limit) callback(new StorageLimitError())
        else callback(null, chunk)
      },
    })
    const output = fs.createWriteStream(temporary, { flags: 'wx' })
    const completion = pipeline(bounded, output)
    // Attach the handler before starting the producer to avoid unhandled rejection.
    void completion.catch(() => {})
    try {
      await producer(bounded)
      if (!bounded.writableEnded) bounded.end()
      await completion
      if (written === 0) throw new Error('媒体文件不能为空')
      if (validate) await validate(temporary)
      resolveTenantPath(relativePath)
      await fsp.rename(temporary, target)
      return relativePath
    } catch (error) {
      bounded.destroy(error instanceof Error ? error : new Error(String(error)))
      await completion.catch(() => {})
      await fsp.rm(temporary, { force: true })
      throw error
    }
  })
}

export function saveTenantBytes(relativePath: string, bytes: Uint8Array, maxBytes?: number): Promise<string> {
  return writeTenantMedia(relativePath, async (destination) => {
    await pipeline(Readable.from([bytes]), destination)
  }, maxBytes)
}
