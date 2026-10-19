import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { signQunlRequest } from '../src/security/qunl-signature.js'

const base = process.env.HUOBAO_SMOKE_URL || 'http://localhost:5679'
const secret = process.env.HUOBAO_PROXY_SECRET
if (!secret) throw new Error('HUOBAO_PROXY_SECRET is required')

function authHeaders(userId: number, method: string, url: URL) {
  const request = {
    version: '1', userId: String(userId), method,
    path: url.pathname, query: url.search,
    timestamp: String(Math.floor(Date.now() / 1000)), requestId: randomUUID(),
  }
  return {
    'X-Qunl-Auth-Version': request.version,
    'X-Qunl-User-Id': request.userId,
    'X-Qunl-Timestamp': request.timestamp,
    'X-Qunl-Request-Id': request.requestId,
    'X-Qunl-Signature': signQunlRequest(secret!, request),
  }
}

async function request(path: string, userId?: number, init: RequestInit = {}) {
  const url = new URL(path, base)
  const headers = new Headers(init.headers)
  if (userId) for (const [key, value] of Object.entries(authHeaders(userId, init.method || 'GET', url))) headers.set(key, value)
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(15_000) })
}

if (process.argv.includes('--preview')) {
  // Explicit test-only identity proxy. Never registered in the application.
  // It is loopback-only and must not be used as a Qunl login replacement.
  const server = createServer(async (incoming, outgoing) => {
    try {
      const target = new URL(incoming.url || '/', base)
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const headers = new Headers()
      if (incoming.headers['content-type']) headers.set('Content-Type', incoming.headers['content-type'])
      for (const [key, value] of Object.entries(authHeaders(910001, incoming.method || 'GET', target))) headers.set(key, value)
      const response = await fetch(target, {
        method: incoming.method, headers,
        body: ['GET', 'HEAD'].includes(incoming.method || 'GET') ? undefined : Buffer.concat(chunks),
        signal: AbortSignal.timeout(15_000),
      })
      outgoing.statusCode = response.status
      response.headers.forEach((value, key) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'].includes(key)) outgoing.setHeader(key, value)
      })
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      outgoing.writeHead(502).end('Acceptance preview upstream unavailable')
    }
  })
  server.listen(15679, '127.0.0.1', () => console.log('Test-only preview: http://127.0.0.1:15679'))
} else {
  let passed = 0
  async function check(action: () => Promise<void>) { await action(); passed++ }
  const userA = 910001
  const userB = 910002
  await check(async () => assert.equal((await request('/api/v1/health')).status, 200))
  await check(async () => assert.equal((await request('/api/v1/dramas')).status, 401))
  await check(async () => assert.equal((await request('/')).status, 401))
  await check(async () => {
    const url = new URL('/api/v1/dramas', base)
    const headers = authHeaders(userA, 'GET', url)
    headers['X-Qunl-User-Id'] = String(userB)
    assert.equal((await fetch(url, { headers })).status, 401)
  })
  await check(async () => {
    const response = await request('/', userA)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /<html/)
  })
  const title = `Docker acceptance ${randomUUID()}`
  let id: number
  await check(async () => {
    const response = await request('/api/v1/dramas', userA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    })
    assert.equal(response.status, 201)
    id = (await response.json()).data.id
    assert.ok(id > 0)
  })
  await check(async () => assert.equal((await request(`/api/v1/dramas/${id!}`, userA)).status, 200))
  await check(async () => assert.equal((await request(`/api/v1/dramas/${id!}`, userB)).status, 404))
  await check(async () => {
    const response = await request('/api/v1/dramas', userB)
    assert.equal(response.status, 200)
    assert.ok(!(await response.json()).data.items.some((item: { id: number }) => item.id === id!))
  })
  await check(async () => {
    const response = await request('/api/v1/ai-configs', userA, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: 'test-only' }),
    })
    assert.equal(response.status, 400)
  })
  let mediaPath: string
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2l8AAAAASUVORK5CYII=', 'base64')
  await check(async () => {
    const body = new FormData()
    body.append('file', new Blob([png], { type: 'image/png' }), 'docker-acceptance.png')
    const response = await request('/api/v1/upload/image', userA, { method: 'POST', body })
    assert.equal(response.status, 200)
    mediaPath = (await response.json()).data.url
    assert.ok(mediaPath.startsWith('/static/'))
  })
  await check(async () => {
    const response = await request(mediaPath!, userA)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('Cache-Control') || '', /private/)
    assert.equal(response.headers.get('Content-Type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
  })
  await check(async () => assert.equal((await request(mediaPath!, userB)).status, 404))
  await check(async () => assert.equal((await request(mediaPath!)).status, 401))
  await check(async () => {
    const responseA = await request('/api/v1/storage', userA)
    const responseB = await request('/api/v1/storage', userB)
    assert.equal(responseA.status, 200)
    assert.equal(responseB.status, 200)
    const a = (await responseA.json()).data
    const b = (await responseB.json()).data
    for (const info of [a, b]) {
      assert.equal(info.database, 'postgresql')
      for (const field of ['dataDir', 'storageRoot', 'sqlitePath']) assert.equal(info[field], null)
    }
    assert.ok(a.usage.uploads >= png.length)
    assert.equal(b.usage.uploads, 0)
    assert.equal(a.usage.db, 0)
    assert.equal(b.usage.db, 0)
  })
  await check(async () => assert.equal((await request('/api/v1/prompts', userA)).status, 200))
  console.log(`Docker smoke: ${passed} passed, 0 failed; persistence probe id=${id!}`)
}
