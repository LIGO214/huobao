import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { EventEmitter } from 'node:events'
import type { FfmpegCommand } from 'fluent-ffmpeg'
import { test, after } from 'node:test'
import { Hono } from 'hono'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-storage-test-'))
process.env.HUOBAO_DATA_DIR = root
process.env.HUOBAO_MEDIA_QUOTA_BYTES = '8192'
process.env.HUOBAO_MEDIA_FILE_MAX_BYTES = '4096'
process.env.HUOBAO_IMAGE_MAX_PIXELS = '10000'
after(() => fs.rm(root, { recursive: true, force: true }))
const { runWithTenant } = await import('../src/security/tenant-runtime.js')
const { resolveTenantPath, writeTenantMedia, saveTenantBytes, StorageLimitError } = await import('../src/utils/tenant-storage.js')
const { tenantMediaResponse } = await import('../src/utils/media-response.js')
const { writeFfmpegMedia } = await import('../src/utils/ffmpeg-media.js')
const { handleError } = await import('../src/middleware/logger.js')
const context = (userId: number) => ({ userId, requestId: 'storage-test', authVersion: 1 as const })

async function filesFor(userId: number) {
  return fs.readdir(path.join(root, 'users', String(userId), 'static', 'images'))
}

test('storage requires tenant and rejects traversal, absolute paths and junctions', async () => {
  assert.throws(() => resolveTenantPath('static/images/a.png'), /tenant context/)
  await runWithTenant(context(1), async () => {
    for (const relative of ['../outside', '/C:/outside', 'C:/outside', 'static/../../outside', 'images\\outside']) {
      assert.throws(() => resolveTenantPath(relative))
    }
    const tenantRoot = path.join(root, 'users', '1', 'static')
    await fs.mkdir(tenantRoot, { recursive: true })
    await fs.mkdir(path.join(root, 'outside'))
    await fs.symlink(path.join(root, 'outside'), path.join(tenantRoot, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => resolveTenantPath('link/file.png'), /符号链接/)
  })
})

test('two users can use the same media path without sharing contents', async () => {
  await Promise.all([2, 3].map(userId => runWithTenant(context(userId), async () => {
    await saveTenantBytes('static/images/same.png', Buffer.from(`user-${userId}`))
    assert.equal(await fs.readFile(resolveTenantPath('static/images/same.png'), 'utf8'), `user-${userId}`)
  })))
})

test('bounded writes reject oversized or failed producers without publishing partial output', async () => {
  await runWithTenant(context(4), async () => {
    await assert.rejects(saveTenantBytes('static/images/large.png', Buffer.alloc(4097)), StorageLimitError)
    await assert.rejects(writeTenantMedia('static/images/failed.png', async destination => {
      destination.write('partial')
      throw new Error('producer failed')
    }), /producer failed/)
    await assert.rejects(writeTenantMedia('static/images/invalid.png', async destination => {
      await pipeline(Readable.from(['complete']), destination)
    }, 4096, async () => { throw new Error('invalid media') }), /invalid media/)
    assert.deepEqual(await filesFor(4), [])
  })
})

test('concurrent writes serialize quota checks and derived files count toward the same quota', async () => {
  await runWithTenant(context(5), async () => {
    await saveTenantBytes('static/images/original.png', Buffer.alloc(4096))
    const writes = await Promise.allSettled([
      saveTenantBytes('static/images/thumb.webp', Buffer.alloc(3000)),
      saveTenantBytes('static/images/poster.jpg', Buffer.alloc(3000)),
    ])
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(writes.filter(result => result.status === 'rejected').length, 1)
    const files = await filesFor(5)
    assert.equal(files.length, 2)
    assert.equal(files.some(file => file.startsWith('.pending-')), false)
    await assert.rejects(saveTenantBytes('static/merged/video.mp4', Buffer.alloc(1100)), StorageLimitError)
  })
})

test('failed replacement preserves the previously complete file', async () => {
  await runWithTenant(context(6), async () => {
    await saveTenantBytes('static/images/same.png', Buffer.from('old'))
    await assert.rejects(saveTenantBytes('static/images/same.png', Buffer.alloc(5000)), StorageLimitError)
    assert.equal(await fs.readFile(resolveTenantPath('static/images/same.png'), 'utf8'), 'old')
    await saveTenantBytes('static/images/same.png', Buffer.from('new'))
    assert.equal(await fs.readFile(resolveTenantPath('static/images/same.png'), 'utf8'), 'new')
  })
})

test('private media handles suffix ranges, invalid ranges, HEAD and tenant-specific validators', async () => {
  const app = new Hono()
  app.onError(handleError)
  app.on(['GET', 'HEAD'], '/static/*', tenantMediaResponse)
  await Promise.all([7, 8].map(userId => runWithTenant(context(userId), () => saveTenantBytes('static/images/file.png', Buffer.from('0123456789')))))
  await runWithTenant(context(7), async () => {
    const full = await app.request('/static/images/file.png')
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('cache-control'), 'private, no-cache')
    assert.equal(full.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(full.headers.get('content-type'), 'image/png')
    const etag = full.headers.get('etag')!
    assert.equal(await full.text(), '0123456789')
    assert.equal((await app.request('/static/images/file.png', { headers: { 'If-None-Match': etag } })).status, 304)
    await runWithTenant(context(8), async () => {
      assert.equal((await app.request('/static/images/file.png', { headers: { 'If-None-Match': etag } })).status, 200)
    })
    const partial = await app.request('/static/images/file.png', { headers: { Range: 'bytes=-3' } })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), 'bytes 7-9/10')
    assert.equal(await partial.text(), '789')
    assert.equal((await app.request('/static/images/file.png', { headers: { Range: 'bytes=99-100' } })).status, 416)
    assert.equal((await app.request('/static/images/file.png', { headers: { Range: 'bytes=0-2', 'If-Range': etag } })).status, 200)
    const head = await app.request('/static/images/file.png', { method: 'HEAD' })
    assert.equal(head.headers.get('content-length'), '10')
    assert.equal(await head.text(), '')
    await saveTenantBytes('static/images/script.svg', Buffer.from('<svg/>'))
    assert.equal((await app.request('/static/images/script.svg')).status, 404)
    assert.equal((await app.request('/static/images/.pending-secret')).status, 404)
    assert.equal((await app.request('/static/images/file.png')).status, 200)
  })
  await runWithTenant(context(9), async () => {
    assert.equal((await app.request('/static/images/file.png')).status, 404)
  })
})

