import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import sharp from '../../backend/node_modules/sharp/lib/index.js'
import ffmpeg from '../../backend/node_modules/ffmpeg-static/index.js'

const base = 'http://127.0.0.1:3300'
const modelHost = process.env.HUOBAO_ACCEPTANCE_MODEL_HOST || '127.0.0.1'
assert.ok(['127.0.0.1', 'host.docker.internal'].includes(modelHost))
const modelBase = `http://${modelHost}:35001`
const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#129465' } }).png().toBuffer()
const videoFile = new URL('./synthetic-model-video.mp4', import.meta.url)
execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:d=1', '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fileURLToPath(videoFile)], { stdio: 'ignore' })
const video = await readFile(videoFile)
const observed = []
const mockErrors = []
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/fixture.mp4') {
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length })
      response.end(video)
      return
    }
    const owner = [1, 87].find(id => request.headers.authorization === `Bearer synthetic-model-owner-${id}`)
    assert.ok(owner, 'Model call did not use an owner key')
    assert.equal(request.headers['x-qunl-signature'], undefined)
    const buffers = []
    for await (const buffer of request) buffers.push(buffer)
    const body = buffers.length ? JSON.parse(Buffer.concat(buffers)) : {}
    observed.push({ owner, method: request.method, path: request.url })
    let output
    if (request.url === '/v1/chat/completions') {
      assert.equal(body.model, 'acceptance-text-model')
      const done = body.messages.some(message => message.role === 'tool')
      let message
      if (done) message = { role: 'assistant', content: `done-${owner}` }
      else {
        const tool = body.tools.find(tool => tool.function.name === 'saveScript')
        assert.ok(tool, `Missing saveScript tool; got ${body.tools.map(tool => tool.function.name).join(',')}`)
        message = { role: 'assistant', content: null, tool_calls: [{
          id: `save-owner-${owner}`, type: 'function',
          function: { name: 'saveScript', arguments: JSON.stringify({ content: `Screenplay private owner ${owner}` }) },
        }] }
      }
      if (body.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(`data: ${JSON.stringify({
          id: `mock-${owner}`, object: 'chat.completion.chunk', created: 1, model: body.model,
          choices: [{ index: 0, delta: { ...message, tool_calls: message.tool_calls?.map((tool, index) => ({ index, ...tool })) }, finish_reason: null }],
        })}\n\ndata: ${JSON.stringify({
          id: `mock-${owner}`, object: 'chat.completion.chunk', created: 1, model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: done ? 'stop' : 'tool_calls' }],
        })}\n\ndata: [DONE]\n\n`)
        return
      }
      output = { id: `mock-${owner}`, object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message, finish_reason: done ? 'stop' : 'tool_calls' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    } else if (request.method === 'POST' && request.url === '/v1/images/generations') {
      assert.equal(body.model, 'gpt-image-2')
      output = { created: 1, data: [{ b64_json: png.toString('base64') }] }
    } else if (request.method === 'POST' && request.url === '/api/v3/contents/generations/tasks') {
      assert.equal(body.model, 'dreamina-seedance-2-0-mini-260615')
      assert.equal(body.generate_audio, false)
      output = { id: `acceptance-owner-${owner}` }
    } else if (request.method === 'GET' && request.url === `/api/v3/contents/generations/tasks/acceptance-owner-${owner}`) {
      output = { id: `acceptance-owner-${owner}`, status: 'succeeded', duration: 1,
        content: { video_url: `${modelBase}/fixture.mp4` } }
    } else {
      assert.fail(`Unexpected model endpoint: ${request.method} ${request.url}`)
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(output))
  } catch (error) {
    mockErrors.push(error)
    response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'Synthetic model assertion failed' } }))
  }
})
server.listen(35001, '127.0.0.1')
await once(server, 'listening')
let passed = 0
async function check(action) { await action(); passed++ }
async function http(path, cookie, method = 'GET', body) {
  const headers = { ...(cookie ? { Cookie: cookie } : {}), Origin: base, 'Content-Type': 'application/json' }
  return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) })
}
async function json(path, cookie, method, body, status = 200) {
  const response = await http(path, cookie, method, body)
  assert.equal(response.status, status, `${method || 'GET'} ${path}`)
  return (await response.json()).data
}
async function login(id) {
  const response = await http('/api/user/login', null, 'POST', { username: `acceptance${id}`, password: 'HuobaoTest20261019!' })
  assert.equal((await response.json()).success, true)
  return response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
}
const api = '/huobao/api/v1'
async function waitTask(cookie, id) {
  for (let i = 0; i < 90; i++) {
    const task = await json(`${api}/tasks/${id}`, cookie)
    if (task.status === 'completed') return task
    assert.notEqual(task.status, 'failed', 'Generation failed')
    await setTimeout(500)
  }
  assert.fail('Generation did not complete')
}
try {
  const fixtures = []
  for (const id of [1, 87]) {
    const cookie = await login(id)
    const configs = {}
    for (const type of ['text', 'image', 'video']) {
      configs[type] = await json(`${api}/ai-configs`, cookie, 'POST', {
        service_type: type, provider: type === 'video' ? 'volcengine' : 'openai',
        name: `Session model owner ${id} ${type}`, base_url: modelBase,
        api_key: `synthetic-model-owner-${id}`,
        model: [type === 'text' ? 'acceptance-text-model' : type === 'image' ? 'gpt-image-2' : 'dreamina-seedance-2-0-mini-260615'],
      }, 201)
    }
    const drama = await json(`${api}/dramas`, cookie, 'POST', { title: `Session model owner ${id}` }, 201)
    const episode = await json(`${api}/episodes`, cookie, 'POST', {
      drama_id: drama.id, image_config_id: configs.image.id, video_config_id: configs.video.id,
    })
    await json(`${api}/episodes/${episode.id}`, cookie, 'PUT', { content: `Source owner ${id}` })
    fixtures.push({ id, cookie, configs, drama, episode })
  }
  for (const own of fixtures) {
    const other = fixtures.find(fixture => fixture !== own)
    await check(async () => {
      const result = await json(`${api}/agent/script_rewriter/chat`, own.cookie, 'POST', {
        message: 'Save the screenplay using the provided tool.', drama_id: own.drama.id, episode_id: own.episode.id,
        config_id: own.configs.text.id, model: 'acceptance-text-model',
      })
      assert.equal(result.text, `done-${own.id}`)
      const project = await json(`${api}/dramas/${own.drama.id}`, own.cookie)
      assert.equal(project.episodes.find(episode => episode.id === own.episode.id).script_content, `Screenplay private owner ${own.id}`)
    })
    await check(async () => assert.equal((await http(`${api}/agent/script_rewriter/chat`, own.cookie, 'POST', {
      message: 'Cross-user forbidden', drama_id: own.drama.id, episode_id: own.episode.id,
      config_id: other.configs.text.id, model: 'acceptance-text-model',
    })).status, 404))
    for (const type of ['image', 'video']) {
      let task
      await check(async () => {
        const submitted = await json(`${api}/tasks`, own.cookie, 'POST', {
          type, prompt: 'Synthetic acceptance content', drama_id: own.drama.id, config_id: own.configs[type].id,
          ...(type === 'video' ? { duration: 4, resolution: '480p', aspect_ratio: '16:9', generate_audio: false } : {}),
        }, 201)
        task = await waitTask(own.cookie, submitted.id)
        assert.ok(task.localPath)
        assert.equal((await http(`${api}/tasks/${task.id}`, other.cookie)).status, 404)
      })
      await check(async () => {
        const path = `/huobao/${task.localPath}`
        const ownMedia = await http(path, own.cookie)
        assert.equal(ownMedia.status, 200)
        assert.match(ownMedia.headers.get('cache-control'), /private/)
        assert.match(ownMedia.headers.get('content-type'), type === 'image' ? /^image\// : /^video\//)
        assert.ok((await ownMedia.arrayBuffer()).byteLength > 0)
        assert.equal((await http(path, other.cookie)).status, 404)
      })
    }
  }
  assert.deepEqual(mockErrors, [])
  await check(async () => {
    for (const owner of [1, 87]) {
      for (const path of ['/v1/chat/completions', '/v1/images/generations', '/api/v3/contents/generations/tasks']) {
        assert.ok(observed.some(request => request.owner === owner && request.path === path))
      }
    }
  })
  console.log(`Qunl Session model mock acceptance: ${passed} passed, 0 failed`)
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  if (mockErrors.length) console.error(mockErrors[0].message)
}
