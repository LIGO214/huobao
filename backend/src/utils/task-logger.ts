import { getCurrentTenant } from '../security/tenant-runtime.js'

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'

const numericFields = new Set(['id', 'user_id', 'resource_id', 'task_id', 'dramaId', 'episodeId', 'storyboardId',
  'characterId', 'sceneId', 'propId', 'mergeId', 'generationId', 'configId', 'status', 'duration', 'elapsedMs',
  'elapsedSeconds', 'attempt', 'index', 'total', 'completed', 'failed', 'requested', 'started', 'count', 'steps', 'clips'])

function operationalMeta(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, raw] of Object.entries(value)) {
    if (numericFields.has(key) && typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw
    else if (key === 'method' && typeof raw === 'string' && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(raw)) out[key] = raw
    else if (key === 'error') out.error = '[redacted]'
  }
  return out
}

export function redactUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    url.username = ''
    url.password = ''
    url.hash = ''
    for (const key of new Set(url.searchParams.keys())) url.searchParams.set(key, '***')
    return url.toString()
  } catch {
    return '[invalid URL]'
  }
}



export function logTask(scope: string, action: string, meta?: Record<string, unknown>, level: LogLevel = 'INFO') {
  const tenant = getCurrentTenant()
  console.log(JSON.stringify({ time: new Date().toISOString(), level, scope, action, ...operationalMeta(meta),
    ...(tenant ? { user_id: tenant.userId, request_id: tenant.requestId } : {}),
  }))
}

export function logTaskStart(scope: string, action: string, meta?: Record<string, unknown>) {
  logTask(scope, `START ${action}`, meta, 'INFO')
}

export function logTaskProgress(scope: string, action: string, meta?: Record<string, unknown>) {
  logTask(scope, action, meta, 'INFO')
}

export function logTaskSuccess(scope: string, action: string, meta?: Record<string, unknown>) {
  logTask(scope, `DONE ${action}`, meta, 'SUCCESS')
}

export function logTaskWarn(scope: string, action: string, meta?: Record<string, unknown>) {
  logTask(scope, action, meta, 'WARN')
}

export function logTaskError(scope: string, action: string, meta?: Record<string, unknown>) {
  logTask(scope, `ERROR ${action}`, meta, 'ERROR')
}

export function logTaskPayload(scope: string, action: string, payload: unknown) {
  logTask(scope, action, operationalMeta(payload))
}
