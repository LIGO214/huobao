import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { requireResourceId, resourceNotFound } from '../errors.js'

export async function requireEpisode(context: TenantContext, episodeId: number) {
  const { userId } = validateTenant(context)
  requireResourceId(episodeId)
  const [row] = await db.select({ episode: schema.episodes }).from(schema.episodes)
    .innerJoin(schema.dramas, and(eq(schema.dramas.userId, userId), eq(schema.dramas.id, schema.episodes.dramaId), isNull(schema.dramas.deletedAt)))
    .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, episodeId), isNull(schema.episodes.deletedAt)))
  if (!row) resourceNotFound()
  return row.episode
}

export async function requireAgentEpisode(context: TenantContext, episodeId: number, dramaId: number) {
  requireResourceId(dramaId)
  const episode = await requireEpisode(context, episodeId)
  if (episode.dramaId !== dramaId) resourceNotFound()
  return episode
}

export async function saveAgentScript(context: TenantContext, episodeId: number, dramaId: number, content: string) {
  const { userId } = validateTenant(context)
  await requireAgentEpisode(context, episodeId, dramaId)
  const result = await db.update(schema.episodes).set({ scriptContent: content, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, episodeId), eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}
