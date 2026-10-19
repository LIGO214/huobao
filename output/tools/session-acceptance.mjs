import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = 'http://127.0.0.1:3300'
const backend = process.env.HUOBAO_ACCEPTANCE_BACKEND_URL || 'http://127.0.0.1:15680'
assert.ok(['http://127.0.0.1:15680', 'http://127.0.0.1:15681'].includes(backend))
let passed = 0
async function check(action) {
  await action()
  passed++
}
async function request(path, cookie, method = 'GET', body, extraHeaders = {}) {
  const headers = { ...extraHeaders }
  if (cookie) headers.Cookie = cookie
  if (!['GET', 'HEAD'].includes(method)) headers.Origin ??= base
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  return fetch(base + path, {
    method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    redirect: 'manual', signal: AbortSignal.timeout(15000),
  })
}
async function json(path, cookie, method, body, expected = 200) {
  const response = await request(path, cookie, method, body)
  assert.equal(response.status, expected, `${method || 'GET'} ${path}`)
  return (await response.json()).data
}
async function login(username, id) {
  const response = await request('/api/user/login', null, 'POST', {
    username, password: 'HuobaoTest20261019!',
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.success, true)
  assert.equal(body.data.id, id)
  const cookies = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookies)
  passed++
  return cookies
}

const a = await login('acceptance1', 1)
const b = await login('acceptance87', 87)
const api = '/huobao/api/v1'
await check(async () => assert.equal((await request('/huobao/')).status, 401))
await check(async () => {
  const response = await request('/huobao/', a)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /<html/)
})
await check(async () => assert.equal((await request('/huobao/settings', b)).status, 200))
await check(async () => assert.equal((await fetch(`${backend}/api/v1/dramas`)).status, 401))
const marker = `Session acceptance ${randomUUID()}`
let dramaA, dramaB, configA, configB, skillA, skillB
await check(async () => {
  dramaA = await json(`${api}/dramas`, a, 'POST', { title: `${marker} A` }, 201)
  assert.equal(dramaA.user_id, 1)
})
await check(async () => {
  dramaB = await json(`${api}/dramas`, b, 'POST', { title: `${marker} B` }, 201)
  assert.equal(dramaB.user_id, 87)
})
await check(async () => {
  const response = await request(`${api}/dramas/${dramaA.id}`, a, 'GET', undefined, {
    'X-Qunl-User-Id': '87', 'X-Huobao-Internal-User-Id': '87', 'Authorization': 'Bearer forged-test',
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.user_id, 1)
})
for (const [cookie, own, other] of [[a, dramaA, dramaB], [b, dramaB, dramaA]]) {
  await check(async () => {
    const rows = await json(`${api}/dramas`, cookie)
    assert.ok(rows.items.some(row => row.id === own.id))
    assert.ok(!rows.items.some(row => row.id === other.id))
  })
  for (const method of ['GET', 'PUT', 'DELETE']) {
    await check(async () => assert.equal(
      (await request(`${api}/dramas/${other.id}`, cookie, method,
        method === 'PUT' ? { title: 'cross-user forbidden' } : undefined)).status, 404))
  }
}
const config = {
  service_type: 'text', provider: 'openai', name: `${marker} model`,
  base_url: 'https://example.invalid', model: ['acceptance-model'],
  api_key: 'synthetic-acceptance-key-a', is_active: true,
}
await check(async () => {
  configA = await json(`${api}/ai-configs`, a, 'POST', config, 201)
  configB = await json(`${api}/ai-configs`, b, 'POST', { ...config, api_key: 'synthetic-acceptance-key-b' }, 201)
  assert.notEqual(configA.id, configB.id)
  for (const value of [configA, configB]) {
    assert.equal(value.api_key, undefined)
    assert.equal(value.has_api_key, true)
  }
})
await check(async () => {
  const rows = await json(`${api}/ai-configs`, b)
  assert.ok(rows.some(row => row.id === configB.id))
  assert.ok(!rows.some(row => row.id === configA.id))
  assert.ok(rows.every(row => row.api_key === undefined))
})
await check(async () => assert.equal((await request(`${api}/ai-configs/${configA.id}`, b, 'PUT', { name: 'forbidden' })).status, 404))
await check(async () => {
  await json(`${api}/ai-configs/${configA.id}`, a, 'PUT', { name: `${marker} edited` })
  const result = await json(`${api}/ai-configs/${configA.id}`, a)
  assert.equal(result.has_api_key, true)
})
await check(async () => {
  await json(`${api}/prompts/script_rewriter`, a, 'PUT', { user_prompt: 'Private instructions A' })
  await json(`${api}/prompts/script_rewriter`, b, 'PUT', { user_prompt: 'Private instructions B' })
  assert.equal((await json(`${api}/prompts/script_rewriter`, a)).user_prompt, 'Private instructions A')
  assert.equal((await json(`${api}/prompts/script_rewriter`, b)).user_prompt, 'Private instructions B')
})
await check(async () => {
  const input = { agent_type: 'script_rewriter', name: `${marker} skill`, content: 'Text instructions only.' }
  skillA = await json(`${api}/skills`, a, 'POST', input, 201)
  skillB = await json(`${api}/skills`, b, 'POST', input, 201)
  assert.notEqual(skillA.id, skillB.id)
})
await check(async () => {
  const rows = await json(`${api}/skills`, b)
  assert.ok(rows.user.some(row => row.id === skillB.id))
  assert.ok(!rows.user.some(row => row.id === skillA.id))
})
await check(async () => assert.equal((await request(`${api}/skills/${skillA.id}`, b)).status, 404))
await check(async () => assert.equal((await request(`${api}/skills/script-rewriter`, a, 'PUT', { content: 'forbidden' })).status, 400))
await check(async () => assert.equal((await request(`${api}/dramas`, a, 'POST', { title: 'forbidden' }, { Origin: 'http://untrusted.invalid' })).status, 403))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2l8AAAAASUVORK5CYII=', 'base64')
let media
await check(async () => {
  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), 'session-acceptance.png')
  const response = await request(`${api}/upload/image`, a, 'POST', form)
  assert.equal(response.status, 200)
  media = (await response.json()).data.url
  assert.ok(media.startsWith('/static/'))
})
await check(async () => {
  const response = await request(`/huobao${media}`, a)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /private/)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
})
await check(async () => assert.equal((await request(`/huobao${media}`, b)).status, 404))
await check(async () => assert.equal((await request(`/huobao${media}`)).status, 401))
await check(async () => {
  const infoA = await json(`${api}/storage`, a)
  const infoB = await json(`${api}/storage`, b)
  assert.ok(infoA.usage.uploads >= png.length)
  assert.equal(infoB.usage.uploads, 0)
})
await check(async () => {
  assert.equal((await request('/api/user/logout', b)).status, 200)
  // Cookie sessions are cleared client-side at logout. Test the cleared browser state.
  assert.equal((await request('/huobao/')).status, 401)
})
console.log(`Qunl Session acceptance: ${passed} passed, 0 failed`)
