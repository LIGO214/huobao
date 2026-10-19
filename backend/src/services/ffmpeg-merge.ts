/**
 * FFmpeg 多镜头拼接 — 将所有生成后的镜头视频拼接为一集
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { getMergeInputs, requireMergeEpisode, createMerge, failMerge, completeMerge } from '../data/tenant/merges.js'
import { requireCurrentTenant, runWithTenant } from '../security/tenant-runtime.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { ffmpeg, checkFfmpegSuite } from '../utils/ffmpeg.js'
import { DATA_ROOT } from '../utils/paths.js'
import { getAbsolutePath } from '../utils/storage.js'
import { saveTenantBytes } from '../utils/tenant-storage.js'
import { writeFfmpegMedia } from '../utils/ffmpeg-media.js'

function toAbsPath(relativePath: string): string {
  return getAbsolutePath(relativePath)
}

function getDramaVideoUrl(metadata: string | null, field: 'openingVideoUrl' | 'endingVideoUrl'): string | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata)
    return typeof parsed?.[field] === 'string' && parsed[field].trim()
      ? parsed[field].trim()
      : null
  } catch {
    return null
  }
}

function subtitleRelativePath(episodeId: number): string {
  return `static/subtitles/episode-${episodeId}.srt`
}

function subtitleAssRelativePath(episodeId: number): string {
  return `static/subtitles/episode-${episodeId}.ass`
}

function toSrtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor(totalMs % 3_600_000 / 60_000)
  const secs = Math.floor(totalMs % 60_000 / 1000)
  const ms = totalMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function extractCaptionTexts(description: string | null, videoPrompt: string | null): string[] {
  const source = `${description || ''}\n${videoPrompt || ''}`.replace(/\s+/g, ' ')
  const captions = [
    ...[...source.matchAll(/旁白[：:]\s*([^。！？!?]+[。！？!?]?)/g)].map(match => match[1].trim()),
    ...[...source.matchAll(/「([^」]+)」/g)].map(match => match[1].trim()),
  ].filter(Boolean)
  return [...new Set(captions)]
}

export async function getEpisodeSubtitles(episodeId: number): Promise<string> {
  await requireMergeEpisode(requireCurrentTenant(), episodeId)
  const filePath = toAbsPath(subtitleRelativePath(episodeId))
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
}

export async function saveEpisodeSubtitles(episodeId: number, content: string): Promise<string> {
  await requireMergeEpisode(requireCurrentTenant(), episodeId)
  const normalized = String(content || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) throw new Error('字幕内容不能为空')
  if (!/\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(normalized)) {
    throw new Error('字幕格式无效，请使用 SRT 时间格式，例如 00:00:03,000 --> 00:00:06,000')
  }
  await saveTenantBytes(subtitleRelativePath(episodeId), Buffer.from(`${normalized}\n`))
  await saveTenantBytes(subtitleAssRelativePath(episodeId), Buffer.from(srtToAss(normalized)))
  return subtitleRelativePath(episodeId)
}

function srtToAss(content: string): string {
  const timestamp = (value: string) => {
    const match = value.trim().match(/^(\d+):(\d{2}):(\d{2}),(\d{3})$/)
    if (!match) return value.trim()
    const [, hours, minutes, seconds, milliseconds] = match
    return `${Number(hours)}:${minutes}:${seconds}.${milliseconds.slice(0, 2)}`
  }
  const blocks = content.split(/\n\s*\n/)
  const lines = blocks.flatMap(block => {
    const parts = block.split('\n').filter(Boolean)
    const timing = parts.find(line => line.includes('-->'))
    if (!timing) return []
    const [start, end] = timing.split('-->').map(timestamp)
    const text = parts.slice(parts.indexOf(timing) + 1).join('\\N')
      .replace(/[{}]/g, '\\$&')
    return text ? [`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`] : []
  })
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 864\nPlayResY: 496\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Songti SC,20,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,24,24,28,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${lines.join('\n')}\n`
}

export async function generateEpisodeSubtitles(episodeId: number, dramaId: number): Promise<string> {
  const { drama, storyboards } = await getMergeInputs(requireCurrentTenant(), episodeId, dramaId)
  const openingVideoUrl = getDramaVideoUrl(drama?.metadata ?? null, 'openingVideoUrl')
  const openingDuration = openingVideoUrl && fs.existsSync(toAbsPath(openingVideoUrl))
    ? await getVideoDuration(toAbsPath(openingVideoUrl))
    : 0

  let cursor = openingDuration
  const cues: { start: number; end: number; text: string }[] = []
  for (const storyboard of storyboards) {
    const duration = Math.max(1, Number(storyboard.duration || 5))
    const texts = extractCaptionTexts(storyboard.description, storyboard.videoPrompt)
    if (texts.length) {
      const available = Math.max(1, duration - 0.8)
      const cueDuration = available / texts.length
      texts.forEach((text, index) => cues.push({
        start: cursor + 0.4 + index * cueDuration,
        end: cursor + 0.4 + (index + 1) * cueDuration,
        text,
      }))
    }
    cursor += duration
  }
  if (!cues.length) throw new Error('没有从分镜中提取到旁白或台词，无法生成字幕')
  const content = cues.map((cue, index) => `${index + 1}\n${toSrtTimestamp(cue.start)} --> ${toSrtTimestamp(cue.end)}\n${cue.text}`).join('\n\n')
  await saveEpisodeSubtitles(episodeId, content)
  return content
}

/**
 * 拼接一集的镜头视频。
 * 优先使用视频生成产物，兼容历史的 composedVideoUrl 数据。
 * 传入 storyboardIds 时只拼接所选镜头（仍按镜号顺序）。
 */
