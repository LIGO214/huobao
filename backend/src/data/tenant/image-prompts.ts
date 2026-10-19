import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import type { TenantContext } from '../../types/tenant.js'
import { requireResourceId, resourceNotFound } from '../errors.js'
import { requireAgentEpisode } from './agent-scripts.js'
import { getDramaStylePrompt } from './styles.js'
import { now } from '../../utils/response.js'

export async function getPromptCharacter(context: TenantContext, episodeId: number, dramaId: number, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  await requireAgentEpisode(context, episodeId, dramaId)
  const [row] = await db.select().from(schema.characters).where(and(
    eq(schema.characters.userId, userId), eq(schema.characters.dramaId, dramaId), eq(schema.characters.id, id), isNull(schema.characters.deletedAt),
  ))
  if (!row) resourceNotFound()
  return row
}

export async function getPromptScene(context: TenantContext, episodeId: number, dramaId: number, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  await requireAgentEpisode(context, episodeId, dramaId)
  const [row] = await db.select().from(schema.scenes).where(and(
    eq(schema.scenes.userId, userId), eq(schema.scenes.dramaId, dramaId), eq(schema.scenes.id, id), isNull(schema.scenes.deletedAt),
  ))
  if (!row) resourceNotFound()
  return row
}

export async function getPromptProp(context: TenantContext, episodeId: number, dramaId: number, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  await requireAgentEpisode(context, episodeId, dramaId)
  const [row] = await db.select().from(schema.props).where(and(
    eq(schema.props.userId, userId), eq(schema.props.dramaId, dramaId), eq(schema.props.id, id), isNull(schema.props.deletedAt),
  ))
  if (!row) resourceNotFound()
  return row
}

async function composePrompt(context: TenantContext, dramaId: number, prompt: string) {
  const style = await getDramaStylePrompt(context, dramaId)
  return style ? `${style}, ${prompt}` : prompt
}

export async function saveCharacterPrompt(context: TenantContext, episodeId: number, dramaId: number, id: number, prompt: string) {
  await getPromptCharacter(context, episodeId, dramaId, id)
  const finalPrompt = await composePrompt(context, dramaId, prompt)
  const [row] = await db.update(schema.characters).set({ finalPrompt, updatedAt: now() }).where(and(
    eq(schema.characters.userId, context.userId), eq(schema.characters.dramaId, dramaId), eq(schema.characters.id, id), isNull(schema.characters.deletedAt),
  )).returning()
  if (!row) resourceNotFound()
  return row
}

export async function saveScenePrompt(context: TenantContext, episodeId: number, dramaId: number, id: number, prompt: string) {
  await getPromptScene(context, episodeId, dramaId, id)
  const finalPrompt = await composePrompt(context, dramaId, prompt)
  const [row] = await db.update(schema.scenes).set({ finalPrompt, updatedAt: now() }).where(and(
    eq(schema.scenes.userId, context.userId), eq(schema.scenes.dramaId, dramaId), eq(schema.scenes.id, id), isNull(schema.scenes.deletedAt),
  )).returning()
  if (!row) resourceNotFound()
  return row
}

export async function savePropPrompt(context: TenantContext, episodeId: number, dramaId: number, id: number, prompt: string) {
  await getPromptProp(context, episodeId, dramaId, id)
  const finalPrompt = await composePrompt(context, dramaId, prompt)
  const [row] = await db.update(schema.props).set({ finalPrompt, updatedAt: now() }).where(and(
    eq(schema.props.userId, context.userId), eq(schema.props.dramaId, dramaId), eq(schema.props.id, id), isNull(schema.props.deletedAt),
  )).returning()
  if (!row) resourceNotFound()
  return row
}
