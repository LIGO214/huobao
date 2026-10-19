export type ModelPurpose = 'text' | 'image' | 'video'

/** Supported provider/protocol pairs for user-owned model configurations. */
export const supportedProviders: Record<ModelPurpose, readonly string[]> = {
  text: ['openai', 'gemini', 'volcengine'],
  image: ['openai', 'gemini', 'volcengine'],
  video: ['volcengine', 'minimax', 'aliyun'],
}

export function isSupportedProvider(purpose: string | null | undefined, provider: string | null | undefined): boolean {
  const providers = supportedProviders[purpose as ModelPurpose]
  return !!providers && providers.includes((provider || '').trim().toLowerCase())
}
