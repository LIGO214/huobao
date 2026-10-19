// Every business route and table must have an explicit ownership classification.
export const routeModules = {
  'agent.ts': 'tenant-private',
  'aiConfigs.ts': 'tenant-private',
  'asset-input.ts': 'input-helper',
  'assetLibrary.ts': 'web-disabled',
  'characters.ts': 'tenant-private',
  'dramas.ts': 'tenant-private',
  'episodes.ts': 'tenant-private',
  'merge.ts': 'tenant-private',
  'prompts.ts': 'tenant-private',
  'props.ts': 'tenant-private',
  'scenes.ts': 'tenant-private',
  'serverUpdate.ts': 'web-disabled',
  'settings.ts': 'tenant-private',
  'skills.ts': 'tenant-private',
  'storage.ts': 'tenant-private',
  'storyboards.ts': 'tenant-private',
  'stylePresets.ts': 'tenant-private',
  'task-input.ts': 'input-helper',
  'model-config-input.ts': 'input-helper',
  'tasks.ts': 'tenant-private',
  'upload.ts': 'tenant-private',
}

export const tables = {
  dramas: 'tenant-private', episodes: 'tenant-private', characters: 'tenant-private',
  episode_characters: 'tenant-private', episode_scenes: 'tenant-private', episode_props: 'tenant-private',
  scenes: 'tenant-private', storyboards: 'tenant-private', storyboard_characters: 'tenant-private', storyboard_props: 'tenant-private',
  ai_service_configs: 'tenant-private', ai_service_providers: 'system-shared', style_presets: 'system-and-tenant',
  sys_task: 'tenant-private', agent_tasks: 'tenant-private', video_merges: 'tenant-private', props: 'tenant-private',
  assets: 'tenant-private', app_settings: 'tenant-private', user_agent_prompts: 'tenant-private', user_agent_skills: 'tenant-private',
}

// Exact files, not directory exemptions. Remove entries as each domain is migrated.
export const pendingDatabaseAccess = {
}

export const approvedDatabaseAccess = {
  'index.ts': 'internal-readiness',
  'data/tenant/agent-assets.ts': 'tenant-private',
  'data/tenant/agent-customizations.ts': 'tenant-private',
  'data/tenant/agent-jobs.ts': 'tenant-private',
  'data/tenant/agent-scripts.ts': 'tenant-private',
  'data/tenant/agent-storyboards.ts': 'tenant-private',
  'data/tenant/assets.ts': 'tenant-private',
  'data/tenant/dramas.ts': 'tenant-private',
  'data/tenant/episodes.ts': 'tenant-private',
  'data/tenant/image-prompts.ts': 'tenant-private',
  'data/tenant/merges.ts': 'tenant-private',
  'data/tenant/settings.ts': 'tenant-private',
  'data/tenant/style-presets.ts': 'tenant-private',
  'data/tenant/styles.ts': 'tenant-private',
  'data/tenant/tasks.ts': 'tenant-private',
  'data/tenant/model-configs.ts': 'tenant-private',
  'data/system/model-providers.ts': 'system-shared',
  'data/system/seed.ts': 'system-shared',
  'services/startup-recovery.ts': 'internal-maintenance',
  'routes/assetLibrary.ts': 'web-disabled',
}

export const filesystemWriters = {
  'utils/tenant-storage.ts': 'tenant-private',
  'db/mysql-import.ts': 'web-disabled',
}

export const backgroundEntries = {
  'routes/agent.ts': 'tenant-private',
  'services/agent-execution.ts': 'tenant-private',
  'services/extraction.ts': 'tenant-private',
  'services/video-prompts.ts': 'tenant-private',
  'services/generation.ts': 'tenant-private',
  'services/ffmpeg-merge.ts': 'tenant-private',
  'utils/video-poster.ts': 'tenant-private',
  'services/startup-recovery.ts': 'internal-maintenance',
  'services/server-update.ts': 'web-disabled',
}

export const disabledModules = [
  'routes/assetLibrary.ts', 'routes/serverUpdate.ts', 'services/new-api-assets.ts',
  'services/server-update.ts', 'db/mysql-import.ts', 'db/sqlite-schema.ts',
]
