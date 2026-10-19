import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('volcengine adapter keeps Seedance model names on the v3 contract', () => {
  const adapter = read('src/services/adapters/volcengine-video.ts')

  // Both verified model families keep their names and use the same v3 endpoint.
  assert.match(adapter, /SEEDANCE2_MODEL_PREFIXES = \['doubao-seedance-2-0', 'dreamina-seedance-2-0'/)
  assert.match(adapter, /SEEDANCE2_MODEL_PREFIXES\.some\(prefix => model\.startsWith\(prefix\)\)/)
  assert.doesNotMatch(adapter, /\/v1|\/video\/generations|usesDreaminaGateway/)
  assert.match(adapter, /joinProviderUrl\(config\.baseUrl, '\/api\/v3', '\/contents\/generations\/tasks'\)/)

  // 只保留多模态参考：其他模式分支与历史映射已清理
  assert.doesNotMatch(adapter, /mode === 'text'/)
  assert.doesNotMatch(adapter, /mode === 'first_frame'/)
  assert.doesNotMatch(adapter, /mode === 'first_last'/)
  assert.doesNotMatch(adapter, /LEGACY_MODE_MAP/)
  assert.doesNotMatch(adapter, /first_frame/)
  assert.doesNotMatch(adapter, /last_frame/)

  // 多模态 content 项角色
  assert.match(adapter, /role: 'reference_image'/)
  assert.match(adapter, /role: 'reference_video'/)
  assert.match(adapter, /role: 'reference_audio'/)

  // 素材上限 9/3/3、音频需视觉素材约束、至少一个素材或 prompt
  assert.match(adapter, /REF_LIMITS = \{ images: 9, videos: 3, audios: 3 \}/)
  assert.match(adapter, /参考音频需要至少 1 个参考图片或视频/)
  assert.match(adapter, /多模态参考模式需要至少一个参考素材或 prompt/)

  // generate_audio 可配置（默认开），时长支持 4-15 秒；分辨率随集固定（480p/720p，默认 720p）
  assert.match(adapter, /generate_audio:\s*record\.generateAudio/)
  assert.match(adapter, /Math\.min\(15, Math\.max\(4, parsed\)\)/)
  assert.match(adapter, /const resolution = record\.resolution === '480p' \? '480p' : '720p'/)
  assert.match(adapter, /\n      resolution,/)
})

test('Web video generation persists text parameters and keeps unverified references closed', () => {
  const service = read('src/services/generation.ts')

  assert.doesNotMatch(service, /PUBLIC_BASE_URL|resolvePublicMediaUrl|normalizeVideoReference|preferSeedanceCharacterAssets/)
  assert.match(service, /requireTextOnlyVideo\(params\)/)
  assert.match(service, /params\.referenceVideoUrls\?\.length/)
  assert.match(service, /params\.referenceAudioUrls\?\.length/)
  assert.match(service, /视频参考素材暂未开放/)
  assert.match(service, /generateAudio: params\.generateAudio === false \? 0 : 1/)
  assert.match(service, /referenceMode: 'text'/)
  const page = read('../frontend/app/views/drama/episode.vue')
  const generate = page.split('async function genVid(')[1].split('async function pollVideoGeneration(')[0]
  assert.match(page, /value="reference" disabled/)
  assert.match(generate, /prompt: sb\.video_prompt \|\| sb\.videoPrompt \|\| ''/)
  assert.doesNotMatch(generate, /reference_image_urls|resolveVideoPromptRefs/)
})

test('video resolution is fixed per episode, editable, and locked into video tasks', () => {
  const episodes = read('src/routes/episodes.ts')
  const data = read('src/data/tenant/episodes.ts')
  const tasks = read('src/routes/tasks.ts')
  const service = read('src/services/generation.ts')

  // Both create/update accept the current supported values and the domain validates them again.
  assert.equal((episodes.match(/resolution: z\.enum\(\['480p', '720p', '1080p'\]\)/g) || []).length, 2)
  assert.equal((data.match(/\['480p', '720p', '1080p'\]\.includes\(fields\.resolution\)/g) || []).length, 2)
  assert.match(data, /resolution: fields\.resolution \?\? '720p'/)
  // 视频任务锁定集的分辨率（优先于请求体）
  assert.match(tasks, /episodeResolution = ep\.resolution/)
  assert.match(tasks, /resolution: episodeResolution \|\| videoBody!\.resolution/)
  // 服务落入 params 并传给适配器
  assert.match(service, /resolution: normalizeStoredVideoResolution\(params\.resolution\)/)
  assert.match(service, /resolution: params\.resolution,/)
})

test('upload route exposes validated video and audio endpoints', () => {
  const route = read('src/routes/upload.ts')

  assert.match(route, /app\.post\('\/video'/)
  assert.match(route, /app\.post\('\/audio'/)
  assert.match(route, /video: new Set\(\['video\/mp4', 'video\/quicktime', 'video\/webm', 'video\/x-m4v'\]\)/)
  assert.match(route, /audio: new Set\(\['audio\/mpeg', 'audio\/wav', 'audio\/x-wav', 'audio\/mp4', 'audio\/x-m4a', 'audio\/aac'\]\)/)
  assert.match(route, /fileTypeFromBuffer\(new Uint8Array\(buffer\)\)/)
  assert.match(route, /formats\[kind\]\.has\(detected\.mime\)/)
  assert.match(route, /limits\.audioUploadMaxBytes : limits\.uploadMaxBytes/)
  const limits = read('src/config/env.ts')
  assert.match(limits, /HUOBAO_UPLOAD_MAX_BYTES:.*50 \* 1024 \* 1024/)
  assert.match(limits, /HUOBAO_AUDIO_UPLOAD_MAX_BYTES:.*20 \* 1024 \* 1024/)
})

test('tasks route validates reference-mode requirements for video tasks', () => {
  const route = read('src/routes/tasks.ts')

  // 统一任务入口：type 分派 image/video
  assert.match(route, /type 必须为 image 或 video/)
  assert.match(route, /generateImage\(\{/)
  assert.match(route, /generateVideo\(\{/)

  // 其他模式的校验已清理
  assert.doesNotMatch(route, /文生视频模式必须提供 prompt/)
  assert.doesNotMatch(route, /首帧模式必须提供 first_frame_url/)
  assert.doesNotMatch(route, /首尾帧模式必须同时提供/)
  // Wan 3.0 官方入参兼容层会把 input.media 归一到 first_frame_url/last_frame_url 等扁平字段

  // 多模态参考校验并固定 reference 模式
  assert.match(route, /参考素材超限：图片≤9、视频≤3、音频≤3/)
  assert.match(route, /参考音频需要至少 1 个参考图片或视频/)
  assert.match(route, /视频生成需要至少一个参考素材或 prompt/)
  assert.match(route, /referenceMode: 'reference'/)
  assert.match(route, /referenceVideoUrls: videoBody!\.reference_video_urls/)
  assert.match(route, /referenceAudioUrls: videoBody!\.reference_audio_urls/)
  assert.match(route, /generateAudio: videoBody!\.generate_audio/)
  assert.match(route, /视频参考素材暂未开放，请仅使用文字提示词/)
  const service = read('src/services/generation.ts')
  assert.match(service, /视频参考素材暂未开放，请仅使用文字提示词/)
  assert.match(service, /validateAssetImage\(tenant, image\)/)
  assert.doesNotMatch(service, /fetchImageAsCompressedDataUrl/)
})

test('image/video generation tasks are unified into a single sys_task table', () => {
  const schema = read('src/db/schema.ts')
  const migration = read('src/db/migrations/0000_web_tenant_schema.sql')
  const envExample = read('../.env.example')

  // sys_task：type 区分 image/video，生成参数收进 params(JSON)
  assert.match(schema, /export const sysTask = pgTable\('sys_task'/)
  assert.match(schema, /type: text\('type'\)\.notNull\(\)/)
  assert.match(schema, /params: text\('params'\)/)
  assert.match(schema, /resultUrl: text\('result_url'\)/)
  assert.match(schema, /localPath: text\('local_path'\)/)

  // 旧的 image_generations / video_generations 表定义与回填已移除
  assert.doesNotMatch(schema, /imageGenerations/)
  assert.doesNotMatch(schema, /videoGenerations/)
  assert.doesNotMatch(migration, /CREATE TABLE "(?:image_generations|video_generations)"/)
  const ddl = migration.split('CREATE TABLE "sys_task" (')[1].split('--> statement-breakpoint')[0]
  assert.match(ddl, /"type" text NOT NULL/)
  assert.match(ddl, /"params" text/)
  assert.match(ddl, /"result_url" text/)
  assert.match(ddl, /"user_id" integer NOT NULL/)
  assert.doesNotMatch(migration, /DROP TABLE/)

  // Routes and services use the tenant domain; only that module writes sys_task.
  const tasksRoute = read('src/routes/tasks.ts')
  const service = read('src/services/generation.ts')
  const domain = read('src/data/tenant/tasks.ts')
  assert.match(tasksRoute, /listGenerationTasks\(requireCurrentTenant\(\)/)
  assert.match(tasksRoute, /type: filters\.type/)
  assert.match(service, /createGenerationTask\(tenant, type/)
  assert.match(domain, /eq\(schema\.sysTask\.userId, userId\)/)
  assert.match(domain, /eq\(schema\.sysTask\.type, filters\.type\)/)
  assert.match(domain, /tx\.insert\(schema\.sysTask\)/)
  assert.doesNotMatch(tasksRoute, /from ['"].*db\/index/)
  assert.doesNotMatch(service, /from ['"].*db\/index/)

  assert.match(envExample, /PUBLIC_BASE_URL/)
})
