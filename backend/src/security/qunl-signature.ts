import { createHmac, timingSafeEqual } from 'node:crypto'

export const QUNL_AUTH_VERSION = '1'

export type SignedRequest = Readonly<{
  version: string
  userId: string
  method: string
  path: string
  query: string
  timestamp: string
  requestId: string
  signature: string
}>

function normalizePath(path: string) {
  const value = path.trim()
  if (!value.startsWith('/') || value.includes('\r') || value.includes('\n')) {
    throw new Error('invalid request path')
  }
  return value
}

function normalizeQuery(query: string) {
  const value = query.startsWith('?') ? query.slice(1) : query
  if (value.includes('\r') || value.includes('\n')) {
    throw new Error('invalid request query')
  }

  const entries = [...new URLSearchParams(value).entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
      return leftKey < rightKey ? -1 : 1
    })

  return entries
    .map(([key, entryValue]) => `${encodeURIComponent(key)}=${encodeURIComponent(entryValue)}`)
    .join('&')
}

export function canonicalizeSignedRequest(request: Omit<SignedRequest, 'signature'>) {
  const userId = request.userId.trim()
  if (!/^[1-9]\d*$/.test(userId)) throw new Error('invalid user id')
  if (!request.requestId || request.requestId.length > 128 || /[\r\n]/.test(request.requestId)) {
    throw new Error('invalid request id')
  }
  if (!/^\d+$/.test(request.timestamp)) throw new Error('invalid timestamp')

  return [
    request.version,
    userId,
    request.method.trim().toUpperCase(),
    normalizePath(request.path),
    normalizeQuery(request.query),
    request.timestamp,
    request.requestId,
  ].join('\n')
}

export function signQunlRequest(secret: string, request: Omit<SignedRequest, 'signature'>) {
  if (!secret) throw new Error('proxy secret is required')
  return createHmac('sha256', secret)
    .update(canonicalizeSignedRequest(request), 'utf8')
    .digest('hex')
}

export function verifyQunlSignature(secret: string, request: SignedRequest) {
  if (!secret || request.version !== QUNL_AUTH_VERSION) return false

  let expected: string
  try {
    expected = signQunlRequest(secret, request)
  } catch {
    return false
  }

  const actual = request.signature.trim().toLowerCase()
  const expectedBytes = Buffer.from(expected, 'utf8')
  const actualBytes = Buffer.from(actual, 'utf8')
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

export function isTimestampFresh(timestamp: string, nowSeconds = Math.floor(Date.now() / 1000), maxSkewSeconds = 60) {
  const value = Number(timestamp)
  return Number.isSafeInteger(value) && Math.abs(nowSeconds - value) <= maxSkewSeconds
}
