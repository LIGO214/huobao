/** PostgreSQL Web schema. Legacy SQLite is an offline migration source only. */
import { sql } from 'drizzle-orm'
import { pgTable, text, integer, serial, boolean, primaryKey, unique, uniqueIndex, index, foreignKey, check } from 'drizzle-orm/pg-core'

export const dramas = pgTable('dramas', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  genre: text('genre'),
  style: text('style').default('3d'),
  aspectRatio: text('aspect_ratio').default('16:9'),
  totalEpisodes: integer('total_episodes').default(1),
  totalDuration: integer('total_duration').default(0),
  status: text('status').notNull().default('draft'),
  thumbnail: text('thumbnail'),
  tags: text('tags'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, table => [
  unique('dramas_owner_id').on(table.userId, table.id),
  index('dramas_owner_created').on(table.userId, table.createdAt),
  check('dramas_positive_owner', sql`${table.userId} > 0`),
])

export const episodes = pgTable('episodes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  dramaId: integer('drama_id').notNull(),
  episodeNumber: integer('episode_number').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  scriptContent: text('script_content'),
  description: text('description'),
  duration: integer('duration').default(0),
  status: text('status').default('draft'),
  videoUrl: text('video_url'),
  thumbnail: text('thumbnail'),
  imageConfigId: integer('image_config_id'),
  videoConfigId: integer('video_config_id'),
  resolution: text('resolution').default('720p'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, table => [
  unique('episodes_owner_id').on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.dramaId], foreignColumns: [dramas.userId, dramas.id] }),
  foreignKey({ columns: [table.userId, table.imageConfigId], foreignColumns: [aiServiceConfigs.userId, aiServiceConfigs.id] }),
  foreignKey({ columns: [table.userId, table.videoConfigId], foreignColumns: [aiServiceConfigs.userId, aiServiceConfigs.id] }),
  index('episodes_owner_drama').on(table.userId, table.dramaId, table.episodeNumber),
])

export const characters = pgTable('characters', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  dramaId: integer('drama_id').notNull(),
  name: text('name').notNull(),
  role: text('role'),
  description: text('description'),
  appearance: text('appearance'),
  styling: text('styling'),
  finalPrompt: text('final_prompt'),
  personality: text('personality'),
  imageUrl: text('image_url'),
  seedanceAssetUrl: text('seedance_asset_url'),
  referenceImages: text('reference_images'),
  seedValue: text('seed_value'),
  sortOrder: integer('sort_order'),
  localPath: text('local_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, table => [
  unique('characters_owner_id').on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.dramaId], foreignColumns: [dramas.userId, dramas.id] }),
  index('characters_owner_drama').on(table.userId, table.dramaId),
])

// Episode-Character many-to-many
export const episodeCharacters = pgTable('episode_characters', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  episodeId: integer('episode_id').notNull(),
  characterId: integer('character_id').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  unique('episode_characters_owner_pair').on(table.userId, table.episodeId, table.characterId),
  foreignKey({ columns: [table.userId, table.episodeId], foreignColumns: [episodes.userId, episodes.id] }),
  foreignKey({ columns: [table.userId, table.characterId], foreignColumns: [characters.userId, characters.id] }),
])

// Episode-Scene many-to-many
export const episodeScenes = pgTable('episode_scenes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  episodeId: integer('episode_id').notNull(),
  sceneId: integer('scene_id').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  unique('episode_scenes_owner_pair').on(table.userId, table.episodeId, table.sceneId),
  foreignKey({ columns: [table.userId, table.episodeId], foreignColumns: [episodes.userId, episodes.id] }),
  foreignKey({ columns: [table.userId, table.sceneId], foreignColumns: [scenes.userId, scenes.id] }),
])

// Episode-Prop many-to-many
export const episodeProps = pgTable('episode_props', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  episodeId: integer('episode_id').notNull(),
  propId: integer('prop_id').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  unique('episode_props_owner_pair').on(table.userId, table.episodeId, table.propId),
  foreignKey({ columns: [table.userId, table.episodeId], foreignColumns: [episodes.userId, episodes.id] }),
  foreignKey({ columns: [table.userId, table.propId], foreignColumns: [props.userId, props.id] }),
])

export const scenes = pgTable('scenes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  dramaId: integer('drama_id').notNull(),
  episodeId: integer('episode_id'),
  location: text('location').notNull(),
  time: text('time').notNull(),
  prompt: text('prompt').notNull(),
  lighting: text('lighting'),
  finalPrompt: text('final_prompt'),
  storyboardCount: integer('storyboard_count').default(1),
  imageUrl: text('image_url'),
  status: text('status').default('pending'),
  localPath: text('local_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, table => [
  unique('scenes_owner_id').on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.dramaId], foreignColumns: [dramas.userId, dramas.id] }),
  foreignKey({ columns: [table.userId, table.episodeId], foreignColumns: [episodes.userId, episodes.id] }),
  index('scenes_owner_drama').on(table.userId, table.dramaId),
])

