import { Hono } from 'hono'
import { success, created } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'
import { createStyleInput, updateStyleInput, listStylePresets, createStylePreset,
  updateStylePreset, deleteStylePreset } from '../data/tenant/style-presets.js'
import { readInput } from './asset-input.js'

const app = new Hono()

app.get('/', async c => {
  const rows = await listStylePresets(requireCurrentTenant(), c.req.query('all') === '1')
  return success(c, rows.map(row => ({ ...toSnakeCase(row), read_only: row.userId === null })))
})

app.post('/', async c => {
  const body = await readInput(c, createStyleInput)
  const row = await createStylePreset(requireCurrentTenant(), body)
  return created(c, toSnakeCase(row))
})

app.put('/:id', async c => {
  const body = await readInput(c, updateStyleInput)
  await updateStylePreset(requireCurrentTenant(), Number(c.req.param('id')), body)
  return success(c)
})

app.delete('/:id', async c => {
  await deleteStylePreset(requireCurrentTenant(), Number(c.req.param('id')))
  return success(c)
})

export default app
