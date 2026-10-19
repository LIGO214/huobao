import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VolcEngineVideoAdapter } from '../src/services/adapters/volcengine-video'

const adapter = new VolcEngineVideoAdapter()

test('Volcengine v3 keeps role-aware reference content at the adapter boundary', () => {
  const request = adapter.buildGenerateRequest({
    provider: 'volcengine',
    baseUrl: 'https://gateway.example',
    apiKey: 'test-key',
    model: 'dreamina-seedance-2-0-mini-260615',
  } as any, {
    id: 1,
    model: 'dreamina-seedance-2-0-mini-260615',
    prompt: 'A marching scene',
    referenceImageUrls: JSON.stringify(['https://example.com/reference.png']),
    referenceVideoUrls: null,
    referenceAudioUrls: null,
    duration: 5,
    aspectRatio: '16:9',
    resolution: '720p',
  } as any)

  assert.equal(request.url, 'https://gateway.example/api/v3/contents/generations/tasks')
  assert.equal((request.body as any).images, undefined)
  assert.deepEqual((request.body as any).content, [
    { type: 'text', text: 'A marching scene' },
    { type: 'image_url', image_url: { url: 'https://example.com/reference.png' }, role: 'reference_image' },
  ])
})

test('Dreamina gateway polling accepts the OpenAI-compatible task envelope', () => {
  const config = { provider: 'volcengine', baseUrl: 'https://gateway.example/internal/huobao', apiKey: 'test-key', model: 'dreamina-seedance-2-0-mini-260615' }
  assert.equal(adapter.buildPollRequest(config, 'task-123').url, 'https://gateway.example/internal/huobao/api/v3/contents/generations/tasks/task-123')
  const response = {
    code: 0,
    message: 'success',
    data: {
      task_id: 'task-123',
      status: 'SUCCESS',
      result_url: 'https://example.com/result.mp4',
    },
  }

  assert.deepEqual(adapter.parsePollResponse(response), {
    status: 'completed',
    videoUrl: 'https://example.com/result.mp4',
  })
  assert.equal(adapter.extractVideoUrl(response), 'https://example.com/result.mp4')
})

test('Dreamina gateway polling reports a wrapped terminal failure', () => {
  assert.deepEqual(adapter.parsePollResponse({
    data: { status: 'FAIL', fail_reason: 'content rejected' },
  }), {
    status: 'failed',
    error: 'content rejected',
  })
})

test('both supported model names use the same v3 contract and preserve audio=false', () => {
  for (const model of ['dreamina-seedance-2-0-mini-260615', 'doubao-seedance-2-0-260128']) {
    const request = adapter.buildGenerateRequest({
      provider: 'volcengine', baseUrl: 'https://gateway.example/internal/huobao', apiKey: 'test-key', model,
    }, { id: 1, model, prompt: 'A quiet street', duration: 4, resolution: '480p', generateAudio: false, aspectRatio: '16:9' })
    assert.equal(request.url, 'https://gateway.example/internal/huobao/api/v3/contents/generations/tasks')
    assert.deepEqual(request.body, { model, content: [{ type: 'text', text: 'A quiet street' }],
      generate_audio: false, ratio: '16:9', duration: 4, resolution: '480p', watermark: false })
    assert.equal(adapter.buildPollRequest({ provider: 'volcengine', baseUrl: 'https://gateway.example/api/v3', apiKey: 'test-key', model }, 'task-1').url,
      'https://gateway.example/api/v3/contents/generations/tasks/task-1')
  }
})

test('v3 polling escapes task IDs and parses native success and failure', () => {
  const config = { provider: 'volcengine', baseUrl: 'https://gateway.example', apiKey: 'test-key', model: 'dreamina-seedance-2-0-mini-260615' }
  assert.equal(adapter.buildPollRequest(config, 'task/other?x=1').url,
    'https://gateway.example/api/v3/contents/generations/tasks/task%2Fother%3Fx%3D1')
  assert.deepEqual(adapter.parseGenerateResponse({ id: 'cgt-1' }), { isAsync: true, taskId: 'cgt-1' })
  assert.deepEqual(adapter.parsePollResponse({ id: 'cgt-1', status: 'succeeded', content: { video_url: 'https://example.com/result.mp4' } }),
    { status: 'completed', videoUrl: 'https://example.com/result.mp4' })
  assert.deepEqual(adapter.parsePollResponse({ status: 'failed', error: { code: 'Rejected', message: 'content rejected' } }),
    { status: 'failed', error: '[Rejected] content rejected' })
})