export const storyboards = pgTable('storyboards', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  episodeId: integer('episode_id').notNull(),
  sceneId: integer('scene_id'),
  storyboardNumber: integer('storyboard_number').notNull(),
  title: text('title'),
  location: text('location'),
  time: text('time'),
  shotType: text('shot_type'),
  angle: text('angle'),
  movement: text('movement'),
  result: text('result'),
  atmosphere: text('atmosphere'),
  imagePrompt: text('image_prompt'),
  videoPrompt: text('video_prompt'),
  bgmPrompt: text('bgm_prompt'),
  soundEffect: text('sound_effect'),
  description: text('description'),
  duration: integer('duration').default(0),
  composedImage: text('composed_image'),
  firstFrameImage: text('first_frame_image'),
  lastFrameImage: text('last_frame_image'),
  referenceImages: text('reference_images'),
  videoUrl: text('video_url'),
  subtitleUrl: text('subtitle_url'),
  composedVideoUrl: text('composed_video_url'),
  status: text('status').default('pending'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, table => [
  unique('storyboards_owner_id').on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.episodeId], foreignColumns: [episodes.userId, episodes.id] }),
  foreignKey({ columns: [table.userId, table.sceneId], foreignColumns: [scenes.userId, scenes.id] }),
  index('storyboards_owner_episode').on(table.userId, table.episodeId, table.storyboardNumber),
])

export const storyboardCharacters = pgTable('storyboard_characters', {
  userId: integer('user_id').notNull(),
  storyboardId: integer('storyboard_id').notNull(),
  characterId: integer('character_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.storyboardId, table.characterId] }),
  foreignKey({ columns: [table.userId, table.storyboardId], foreignColumns: [storyboards.userId, storyboards.id] }),
  foreignKey({ columns: [table.userId, table.characterId], foreignColumns: [characters.userId, characters.id] }),
])

export const storyboardProps = pgTable('storyboard_props', {
  userId: integer('user_id').notNull(),
  storyboardId: integer('storyboard_id').notNull(),
  propId: integer('prop_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.storyboardId, table.propId] }),
  foreignKey({ columns: [table.userId, table.storyboardId], foreignColumns: [storyboards.userId, storyboards.id] }),
  foreignKey({ columns: [table.userId, table.propId], foreignColumns: [props.userId, props.id] }),
])

export const aiServiceConfigs = pgTable('ai_service_configs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  serviceType: text('service_type').notNull(),
  provider: text('provider'),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  model: text('model'),
  endpoint: text('endpoint'),
  queryEndpoint: text('query_endpoint'),
  priority: integer('priority').default(0),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  settings: text('settings'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // 注意: 此表无 deleted_at
}, table => [
  unique('ai_configs_owner_id').on(table.userId, table.id),
  unique('ai_configs_owner_name').on(table.userId, table.name),
  index('ai_configs_owner_type').on(table.userId, table.serviceType),
  check('ai_configs_positive_owner', sql`${table.userId} > 0`),
])

export const aiServiceProviders = pgTable('ai_service_providers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  displayName: text('display_name'),
  serviceType: text('service_type').notNull(),
  provider: text('provider').notNull(),
  defaultUrl: text('default_url'),
  presetModels: text('preset_models'),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const stylePresets = pgTable('style_presets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  name: text('name').notNull(),
  value: text('value').notNull(),
  prompt: text('prompt').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('style_presets_system_value').on(table.value).where(sql`${table.userId} IS NULL`),
  uniqueIndex('style_presets_owner_value').on(table.userId, table.value).where(sql`${table.userId} IS NOT NULL`),
  check('style_presets_positive_owner', sql`${table.userId} IS NULL OR ${table.userId} > 0`),
])

// 统一生成任务表：图片/视频生成共用，type 区分，生成参数存 params(JSON)
export const sysTask = pgTable('sys_task', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  type: text('type').notNull(), // image | video
  storyboardId: integer('storyboard_id'),
  dramaId: integer('drama_id'),
  sceneId: integer('scene_id'),
  characterId: integer('character_id'),
  propId: integer('prop_id'),
  provider: text('provider'),
  prompt: text('prompt'),
  model: text('model'),
  // image: {size, frameType, referenceImages[]}
  // video: {referenceMode, firstFrameUrl, lastFrameUrl, referenceImageUrls[], referenceVideoUrls[], referenceAudioUrls[], referenceFileUrl, referenceLinkUrl, generateAudio, duration, aspectRatio, resolution, seed, promptExtend, watermark}
  params: text('params'),
  taskId: text('task_id'),
  resultUrl: text('result_url'),
  localPath: text('local_path'),
  status: text('status').default('processing'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, table => [
  unique('sys_task_owner_id').on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.dramaId], foreignColumns: [dramas.userId, dramas.id] }),
  foreignKey({ columns: [table.userId, table.storyboardId], foreignColumns: [storyboards.userId, storyboards.id] }),
  foreignKey({ columns: [table.userId, table.sceneId], foreignColumns: [scenes.userId, scenes.id] }),
  foreignKey({ columns: [table.userId, table.characterId], foreignColumns: [characters.userId, characters.id] }),
  foreignKey({ columns: [table.userId, table.propId], foreignColumns: [props.userId, props.id] }),
  index('sys_task_owner_status').on(table.userId, table.status, table.type),
  check('sys_task_positive_owner', sql`${table.userId} > 0`),
])

