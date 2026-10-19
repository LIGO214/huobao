import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('characters and scenes tables store the agent-written final prompt', () => {
  const schema = read('src/db/schema.ts')
  const migration = read('src/db/migrations/0000_web_tenant_schema.sql')

  // Drizzle 表定义
  assert.match(schema, /export const characters = pgTable\('characters'[\s\S]*?finalPrompt: text\('final_prompt'\)/)
  assert.match(schema, /export const scenes = pgTable\('scenes'[\s\S]*?finalPrompt: text\('final_prompt'\)/)
  for (const table of ['characters', 'scenes']) {
    const ddl = migration.split(`CREATE TABLE "${table}" (`)[1].split('--> statement-breakpoint')[0]
    assert.match(ddl, /"final_prompt" text/)
  }
})

test('prompt tools save final prompts through the tenant data layer with style injection', () => {
  const tools = read('src/agents/tools/image-prompt-tools.ts')

  assert.match(tools, /save_character_final_prompt/)
  assert.match(tools, /save_scene_final_prompt/)
  // 保存时注入项目视觉风格并落库
  assert.match(tools, /saveCharacterPrompt\(getAgentTenantContext\(context\?\.requestContext\)/)
  assert.match(tools, /saveScenePrompt\(getAgentTenantContext\(context\?\.requestContext\)/)
  const data = read('src/data/tenant/image-prompts.ts')
  assert.match(data, /getDramaStylePrompt\(context, dramaId\)/)
  assert.match(data, /set\(\{ finalPrompt, updatedAt: now\(\) \}\)/)
  assert.doesNotMatch(tools, /db\/index/)
  // 提示词由 Agent 创作，不再由工具机械拼接
  assert.doesNotMatch(tools, /generate_character_prompt/)
  assert.doesNotMatch(tools, /generate_scene_prompt/)
})

test('prompt agent instructions reference per-asset skills; skill files define the specs', () => {
  const agents = read('workspace/prompts/prompt_generator.md')
  const settings = read('../frontend/app/pages/settings.vue')
  const charSkill = read('workspace/skills/prompt-generator/character-prompt/SKILL.md')
  const sceneSkill = read('workspace/skills/prompt-generator/scene-prompt/SKILL.md')

  for (const src of [agents]) {
    // 三类图片规范入口（具体创作规则在各自 SKILL.md 中）
    assert.match(src, /角色三视图/)
    assert.match(src, /场景固定视角/)
    assert.match(src, /道具白底单品/)
    // 保存工具约定
    assert.match(src, /save_character_final_prompt/)
    assert.match(src, /save_scene_final_prompt/)
  }
  const editor = read('../frontend/app/components/AgentCustomizations.vue')
  assert.match(settings, /<AgentCustomizations/)
  assert.match(editor, /promptAPI\.get\(type, language\)/)
  assert.match(editor, /skillsAPI\.get\(skill\.id, language\)/)
  assert.match(editor, /:readonly="skill\.is_default"/)
  assert.doesNotMatch(settings, /script_rewriter: `|prompt_generator: `/)
  // 角色三视图 / 场景固定视角的必备要素由技能文件承载（纯中文输出）
  assert.match(charSkill, /正脸特写/)
  assert.match(charSkill, /正面、90 度侧面、背面/)
  assert.match(charSkill, /三个视图的脸、发型和服装完全一致/)
  assert.match(charSkill, /会话语言指令指定的目标语言/)
  assert.match(sceneSkill, /固定机位广角镜头/)
  assert.match(sceneSkill, /前景（\[前景元素\]）、中景（\[中景主体空间\]）、后景（\[后景纵深\]）/)
  assert.match(sceneSkill, /出入口/)
  assert.match(sceneSkill, /会话语言指令指定的目标语言/)
})

test('image generation reuses saved prompts and fails when the Agent does not save one', () => {
  const service = read('src/services/final-prompt.ts')
  const characters = read('src/routes/characters.ts')
  const scenes = read('src/routes/scenes.ts')

  assert.match(service, /export async function ensureCharacterFinalPrompt/)
  assert.match(service, /export async function ensureSceneFinalPrompt/)
  assert.match(service, /getAgent\('prompt_generator'/)
  // 已有最终提示词直接复用（force 时忽略强制重新生成）
  assert.match(service, /if \(char\.finalPrompt && !force\) return char\.finalPrompt/)
  assert.match(service, /if \(scene\.finalPrompt && !force\) return scene\.finalPrompt/)
  assert.match(service, /force = false/)

  assert.match(characters, /ensureCharacterFinalPrompt\(char, ep\.id, /)
  // 文本模型覆盖（text_model/text_config_id）透传到提示词 Agent
  assert.match(characters, /text_model/)
  assert.doesNotMatch(characters, /characterImagePrompt/)
  assert.match(service, /throw new Error\('Agent 未保存最终提示词'\)/)
  assert.match(scenes, /ensureSceneFinalPrompt\(scene, ep\.id, /)
  // 描述字段编辑后最终提示词失效
  const assets = read('src/data/tenant/assets.ts')
  assert.ok((assets.match(/changed \? null : undefined/g) || []).length >= 3)
})
