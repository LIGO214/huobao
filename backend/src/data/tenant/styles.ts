import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { requireDrama } from './dramas.js'
import { invalidInput } from '../errors.js'

export async function getDramaStylePrompt(context: TenantContext, dramaId: number): Promise<string> {
  const drama = await requireDrama(context, dramaId)
  if (!drama.style) return ''
  const [privateStyle] = await db.select().from(schema.stylePresets).where(and(
    eq(schema.stylePresets.userId, context.userId), eq(schema.stylePresets.value, drama.style),
  ))
  const [systemStyle] = privateStyle ? [] : await db.select().from(schema.stylePresets).where(and(
    isNull(schema.stylePresets.userId), eq(schema.stylePresets.value, drama.style),
  ))
  const style = privateStyle ?? systemStyle
  if (!style?.isActive) invalidInput('项目风格不存在或已停用')
  return style.prompt
}
