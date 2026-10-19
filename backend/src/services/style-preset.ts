import { getDramaStylePrompt as readDramaStylePrompt } from '../data/tenant/styles.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'

export async function getDramaStylePrompt(dramaId: number): Promise<string> {
  return readDramaStylePrompt(requireCurrentTenant(), dramaId)
}
