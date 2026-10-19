import { HTTPException } from 'hono/http-exception'

export function resourceNotFound(): never {
  throw new HTTPException(404, { message: '资源不存在' })
}

export function invalidInput(message: string): never {
  throw new HTTPException(400, { message })
}

export function requireResourceId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) invalidInput('资源编号无效')
  return id
}
