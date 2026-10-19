import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('episodes route exposes soft delete', () => {
  const route = read('src/routes/episodes.ts')

  assert.match(route, /app\.delete\('\/:id'/)
  assert.match(route, /deleteEpisode\(requireCurrentTenant\(\), id\)/)
  assert.match(read('src/data/tenant/episodes.ts'), /set\(\{ deletedAt: now\(\)/)
  // 无硬删
  assert.doesNotMatch(route, /db\.delete\(schema\.episodes\)/)
})

test('drama queries exclude soft-deleted episodes', () => {
  const dramas = read('src/data/tenant/dramas.ts')

  // 列表聚合与详情都过滤 deletedAt
  const matches = dramas.match(/isNull\(schema\.episodes\.deletedAt\)/g) || []
  assert.ok(matches.length >= 1, 'shared content reader must filter deleted episodes')
  const route = read('src/routes/dramas.ts')
  assert.ok((route.match(/getDramaContents\(/g) || []).length >= 2, 'list and detail must use the same scoped content reader')
  // 新建集时下一集号也忽略软删集
  const episodes = read('src/data/tenant/episodes.ts')
  assert.match(episodes, /isNull\(schema\.episodes\.deletedAt\)/)
})