// 长耗时 Agent 操作（例如剧本改写）独立建模。浏览器只需短请求提交任务，
// 后续通过状态接口获取结果，避免代理或客户端的长连接限制影响实际执行。
export const agentTasks = pgTable('agent_tasks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  agentType: text('agent_type').notNull(),
  dramaId: integer('drama_id').notNull(),
  episodeId: integer('episode_id').notNull(),
  status: text('status').notNull().default('processing'),
  result: text('result'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, table => [
  unique('agent_tasks_owner_id').on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.dramaId], foreignColumns: [dramas.userId, dramas.id] }),
  foreignKey({ columns: [table.userId, table.episodeId], foreignColumns: [episodes.userId, episodes.id] }),
  index('agent_tasks_owner_status').on(table.userId, table.status),
])

export const videoMerges = pgTable('video_merges', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  episodeId: integer('episode_id'),
  dramaId: integer('drama_id'),
  title: text('title'),
  provider: text('provider'),
  model: text('model'),
  status: text('status').default('pending'),
  scenes: text('scenes'), // JSON
  mergedUrl: text('merged_url'),
  duration: integer('duration'),
  taskId: text('task_id'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
  deletedAt: text('deleted_at'),
}, table => [
  unique('video_merges_owner_id').on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.dramaId], foreignColumns: [dramas.userId, dramas.id] }),
  foreignKey({ columns: [table.userId, table.episodeId], foreignColumns: [episodes.userId, episodes.id] }),
  index('video_merges_owner_episode').on(table.userId, table.episodeId, table.createdAt),
  check('video_merges_positive_owner', sql`${table.userId} > 0`),
])

export const props = pgTable('props', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  dramaId: integer('drama_id').notNull(),
  name: text('name').notNull(),
  type: text('type'),
  description: text('description'),
  prompt: text('prompt'),
  finalPrompt: text('final_prompt'),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  localPath: text('local_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, table => [
  unique('props_owner_id').on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.dramaId], foreignColumns: [dramas.userId, dramas.id] }),
  index('props_owner_drama').on(table.userId, table.dramaId),
])

export const assets = pgTable('assets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  dramaId: integer('drama_id'),
  episodeId: integer('episode_id'),
  storyboardId: integer('storyboard_id'),
  storyboardNum: integer('storyboard_num'),
  name: text('name'),
  description: text('description'),
  type: text('type'),
  category: text('category'),
  url: text('url'),
  thumbnailUrl: text('thumbnail_url'),
  localPath: text('local_path'),
  fileSize: integer('file_size'),
  mimeType: text('mime_type'),
  width: integer('width'),
  height: integer('height'),
  duration: integer('duration'),
  format: text('format'),
  imageGenId: integer('image_gen_id'),
  videoGenId: integer('video_gen_id'),
  isFavorite: boolean('is_favorite').default(false),
  viewCount: integer('view_count').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, table => [
  unique('assets_owner_id').on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.dramaId], foreignColumns: [dramas.userId, dramas.id] }),
  foreignKey({ columns: [table.userId, table.episodeId], foreignColumns: [episodes.userId, episodes.id] }),
  foreignKey({ columns: [table.userId, table.storyboardId], foreignColumns: [storyboards.userId, storyboards.id] }),
  foreignKey({ columns: [table.userId, table.imageGenId], foreignColumns: [sysTask.userId, sysTask.id] }),
  foreignKey({ columns: [table.userId, table.videoGenId], foreignColumns: [sysTask.userId, sysTask.id] }),
  index('assets_owner_drama').on(table.userId, table.dramaId),
  check('assets_positive_owner', sql`${table.userId} > 0`),
])

export const appSettings = pgTable('app_settings', {
  userId: integer('user_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.key] }),
  check('app_settings_positive_owner', sql`${table.userId} > 0`),
])

// 用户可编辑的 Agent 补充内容。内置 Prompt/Skill 仍来自只读仓库文件，
// 这里仅保存纯文本，不保存脚本、文件路径或工具定义。
export const userAgentPrompts = pgTable('user_agent_prompts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  agentType: text('agent_type').notNull(),
  lang: text('lang').notNull().default('zh'),
  instructions: text('instructions').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  unique('user_prompts_owner_agent_lang').on(table.userId, table.agentType, table.lang),
  check('user_prompts_positive_owner', sql`${table.userId} > 0`),
])

export const userAgentSkills = pgTable('user_agent_skills', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  agentType: text('agent_type').notNull(),
  skillId: text('skill_id').notNull(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  unique('user_skills_owner_agent_key').on(table.userId, table.agentType, table.skillId),
  index('user_skills_owner_enabled').on(table.userId, table.agentType, table.enabled, table.sortOrder),
  check('user_skills_positive_owner', sql`${table.userId} > 0`),
])
