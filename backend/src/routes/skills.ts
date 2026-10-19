/** Built-in skills are read-only. User skills are database text, never files or tools. */
import { Hono } from 'hono'
import { success, created } from '../utils/response.js'
import { skillsManagerWorkspace } from '../agents/skills.js'
import { agentCatalog, contentLanguageInput } from '../agents/catalog.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { invalidInput, resourceNotFound, requireResourceId } from '../data/errors.js'
import { createSkillInput, skillInput, createUserSkill, updateUserSkill, deleteUserSkill,
  listUserSkills, requireUserSkill } from '../data/tenant/agent-customizations.js'
import { readInput } from './asset-input.js'
import { logTaskSuccess } from '../utils/task-logger.js'
import { appConfig } from '../config/env.js'

const app = new Hono()
const userId = (id: string) => {
  if (!/^user:[1-9][0-9]*$/.test(id)) invalidInput('用户 Skill 编号无效')
  return requireResourceId(Number(id.slice(5)))
}
const present = (row: Awaited<ReturnType<typeof requireUserSkill>>) => ({
  id: `user:${row.id}`, agent_type: row.agentType, name: row.name, content: row.content,
  enabled: row.enabled, sort_order: row.sortOrder, is_default: false,
})

app.get('/', async c => {
  const tenant = requireCurrentTenant()
  const metas = await skillsManagerWorkspace.skills!.list()
  const builtIn = metas.map(meta => {
    const id = meta.path.replace(/^skills\//, '')
    const type = Object.entries(agentCatalog).find(([, entry]) => entry.skillPrefixes.some(prefix => id === prefix || id.startsWith(`${prefix}/`)))?.[0]
    if (!type) throw new Error('内置 Skill 未登记所属 Agent')
    return { id, agent_type: type, name: meta.name, description: meta.description ?? '', is_default: true, read_only: true }
  })
  const user = (await listUserSkills(tenant)).map(present)
  return success(c, { built_in: builtIn, user, limits: { max_length: appConfig.limits.skillMaxLength,
    max_count: appConfig.limits.skillsPerAgent, total_length: appConfig.limits.agentTextMaxLength } })
})

app.get('/*', async c => {
  const tenant = requireCurrentTenant()
  const id = c.req.path.slice('/api/v1/skills/'.length)
  if (id.startsWith('user:')) return success(c, present(await requireUserSkill(tenant, userId(id))))
  const known = (await skillsManagerWorkspace.skills!.list()).some(meta => meta.path === `skills/${id}`)
  if (!known) resourceNotFound()
  const lang = contentLanguageInput.safeParse(c.req.query('lang') ?? 'zh')
  if (!lang.success) invalidInput('不支持的内容语言')
  const filesystem = skillsManagerWorkspace.filesystem!
  const localized = `skills/${id}/SKILL.${lang.data}.md`
  const file = lang.data !== 'zh' && await filesystem.exists(localized) ? localized : `skills/${id}/SKILL.md`
  const content = await filesystem.readFile(file, { encoding: 'utf-8' })
  return success(c, { id, content, is_default: true, read_only: true })
})

app.post('/', async c => {
  const body = await readInput(c, createSkillInput)
  const row = await createUserSkill(requireCurrentTenant(), body)
  logTaskSuccess('Skill', 'create', { resource_id: row.id })
  return created(c, present(row))
})

app.put('/*', async c => {
  const id = c.req.path.slice('/api/v1/skills/'.length)
  if (!id.startsWith('user:')) invalidInput('内置 Skill 只读')
  const body = await readInput(c, skillInput.partial().refine(value => Object.keys(value).length > 0))
  const row = await updateUserSkill(requireCurrentTenant(), userId(id), body)
  logTaskSuccess('Skill', 'update', { resource_id: row.id })
  return success(c, present(row))
})

app.delete('/*', async c => {
  const id = c.req.path.slice('/api/v1/skills/'.length)
  if (!id.startsWith('user:')) invalidInput('内置 Skill 只读')
  const numericId = userId(id)
  await deleteUserSkill(requireCurrentTenant(), numericId)
  logTaskSuccess('Skill', 'delete', { resource_id: numericId })
  return success(c)
})

export default app
