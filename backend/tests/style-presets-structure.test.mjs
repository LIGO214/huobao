import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('drama creation no longer pre-creates episodes from total_episodes', () => {
  const dramas = read('src/routes/dramas.ts')

  assert.doesNotMatch(dramas, /total_episodes \|\| 1/)
  assert.doesNotMatch(dramas, /第\$\{i\}集/)
  assert.doesNotMatch(dramas, /Create default episodes/)
})

test('drama creation records a fixed aspect ratio for video generation', () => {
  const dramas = read('src/routes/dramas.ts')

  assert.match(dramas, /aspectRatio: body\.aspect_ratio \|\| '16:9'/)
  assert.match(dramas, /if \(body\.aspect_ratio !== undefined\) updates\.aspectRatio = body\.aspect_ratio/)
})

test('style presets route is mounted and implements CRUD', () => {
  const entry = read('src/index.ts')
  const route = read('src/routes/stylePresets.ts')

  assert.match(entry, /api\.route\('\/style-presets', stylePresets\)/)
  assert.match(route, /app\.get\('\/'/)
  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /app\.put\('\/:id'/)
  assert.match(route, /app\.delete\('\/:id'/)
  const data = read('src/data/tenant/style-presets.ts')
  assert.match(data, /value: z\.string\(\)\.trim\(\)\.regex/)
  assert.match(data, /风格 key 已存在/)
  assert.match(data, /stylePresets\.userId, userId/)
  assert.doesNotMatch(route, /db\/index/)
  // GET 支持 ?all=1 且默认过滤停用项
  assert.match(route, /query\('all'\)/)
  assert.match(data, /rows\.filter\(row => row\.isActive\)/)
})

test('drama style prompt is injected into image prompt composition', () => {
  const service = read('src/services/style-preset.ts')
  const gridTools = read('src/agents/tools/image-prompt-tools.ts')
  const data = read('src/data/tenant/image-prompts.ts')
  const styles = read('src/data/tenant/styles.ts')

  assert.match(service, /getDramaStylePrompt/)
  assert.match(styles, /stylePresets\.value, drama\.style/)
  assert.match(styles, /eq\(schema\.stylePresets\.userId, context\.userId\)/)
  assert.match(gridTools, /saveCharacterPrompt\(getAgentTenantContext/)
  assert.match(gridTools, /saveScenePrompt\(getAgentTenantContext/)
  assert.match(data, /getDramaStylePrompt\(context, dramaId\)/)
  assert.match(data, /style \? `\$\{style\}, \$\{prompt\}` : prompt/)
})

test('agent default prompts no longer hardcode consistent art style', () => {
  const agents = read('src/agents/index.ts')

  assert.doesNotMatch(agents, /必须包含 "consistent art style"/)
  assert.match(agents, /视觉风格描述会由工具/)
})
