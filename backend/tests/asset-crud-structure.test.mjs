import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const domain = read('src/data/tenant/assets.ts')

test('characters route supports manual create and soft delete', () => {
  const route = read('src/routes/characters.ts')

  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /name: z\.string\(\)\.trim\(\)\.min\(1\)/)
  assert.match(route, /createCharacter\(requireCurrentTenant\(\)/)
  // 传入 episode_id 时关联到该集
  assert.match(domain, /tx\.insert\(schema\.episodeCharacters\)\.values\(\{ userId, episodeId/)
  // 软删除
  assert.match(route, /app\.delete\('\/:id'/)
  assert.match(route, /deleteCharacter\(requireCurrentTenant\(\), id\)/)
  assert.match(domain, /db\.update\(schema\.characters\)\.set\(\{ deletedAt: now\(\)/)
  assert.doesNotMatch(route, /db\.delete\(schema\.characters\)/)
})

test('scenes route links new scenes to episode and soft deletes', () => {
  const route = read('src/routes/scenes.ts')

  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /location: z\.string\(\)\.trim\(\)\.min\(1\)/)
  assert.match(domain, /tx\.insert\(schema\.episodeScenes\)\.values\(\{ userId, episodeId/)
  // 软删除（原为硬删，保留历史生成记录）
  assert.match(route, /app\.delete\('\/:id'/)
  assert.match(route, /deleteScene\(requireCurrentTenant\(\), id\)/)
  assert.match(domain, /db\.update\(schema\.scenes\)\.set\(\{ deletedAt: now\(\)/)
  assert.doesNotMatch(route, /db\.delete\(schema\.scenes\)/)
})

test('props route supports manual create and soft delete', () => {
  const route = read('src/routes/props.ts')

  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /name: z\.string\(\)\.trim\(\)\.min\(1\)/)
  assert.match(domain, /tx\.insert\(schema\.episodeProps\)\.values\(\{ userId, episodeId/)
  assert.match(route, /app\.delete\('\/:id'/)
  assert.match(route, /deleteProp\(requireCurrentTenant\(\), id\)/)
  assert.match(domain, /db\.update\(schema\.props\)\.set\(\{ deletedAt: now\(\)/)
  assert.doesNotMatch(route, /db\.delete\(schema\.props\)/)
})
