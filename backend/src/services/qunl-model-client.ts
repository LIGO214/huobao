import { randomUUID } from 'node:crypto'
import { appConfig } from '../config/env.js'
import { signQunlRequest } from '../security/qunl-signature.js'

export type QunlModelList = Readonly<{
  success?: boolean
  data?: Record<string, string[]>
}>

export type QunlModelPurpose = 'text' | 'image' | 'video'

function resolveUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl)
  const relative = new URL(path, 'http://qunl.internal')
  const prefix = base.pathname.replace(/\/+$/, '')
  base.pathname = `${prefix}${relative.pathname}`.replace(/\/{2,}/g, '/')
  base.search = relative.search
  return base
}

export class QunlModelClient {
  constructor(
    private readonly baseUrl = appConfig.qunlModelUrl,
    private readonly secret = appConfig.proxySecret,
  ) {}

  private requireConfig() {
    if (!this.baseUrl) throw new Error('未配置 HUOBAO_QUNL_MODEL_URL')
    if (!this.secret) throw new Error('未配置 HUOBAO_PROXY_SECRET')
  }

  endpointBase(path: string) {
    this.requireConfig()
    return resolveUrl(this.baseUrl!, path).toString().replace(/\/+$/, '')
  }

  async listModels(userId: number, purpose: QunlModelPurpose = 'text'): Promise<string[]> {
    const response = await this.request(userId, `/internal/huobao/models?purpose=${encodeURIComponent(purpose)}`, {
      method: 'GET',
    })
    if (!response.ok) throw new Error(`Qunl 模型列表请求失败（HTTP ${response.status}）`)
    const payload = await response.json() as QunlModelList
    return Object.values(payload.data || {}).flat().filter((model): model is string => Boolean(model))
  }

  createFetch(userId: number): typeof fetch {
    this.requireConfig()
    return async (input, init = {}) => {
      const source = input instanceof Request ? input : new Request(input, init)
      const url = new URL(source.url)
      const headers = new Headers(source.headers)
      headers.delete('Authorization')
      headers.delete('X-Api-Key')
      const requestId = randomUUID()
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const signature = signQunlRequest(this.secret!, {
        version: '1',
        userId: String(userId),
        method: source.method,
        path: url.pathname,
        query: url.search,
        timestamp,
        requestId,
      })
      headers.set('X-Qunl-Auth-Version', '1')
      headers.set('X-Qunl-User-Id', String(userId))
      headers.set('X-Qunl-Timestamp', timestamp)
      headers.set('X-Qunl-Request-Id', requestId)
      headers.set('X-Qunl-Signature', signature)
      return fetch(source, { ...init, headers })
    }
  }

  async request(userId: number, path: string, init: RequestInit = {}) {
    this.requireConfig()
    const target = resolveUrl(this.baseUrl!, path)
    const headers = new Headers(init.headers)
    headers.delete('Authorization')
    headers.delete('X-Api-Key')
    const requestId = randomUUID()
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = signQunlRequest(this.secret!, {
      version: '1',
      userId: String(userId),
      method: init.method || 'GET',
      path: target.pathname,
      query: target.search,
      timestamp,
      requestId,
    })
    headers.set('X-Qunl-Auth-Version', '1')
    headers.set('X-Qunl-User-Id', String(userId))
    headers.set('X-Qunl-Timestamp', timestamp)
    headers.set('X-Qunl-Request-Id', requestId)
    headers.set('X-Qunl-Signature', signature)
    return fetch(target, { ...init, headers })
  }
}
