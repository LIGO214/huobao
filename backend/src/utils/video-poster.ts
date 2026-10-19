/**
 * 视频海报帧提取 — 供 <video poster> 使用，避免列表页为显示首帧而缓冲整个视频
 */
import { getAbsolutePath } from './storage.js'
import { ffmpeg, checkFfmpegSuite } from './ffmpeg.js'
import { writeFfmpegMedia } from './ffmpeg-media.js'

/** 由视频相对路径推导海报帧路径：static/videos/x.mp4 → static/videos/x_poster.jpg */
export function posterPathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./]+$/, '_poster.jpg')
}

/**
 * 抽取视频 0.5s 处画面作为海报帧（宽 640，等比缩放，与原视频同目录）。
 * 海报与视频使用同一限额写入入口，失败不发布文件。
 */
export async function extractVideoPoster(relativePath: string): Promise<string> {
  if (!(await checkFfmpegSuite()).ffmpeg) throw new Error('FFmpeg 不可用，无法提取海报')
  return writeFfmpegMedia(
    posterPathFor(relativePath),
    ffmpeg(getAbsolutePath(relativePath)).seekInput(0.5)
      .outputOptions(['-frames:v', '1', '-vf', 'scale=640:-2', '-c:v', 'mjpeg']),
    'image2pipe',
  )
}
