/**
 * 用户级内容设置（app_settings 由 user_id + key 唯一定位）
 * AI 内容语言：所有 Agent 产出（剧本/提取/分镜/提示词）统一使用的目标语言
 * 层次约束：本模块只依赖 db，严禁反向 import agents/*（agents/context.ts 会引用本模块）
 *
 */
import { getUserSetting, saveUserSetting } from '../data/tenant/settings.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'

export const CONTENT_LANGUAGES = ['zh', 'en', 'ja', 'ko'] as const
export type ContentLanguage = typeof CONTENT_LANGUAGES[number]

const CONTENT_LANGUAGE_KEY = 'content_language'

function isContentLanguage(v: unknown): v is ContentLanguage {
  return typeof v === 'string' && (CONTENT_LANGUAGES as readonly string[]).includes(v)
}

export async function getContentLanguage(): Promise<ContentLanguage> {
  const value = await getUserSetting(requireCurrentTenant(), CONTENT_LANGUAGE_KEY)
  if (value === undefined) return 'zh'
  if (!isContentLanguage(value)) throw new Error('用户内容语言配置无效')
  return value
}

export async function setContentLanguage(lang: ContentLanguage): Promise<ContentLanguage> {
  if (!isContentLanguage(lang)) throw new Error(`Invalid content language: ${lang}`)
  await saveUserSetting(requireCurrentTenant(), CONTENT_LANGUAGE_KEY, lang)
  return lang
}
