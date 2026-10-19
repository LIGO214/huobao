import type { FfmpegCommand } from 'fluent-ffmpeg'
import { appConfig } from '../config/env.js'
import { writeTenantMedia } from './tenant-storage.js'

export function writeFfmpegMedia(
  relativePath: string,
  command: FfmpegCommand,
  format: string,
  validate?: (temporaryPath: string) => Promise<void>,
): Promise<string> {
  return writeTenantMedia(relativePath, (destination) => new Promise<void>((resolve, reject) => {
    let settled = false
    let stopped = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      destination.off('error', stop)
      if (error) reject(error)
      else resolve()
    }
    const stop = (error: Error) => {
      stopped = true
      command.kill('SIGKILL')
      finish(error)
    }
    const timer = setTimeout(() => stop(new Error('媒体处理超过执行时间上限')), appConfig.limits.taskTimeoutMs)
    destination.once('error', stop)
    command.on('start', () => { if (stopped) command.kill('SIGKILL') })
      .on('end', () => finish())
      .on('error', (error) => finish(error))
    try {
      command.format(format).pipe(destination, { end: true })
    } catch (error) {
      stop(error instanceof Error ? error : new Error(String(error)))
    }
  }), appConfig.limits.mediaFileMaxBytes, validate)
}
