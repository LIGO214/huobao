/**
 * 内置文本工作区只读，固定来自随版本发布的 backend/workspace。
 * 仅服务端读取 Prompt/Skill 文本，不为 Agent 注册文件或命令执行工具。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Workspace, LocalFilesystem } from '@mastra/core/workspace'
import { agentCatalog } from './catalog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WORKSPACE_DIR = path.resolve(__dirname, '../../workspace')
const SKILLS_DIR = path.join(WORKSPACE_DIR, 'skills')

fs.accessSync(SKILLS_DIR, fs.constants.R_OK)

for (const [type, definition] of Object.entries(agentCatalog)) {
  fs.accessSync(path.join(WORKSPACE_DIR, 'prompts', `${type}.md`), fs.constants.R_OK)
  for (const prefix of definition.skillPrefixes) fs.accessSync(path.join(SKILLS_DIR, prefix, 'SKILL.md'), fs.constants.R_OK)
}

/** 每个 Agent 注册的 skill 目录（相对 workspace/skills/，含子规范目录；目录名需符合 Agent Skills 规范：小写+连字符） */
const AGENT_SKILL_MAP: Record<string, string[]> = Object.fromEntries(
  Object.entries(agentCatalog).map(([type, definition]) => [type, definition.skillPrefixes]),
)

/** Read-only built-in skills, grouped by the server-owned Agent catalog. */
export const skillWorkspaces: Record<string, Workspace> = Object.fromEntries(
  Object.entries(AGENT_SKILL_MAP).map(([agentType, prefixes]) => [
    agentType,
    new Workspace({
      id: `workspace-${agentType}`,
      name: `${agentType} workspace`,
      filesystem: new LocalFilesystem({ basePath: WORKSPACE_DIR, readOnly: true }),
      skills: () => scanSkillPaths().filter(p =>
        prefixes.some(prefix => p === `skills/${prefix}` || p.startsWith(`skills/${prefix}/`))),
    }),
  ]),
)

/** 递归扫描 workspace/skills/ 下所有含 SKILL.md 的目录（相对 workspace 根的路径） */
function scanSkillPaths(): string[] {
  const found: string[] = []
  const walk = (dir: string, prefix: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = path.join(dir, entry.name)
      if (fs.existsSync(path.join(full, 'SKILL.md'))) found.push(`skills/${rel}`)
      walk(full, rel)
    }
  }
  walk(SKILLS_DIR, '')
  return found
}

/**
 * Read-only workspace for listing the built-in skill catalog.
 */
export const skillsManagerWorkspace = new Workspace({
  id: 'workspace-skills-manager',
  name: 'skills manager',
  filesystem: new LocalFilesystem({ basePath: WORKSPACE_DIR, readOnly: true }),
  skills: () => scanSkillPaths(),
})

function formatSkillSection(skillId: string, content: string): string {
  return [`## Skill: ${skillId}`, content].join('\n')
}

/** 剥离 SKILL.md 风格文件的 frontmatter，返回正文（供语言变体直读使用） */
function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return (m ? raw.slice(m[0].length) : raw).trim()
}

/** 读取技能的语言变体正文（SKILL.<lang>.md，直读绕缓存永远最新）；不存在返回 null */
async function readLocalizedSkill(relPath: string, lang: string): Promise<string | null> {
  const fsm = skillsManagerWorkspace.filesystem!
  const p = `skills/${relPath}/SKILL.${lang}.md`
  if (!await fsm.exists(p)) return null
  const body = stripFrontmatter(String(await fsm.readFile(p, { encoding: 'utf-8' })))
  if (!body) throw new Error('内置 Skill 内容为空')
  return body
}

/** 读取 Agent 专属技能全文（经 workspace.skills API，保持原注入格式）
 *  AGENT_SKILL_MAP 的目录按前缀匹配：目录自身及其子目录下所有 SKILL.md 都会注入，
 *  User text is stored separately in PostgreSQL and never creates workspace files.
 *  lang 非 zh 时逐技能优先 SKILL.<lang>.md，缺失回退基础版（中文） */
export async function loadAgentSkills(agentType: string, lang?: string | null): Promise<string> {
  const workspace = skillWorkspaces[agentType]
  const prefixes = AGENT_SKILL_MAP[agentType] || []
  if (!workspace || !prefixes.length) return ''

  const allPaths = scanSkillPaths().map(p => p.replace(/^skills\//, ''))
  const relPaths = allPaths.filter(p =>
    prefixes.some(prefix => p === prefix || p.startsWith(prefix + '/')))

  const useLocalized = Boolean(lang && lang !== 'zh')
  const contents: string[] = []
  for (const relPath of relPaths) {
    let body: string | null | undefined
    if (useLocalized) body = await readLocalizedSkill(relPath, lang!)
    if (!body) {
      const skill = await workspace.skills?.get(`skills/${relPath}`)
      body = skill?.instructions?.trim()
    }
    if (!body) throw new Error(`内置 Skill 无法读取：${relPath}`)
    contents.push(formatSkillSection(relPath, body))
  }

  if (!contents.length) return ''

  return [
    '以下是该 Agent 专属的项目技能规范（SKILL.md）。',
    '不同 Agent 会加载不同 skill；你只需要遵守当前注入的这些技能。',
    '你必须在不违背当前工具边界的前提下优先遵守这些规范；若与用户明确要求冲突，以用户要求为准。',
    '',
    contents.join('\n\n'),
  ].join('\n')
}

/**
 * 强制重新扫描全部 Agent 的技能（SKILL.md 编辑后调用）
 * maybeRefresh 负责感知目录增删（动态 resolver 路径变化），refresh 负责内容更新
 * （目录 mtime 不会因文件内容编辑而更新，单靠 maybeRefresh 的 staleness 检查不可靠）
 */
export async function refreshSkillWorkspaces(): Promise<void> {
  await Promise.all(
    [...Object.values(skillWorkspaces), skillsManagerWorkspace]
      .map(async workspace => {
        await workspace.skills?.maybeRefresh()
        await workspace.skills?.refresh()
      }),
  )
}
