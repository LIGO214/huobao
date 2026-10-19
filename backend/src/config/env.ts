import path from 'node:path'
import { z } from 'zod'

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(5679),
  DATABASE_URL: z.string().trim().url().refine(value => /^postgres(?:ql)?:\/\//.test(value), '必须使用 PostgreSQL URL').optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  HUOBAO_PROXY_SECRET: z.string().trim().min(32).optional(),
  HUOBAO_QUNL_MODEL_URL: z.string().trim().url().optional(),
  HUOBAO_DATA_DIR: z.string().trim().min(1).optional(),
  HUOBAO_MODEL_CONFIG_SOURCE: z.literal('user').default('user'),
  HUOBAO_AGENT_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  HUOBAO_IMAGE_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  HUOBAO_VIDEO_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(1),
  HUOBAO_FFMPEG_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(1),
  HUOBAO_GLOBAL_AGENT_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  HUOBAO_GLOBAL_IMAGE_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  HUOBAO_GLOBAL_VIDEO_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  HUOBAO_GLOBAL_FFMPEG_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  HUOBAO_TASK_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(30 * 60 * 1_000),
  HUOBAO_PROMPT_MAX_LENGTH: z.coerce.number().int().min(1).max(100_000).default(20_000),
  HUOBAO_SKILL_MAX_LENGTH: z.coerce.number().int().min(1).max(100_000).default(20_000),
  HUOBAO_SKILLS_MAX_PER_AGENT: z.coerce.number().int().min(1).max(100).default(10),
  HUOBAO_AGENT_TEXT_MAX_LENGTH: z.coerce.number().int().min(1).max(1_000_000).default(60_000),
  HUOBAO_MEDIA_QUOTA_BYTES: z.coerce.number().int().min(1).default(10 * 1024 * 1024 * 1024),
  HUOBAO_MEDIA_FILE_MAX_BYTES: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1024 * 1024 * 1024),
  HUOBAO_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(50 * 1024 * 1024),
  HUOBAO_IMAGE_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1).default(20 * 1024 * 1024),
  HUOBAO_AUDIO_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1).default(20 * 1024 * 1024),
  HUOBAO_JSON_MAX_BYTES: z.coerce.number().int().min(1).default(2 * 1024 * 1024),
  HUOBAO_IMAGE_MAX_PIXELS: z.coerce.number().int().min(1).default(40_000_000),
  HUOBAO_UPLOAD_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  HUOBAO_GLOBAL_UPLOAD_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  HUOBAO_CORS_ORIGINS: z.string().trim().default('http://localhost:3013,http://localhost:5679'),
})

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  databaseUrl?: string
  databasePoolMax: number
  proxySecret?: string
  qunlModelUrl?: string
  dataDir?: string
  modelConfigSource: 'user'
  limits: Readonly<{
    agentPerUser: number
    imagePerUser: number
    videoPerUser: number
    ffmpegPerUser: number
    agentGlobal: number
    imageGlobal: number
    videoGlobal: number
    ffmpegGlobal: number
    taskTimeoutMs: number
    promptMaxLength: number
    skillMaxLength: number
    skillsPerAgent: number
    agentTextMaxLength: number
    mediaQuotaBytes: number
    mediaFileMaxBytes: number
    uploadMaxBytes: number
    imageUploadMaxBytes: number
    audioUploadMaxBytes: number
    jsonMaxBytes: number
    imageMaxPixels: number
    uploadPerUser: number
    uploadGlobal: number
  }>
  corsOrigins: readonly string[]
}>

export type AppConfigOptions = Readonly<{
  requireDatabase?: boolean
  requireProxySecret?: boolean
}>

function formatConfigError(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
    .join('; ')
}

export function loadAppConfig(
  source: NodeJS.ProcessEnv = process.env,
  options: AppConfigOptions = {},
): AppConfig {
  const parsed = rawEnvSchema.safeParse(source)
  if (!parsed.success) {
    throw new Error(`火宝配置无效：${formatConfigError(parsed.error)}`)
  }

  const value = parsed.data
  if (options.requireDatabase && !value.DATABASE_URL) {
    throw new Error('火宝配置无效：正式 Web 模式必须设置 DATABASE_URL')
  }
  if (options.requireProxySecret && !value.HUOBAO_PROXY_SECRET) {
    throw new Error('火宝配置无效：正式 Web 模式必须设置 HUOBAO_PROXY_SECRET')
  }
  if (value.NODE_ENV === 'production' && options.requireProxySecret && value.HUOBAO_PROXY_SECRET === 'change-me') {
    throw new Error('火宝配置无效：生产环境不能使用默认 HUOBAO_PROXY_SECRET')
  }

  const config: AppConfig = {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    databasePoolMax: value.DATABASE_POOL_MAX,
    proxySecret: value.HUOBAO_PROXY_SECRET,
    qunlModelUrl: value.HUOBAO_QUNL_MODEL_URL,
    dataDir: value.HUOBAO_DATA_DIR ? path.resolve(value.HUOBAO_DATA_DIR) : undefined,
    modelConfigSource: value.HUOBAO_MODEL_CONFIG_SOURCE,
    limits: Object.freeze({
      agentPerUser: value.HUOBAO_AGENT_MAX_CONCURRENCY,
      imagePerUser: value.HUOBAO_IMAGE_MAX_CONCURRENCY,
      videoPerUser: value.HUOBAO_VIDEO_MAX_CONCURRENCY,
      ffmpegPerUser: value.HUOBAO_FFMPEG_MAX_CONCURRENCY,
      agentGlobal: value.HUOBAO_GLOBAL_AGENT_MAX_CONCURRENCY,
      imageGlobal: value.HUOBAO_GLOBAL_IMAGE_MAX_CONCURRENCY,
      videoGlobal: value.HUOBAO_GLOBAL_VIDEO_MAX_CONCURRENCY,
      ffmpegGlobal: value.HUOBAO_GLOBAL_FFMPEG_MAX_CONCURRENCY,
      taskTimeoutMs: value.HUOBAO_TASK_TIMEOUT_MS,
      promptMaxLength: value.HUOBAO_PROMPT_MAX_LENGTH,
      skillMaxLength: value.HUOBAO_SKILL_MAX_LENGTH,
      skillsPerAgent: value.HUOBAO_SKILLS_MAX_PER_AGENT,
      agentTextMaxLength: value.HUOBAO_AGENT_TEXT_MAX_LENGTH,
      mediaQuotaBytes: value.HUOBAO_MEDIA_QUOTA_BYTES,
      mediaFileMaxBytes: value.HUOBAO_MEDIA_FILE_MAX_BYTES,
      uploadMaxBytes: value.HUOBAO_UPLOAD_MAX_BYTES,
      imageUploadMaxBytes: value.HUOBAO_IMAGE_UPLOAD_MAX_BYTES,
      audioUploadMaxBytes: value.HUOBAO_AUDIO_UPLOAD_MAX_BYTES,
      jsonMaxBytes: value.HUOBAO_JSON_MAX_BYTES,
      imageMaxPixels: value.HUOBAO_IMAGE_MAX_PIXELS,
      uploadPerUser: value.HUOBAO_UPLOAD_MAX_CONCURRENCY,
      uploadGlobal: value.HUOBAO_GLOBAL_UPLOAD_MAX_CONCURRENCY,
    }),
    corsOrigins: value.HUOBAO_CORS_ORIGINS
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  }

  return Object.freeze(config)
}

export const appConfig = loadAppConfig(process.env, {
  requireDatabase: process.env.NODE_ENV === 'production',
  requireProxySecret: process.env.NODE_ENV === 'production',
})
