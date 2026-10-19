import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { agentTypeInput, contentLanguageInput } from '../../agents/catalog.js'
import { appConfig } from '../../config/env.js'
import { invalidInput, requireResourceId, resourceNotFound } from '../errors.js'
import { now } from '../../utils/response.js'

const limits = appConfig.limits
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => !value.includes('\0'))
export const promptInput = text(limits.promptMaxLength)
export const skillInput = z.object({
  name: text(120), content: text(limits.skillMaxLength),
  enabled: z.boolean().optional(), sort_order: z.number().int().min(0).max(10_000).optional(),
}).strict()
export const createSkillInput = skillInput.extend({
  agent_type: agentTypeInput,
  id: z.string().regex(/^[a-z0-9-]{1,120}$/).optional(),
})

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function parse<T extends z.ZodType>(input: T, value: unknown): z.output<T> {
  const result = input.safeParse(value)
  if (!result.success) invalidInput('用户指令参数无效或超过长度限制')
  return result.data
}

// One short transaction per user prevents concurrent saves from exceeding the text budget.
async function lockUser(tx: Transaction, userId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(73641, ${userId})`)
}

async function checkBudget(tx: Transaction, userId: number, agentType: string) {
  const prompts = await tx.select({ text: schema.userAgentPrompts.instructions }).from(schema.userAgentPrompts)
    .where(and(eq(schema.userAgentPrompts.userId, userId), eq(schema.userAgentPrompts.agentType, agentType)))
  const skills = await tx.select({ text: schema.userAgentSkills.content }).from(schema.userAgentSkills)
    .where(and(eq(schema.userAgentSkills.userId, userId), eq(schema.userAgentSkills.agentType, agentType)))
  if (skills.length > limits.skillsPerAgent ||
    [...prompts, ...skills].reduce((total, row) => total + row.text.length, 0) > limits.agentTextMaxLength) {
    invalidInput('当前 Agent 的用户指令数量或总长度已达到上限')
  }
}

export async function getUserPrompt(context: TenantContext, agentType: string, lang = 'zh') {
  const { userId } = validateTenant(context)
  parse(agentTypeInput, agentType)
  parse(contentLanguageInput, lang)
  const [row] = await db.select().from(schema.userAgentPrompts).where(and(
    eq(schema.userAgentPrompts.userId, userId), eq(schema.userAgentPrompts.agentType, agentType), eq(schema.userAgentPrompts.lang, lang),
  ))
  return row?.instructions ?? ''
}

export async function saveUserPrompt(context: TenantContext, agentType: string, lang: string, instructions: string) {
  const { userId } = validateTenant(context)
  parse(agentTypeInput, agentType)
  parse(contentLanguageInput, lang)
  instructions = parse(promptInput, instructions)
  await db.transaction(async tx => {
    await lockUser(tx, userId)
    const timestamp = now()
    await tx.insert(schema.userAgentPrompts).values({ userId, agentType, lang, instructions, createdAt: timestamp, updatedAt: timestamp })
      .onConflictDoUpdate({ target: [schema.userAgentPrompts.userId, schema.userAgentPrompts.agentType, schema.userAgentPrompts.lang],
        set: { instructions, updatedAt: timestamp } })
    await checkBudget(tx, userId, agentType)
  })
  return instructions
}

export async function resetUserPrompt(context: TenantContext, agentType: string, lang: string) {
  const { userId } = validateTenant(context)
  parse(agentTypeInput, agentType)
  parse(contentLanguageInput, lang)
  await db.transaction(async tx => {
    await lockUser(tx, userId)
    await tx.delete(schema.userAgentPrompts).where(and(eq(schema.userAgentPrompts.userId, userId),
      eq(schema.userAgentPrompts.agentType, agentType), eq(schema.userAgentPrompts.lang, lang)))
  })
}

export async function listUserSkills(context: TenantContext, agentType?: string) {
  const { userId } = validateTenant(context)
  if (agentType !== undefined) parse(agentTypeInput, agentType)
  return db.select().from(schema.userAgentSkills).where(and(eq(schema.userAgentSkills.userId, userId),
    agentType === undefined ? undefined : eq(schema.userAgentSkills.agentType, agentType)))
    .orderBy(asc(schema.userAgentSkills.sortOrder), asc(schema.userAgentSkills.id))
}

export async function requireUserSkill(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const [row] = await db.select().from(schema.userAgentSkills).where(and(eq(schema.userAgentSkills.userId, userId), eq(schema.userAgentSkills.id, id)))
  if (!row) resourceNotFound()
  return row
}

export async function createUserSkill(context: TenantContext, fields: z.infer<typeof createSkillInput>) {
  const { userId } = validateTenant(context)
  const input = parse(createSkillInput, fields)
  return db.transaction(async tx => {
    await lockUser(tx, userId)
    const timestamp = now()
    const [row] = await tx.insert(schema.userAgentSkills).values({ userId, agentType: input.agent_type,
      skillId: input.id ?? randomUUID(), name: input.name, content: input.content, enabled: input.enabled ?? true,
      sortOrder: input.sort_order ?? 0, createdAt: timestamp, updatedAt: timestamp }).onConflictDoNothing().returning()
    if (!row) invalidInput('用户 Skill 已存在')
    await checkBudget(tx, userId, input.agent_type)
    return row
  })
}

export async function updateUserSkill(context: TenantContext, id: number, fields: Partial<z.infer<typeof skillInput>>) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const input = parse(skillInput.partial().refine(value => Object.keys(value).length > 0), fields)
  return db.transaction(async tx => {
    await lockUser(tx, userId)
    const [row] = await tx.update(schema.userAgentSkills).set({ name: input.name, content: input.content,
      enabled: input.enabled, sortOrder: input.sort_order, updatedAt: now() })
      .where(and(eq(schema.userAgentSkills.userId, userId), eq(schema.userAgentSkills.id, id))).returning()
    if (!row) resourceNotFound()
    await checkBudget(tx, userId, row.agentType)
    return row
  })
}

export async function deleteUserSkill(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  await db.transaction(async tx => {
    await lockUser(tx, userId)
    const result = await tx.delete(schema.userAgentSkills).where(and(eq(schema.userAgentSkills.userId, userId), eq(schema.userAgentSkills.id, id)))
    if (!result.rowCount) resourceNotFound()
  })
}

export async function getAgentTextSnapshot(context: TenantContext, agentType: string, lang: string) {
  const { userId } = validateTenant(context)
  parse(agentTypeInput, agentType)
  parse(contentLanguageInput, lang)
  return db.transaction(async tx => {
    await lockUser(tx, userId)
    const [prompt] = await tx.select().from(schema.userAgentPrompts).where(and(eq(schema.userAgentPrompts.userId, userId),
      eq(schema.userAgentPrompts.agentType, agentType), eq(schema.userAgentPrompts.lang, lang)))
    const skills = await tx.select().from(schema.userAgentSkills).where(and(eq(schema.userAgentSkills.userId, userId),
      eq(schema.userAgentSkills.agentType, agentType), eq(schema.userAgentSkills.enabled, true)))
      .orderBy(asc(schema.userAgentSkills.sortOrder), asc(schema.userAgentSkills.id))
    await checkBudget(tx, userId, agentType)
    return { prompt: prompt ? parse(promptInput, prompt.instructions) : '', skills: skills.map(row => ({
      name: parse(text(120), row.name), content: parse(text(limits.skillMaxLength), row.content),
    })) }
  })
}