export async function mergeEpisodeVideos(episodeId: number, dramaId: number, storyboardIds?: number[]): Promise<number> {
  const context = requireCurrentTenant()
  const { drama, storyboards } = await getMergeInputs(context, episodeId, dramaId, storyboardIds)
  const openingVideoUrl = getDramaVideoUrl(drama?.metadata ?? null, 'openingVideoUrl')
  const endingVideoUrl = getDramaVideoUrl(drama?.metadata ?? null, 'endingVideoUrl')


  // 允许部分拼接:按镜号顺序拼接已生成的镜头,未生成的跳过
  const clips = storyboards
    .map(sb => ({ sb, url: sb.videoUrl || sb.composedVideoUrl }))
    .filter(c => Boolean(c.url)) as { sb: typeof storyboards[number]; url: string }[]

  if (clips.length === 0) throw new Error('所选镜头还没有可拼接的视频')

  // 拼接前探测 ffmpeg：二进制损坏时 fluent-ffmpeg 的同步 EFTYPE 会崩掉整个进程，
  // 这里提前拦截并给出可操作的修复指引（路由层会作为 400 返回前端）
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg || !suite.ffprobe) {
    throw new Error('本机 ffmpeg 不可用，无法拼接视频（常见于 node_modules 跨平台拷贝或 ffmpeg-static 下载损坏）。请删除 node_modules 后在本机重新 npm install，或设置 FFMPEG_BIN 指向有效的 ffmpeg 可执行文件后重启服务')
  }

  const mergeClips = [
    ...(openingVideoUrl ? [{ label: '片头', url: openingVideoUrl }] : []),
    ...clips.map(c => ({ label: `S${c.sb.storyboardNumber}`, url: c.url })),
    ...(endingVideoUrl ? [{ label: '片尾', url: endingVideoUrl }] : []),
  ]

  // 校验视频文件真实存在:DB 里的 video_url 可能指向已被清理的文件,
  // 直接拼会得到 ffmpeg 的 "No such file or directory" 晦涩报错
  const missing = mergeClips.filter(c => !fs.existsSync(toAbsPath(c.url)))
  if (missing.length > 0) {
    const labels = missing.map(c => c.label).join('、')
    throw new Error(`${labels} 的视频文件不存在于服务器，请重新生成对应视频后再拼接`)
  }

  const videos = mergeClips.map(c => c.url)

  logTaskStart('MergeTask', 'episode-merge', { episodeId, dramaId, clips: videos.length, hasOpening: Boolean(openingVideoUrl), hasEnding: Boolean(endingVideoUrl) })

  const mergeId = await createMerge(context, episodeId, dramaId, videos)

  // 异步执行
  runWithTenant(context, () => doMerge(mergeId, episodeId, videos)).catch(async err => {
    logTaskError('MergeTask', 'episode-merge', { mergeId, episodeId, error: err.message })
    await failMerge(context, mergeId, err.message)
  }).catch(err => {
    logTaskError('MergeTask', 'record-failure', { mergeId, episodeId })
  })

  return mergeId
}

async function doMerge(mergeId: number, episodeId: number, videos: string[]) {
  // 输出文件
  const outputFilename = `${uuid()}.mp4`
  const mergedRelative = `static/merged/${outputFilename}`
  const subtitlePath = toAbsPath(subtitleAssRelativePath(episodeId))
  const hasSubtitles = fs.existsSync(subtitlePath)

  // 生成视频常来自不同服务，音频采样率和时间戳并不一致。concat demuxer 会在
  // 这种情况下只保留开头的一小段音频，所以必须先将每段标准化再用 concat filter 合并。
  const filters: string[] = []
  for (let index = 0; index < videos.length; index++) {
    filters.push(
      `[${index}:v]scale=864:496,setsar=1,fps=24[v${index}]`,
      `[${index}:a]aresample=48000,aformat=channel_layouts=stereo[a${index}]`,
    )
  }
  const concatInputs = videos.map((_, index) => `[v${index}][a${index}]`).join('')
  filters.push(`${concatInputs}concat=n=${videos.length}:v=1:a=1[mergedv][mergeda]`)
  if (hasSubtitles) {
    const escapeFilterPath = (value: string) => value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")
    filters.push(`[mergedv]ass=filename='${escapeFilterPath(subtitlePath)}':fontsdir='${escapeFilterPath(path.join(DATA_ROOT, 'fonts'))}'[videoout]`)
  } else {
    filters.push('[mergedv]null[videoout]')
  }

  const command = ffmpeg()
  for (const video of videos) command.input(toAbsPath(video))
  command
      .complexFilter(filters)
      .outputOptions([
        '-map', '[videoout]',
        '-map', '[mergeda]',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-ar', '48000',
        '-b:a', '192k',
        '-movflags', '+frag_keyframe+empty_moov',
      ])
  let duration = 0
  await writeFfmpegMedia(mergedRelative, command, 'mp4', async temporaryPath => {
    duration = await getVideoDuration(temporaryPath)
  })

  // 成片海报帧（导出页封面用）
  await extractVideoPoster(mergedRelative)

  await completeMerge(requireCurrentTenant(), mergeId, episodeId, mergedRelative, duration)

  logTaskSuccess('MergeTask', 'episode-merge', { mergeId, episodeId, output: mergedRelative, duration, clips: videos.length, hasSubtitles })
}

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err)
      const duration = metadata.format.duration
      if (!duration || !Number.isFinite(duration) || duration <= 0 || !metadata.streams.some(stream => stream.codec_type === 'video')) {
        return reject(new Error('生成视频无有效视频流或时长'))
      }
      resolve(Math.max(1, Math.round(duration)))
    })
  })
}