test('FFmpeg output is killed on overflow and never publishes a truncated file', async () => {
  class FakeCommand extends EventEmitter {
    killed = false
    format() { return this }
    kill() { this.killed = true; return this }
    pipe(destination: NodeJS.WritableStream) {
      this.emit('start')
      destination.write(Buffer.alloc(5000))
      return destination
    }
  }
  await runWithTenant(context(10), async () => {
    const command = new FakeCommand()
    await assert.rejects(writeFfmpegMedia('static/images/ffmpeg.jpg', command as unknown as FfmpegCommand, 'image2pipe'), StorageLimitError)
    assert.equal(command.killed, true)
    assert.deepEqual(await filesFor(10), [])
  })
})

test('upload rejects forged media and oversized decoded images and isolates valid uploads', async () => {
  const { default: sharp } = await import('sharp')
  const { default: upload } = await import('../src/routes/upload.js')
  const app = new Hono()
  app.onError(handleError)
  app.route('/upload', upload)
  const send = (bytes: Uint8Array, name: string, type: string) => {
    const body = new FormData()
    body.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type }))
    return app.request('/upload/image', { method: 'POST', body })
  }
  await runWithTenant(context(11), async () => {
    assert.equal((await send(Buffer.from('<html/>'), 'photo.png', 'image/png')).status, 400)
    const large = await sharp({ create: { width: 120, height: 120, channels: 3, background: 'white' } }).png().toBuffer()
    const rejected = await send(large, 'photo.png', 'image/png')
    assert.notEqual(rejected.status, 200)
    const small = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).png().toBuffer()
    const saved = await send(small, 'photo.svg', 'text/html')
    assert.equal(saved.status, 200)
    const data = (await saved.json()).data
    assert.equal(data.path.endsWith('.png'), true)
    assert.equal((await fs.stat(resolveTenantPath(data.path))).isFile(), true)
    await runWithTenant(context(12), async () => {
      await assert.rejects(fs.stat(resolveTenantPath(data.path)), { code: 'ENOENT' })
    })
  })
})
