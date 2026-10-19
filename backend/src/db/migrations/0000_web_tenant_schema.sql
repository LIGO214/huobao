CREATE TABLE "agent_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"agent_type" text NOT NULL,
	"drama_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"result" text,
	"error_msg" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text,
	CONSTRAINT "agent_tasks_owner_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_service_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"service_type" text NOT NULL,
	"provider" text,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text NOT NULL,
	"model" text,
	"endpoint" text,
	"query_endpoint" text,
	"priority" integer DEFAULT 0,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"settings" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "ai_configs_owner_id" UNIQUE("user_id","id"),
	CONSTRAINT "ai_configs_owner_name" UNIQUE("user_id","name"),
	CONSTRAINT "ai_configs_positive_owner" CHECK ("ai_service_configs"."user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_service_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"service_type" text NOT NULL,
	"provider" text NOT NULL,
	"default_url" text,
	"preset_models" text,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"user_id" integer NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "app_settings_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "app_settings_positive_owner" CHECK ("app_settings"."user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"drama_id" integer,
	"episode_id" integer,
	"storyboard_id" integer,
	"storyboard_num" integer,
	"name" text,
	"description" text,
	"type" text,
	"category" text,
	"url" text,
	"thumbnail_url" text,
	"local_path" text,
	"file_size" integer,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"duration" integer,
	"format" text,
	"image_gen_id" integer,
	"video_gen_id" integer,
	"is_favorite" boolean DEFAULT false,
	"view_count" integer DEFAULT 0,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "assets_owner_id" UNIQUE("user_id","id"),
	CONSTRAINT "assets_positive_owner" CHECK ("assets"."user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"drama_id" integer NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"description" text,
	"appearance" text,
	"styling" text,
	"final_prompt" text,
	"personality" text,
	"image_url" text,
	"seedance_asset_url" text,
	"reference_images" text,
	"seed_value" text,
	"sort_order" integer,
	"local_path" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "characters_owner_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "dramas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"genre" text,
	"style" text DEFAULT '3d',
	"aspect_ratio" text DEFAULT '16:9',
	"total_episodes" integer DEFAULT 1,
	"total_duration" integer DEFAULT 0,
	"status" text DEFAULT 'draft' NOT NULL,
	"thumbnail" text,
	"tags" text,
	"metadata" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "dramas_owner_id" UNIQUE("user_id","id"),
	CONSTRAINT "dramas_positive_owner" CHECK ("dramas"."user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "episode_characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "episode_characters_owner_pair" UNIQUE("user_id","episode_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "episode_props" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"prop_id" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "episode_props_owner_pair" UNIQUE("user_id","episode_id","prop_id")
);
--> statement-breakpoint
CREATE TABLE "episode_scenes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"scene_id" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "episode_scenes_owner_pair" UNIQUE("user_id","episode_id","scene_id")
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"drama_id" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"script_content" text,
	"description" text,
	"duration" integer DEFAULT 0,
	"status" text DEFAULT 'draft',
	"video_url" text,
	"thumbnail" text,
	"image_config_id" integer,
	"video_config_id" integer,
	"resolution" text DEFAULT '720p',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "episodes_owner_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "props" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"drama_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"description" text,
	"prompt" text,
	"final_prompt" text,
	"image_url" text,
	"reference_images" text,
	"local_path" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "props_owner_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"drama_id" integer NOT NULL,
	"episode_id" integer,
	"location" text NOT NULL,
	"time" text NOT NULL,
	"prompt" text NOT NULL,
	"lighting" text,
	"final_prompt" text,
	"storyboard_count" integer DEFAULT 1,
	"image_url" text,
	"status" text DEFAULT 'pending',
	"local_path" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "scenes_owner_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "storyboard_characters" (
	"user_id" integer NOT NULL,
	"storyboard_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	CONSTRAINT "storyboard_characters_user_id_storyboard_id_character_id_pk" PRIMARY KEY("user_id","storyboard_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "storyboard_props" (
	"user_id" integer NOT NULL,
	"storyboard_id" integer NOT NULL,
	"prop_id" integer NOT NULL,
	CONSTRAINT "storyboard_props_user_id_storyboard_id_prop_id_pk" PRIMARY KEY("user_id","storyboard_id","prop_id")
);
--> statement-breakpoint
CREATE TABLE "storyboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"scene_id" integer,
	"storyboard_number" integer NOT NULL,
	"title" text,
	"location" text,
	"time" text,
	"shot_type" text,
	"angle" text,
	"movement" text,
	"result" text,
	"atmosphere" text,
	"image_prompt" text,
	"video_prompt" text,
	"bgm_prompt" text,
	"sound_effect" text,
	"description" text,
	"duration" integer DEFAULT 0,
	"composed_image" text,
	"first_frame_image" text,
	"last_frame_image" text,
	"reference_images" text,
	"video_url" text,
	"subtitle_url" text,
	"composed_video_url" text,
	"status" text DEFAULT 'pending',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "storyboards_owner_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "style_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"prompt" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "style_presets_positive_owner" CHECK ("style_presets"."user_id" IS NULL OR "style_presets"."user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "sys_task" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"storyboard_id" integer,
	"drama_id" integer,
	"scene_id" integer,
	"character_id" integer,
	"prop_id" integer,
	"provider" text,
	"prompt" text,
	"model" text,
	"params" text,
	"task_id" text,
	"result_url" text,
	"local_path" text,
	"status" text DEFAULT 'processing',
	"error_msg" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text,
	CONSTRAINT "sys_task_owner_id" UNIQUE("user_id","id"),
	CONSTRAINT "sys_task_positive_owner" CHECK ("sys_task"."user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_agent_prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"agent_type" text NOT NULL,
	"lang" text DEFAULT 'zh' NOT NULL,
	"instructions" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "user_prompts_owner_agent_lang" UNIQUE("user_id","agent_type","lang"),
	CONSTRAINT "user_prompts_positive_owner" CHECK ("user_agent_prompts"."user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_agent_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"agent_type" text NOT NULL,
	"skill_id" text NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "user_skills_owner_agent_key" UNIQUE("user_id","agent_type","skill_id"),
	CONSTRAINT "user_skills_positive_owner" CHECK ("user_agent_skills"."user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "video_merges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"episode_id" integer,
	"drama_id" integer,
	"title" text,
	"provider" text,
	"model" text,
	"status" text DEFAULT 'pending',
	"scenes" text,
	"merged_url" text,
	"duration" integer,
	"task_id" text,
	"error_msg" text,
	"created_at" text NOT NULL,
	"completed_at" text,
	"deleted_at" text,
	CONSTRAINT "video_merges_owner_id" UNIQUE("user_id","id"),
	CONSTRAINT "video_merges_positive_owner" CHECK ("video_merges"."user_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_user_id_drama_id_dramas_user_id_id_fk" FOREIGN KEY ("user_id","drama_id") REFERENCES "public"."dramas"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_user_id_episode_id_episodes_user_id_id_fk" FOREIGN KEY ("user_id","episode_id") REFERENCES "public"."episodes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_drama_id_dramas_user_id_id_fk" FOREIGN KEY ("user_id","drama_id") REFERENCES "public"."dramas"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_episode_id_episodes_user_id_id_fk" FOREIGN KEY ("user_id","episode_id") REFERENCES "public"."episodes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_storyboard_id_storyboards_user_id_id_fk" FOREIGN KEY ("user_id","storyboard_id") REFERENCES "public"."storyboards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_image_gen_id_sys_task_user_id_id_fk" FOREIGN KEY ("user_id","image_gen_id") REFERENCES "public"."sys_task"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_video_gen_id_sys_task_user_id_id_fk" FOREIGN KEY ("user_id","video_gen_id") REFERENCES "public"."sys_task"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_drama_id_dramas_user_id_id_fk" FOREIGN KEY ("user_id","drama_id") REFERENCES "public"."dramas"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_characters" ADD CONSTRAINT "episode_characters_user_id_episode_id_episodes_user_id_id_fk" FOREIGN KEY ("user_id","episode_id") REFERENCES "public"."episodes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_characters" ADD CONSTRAINT "episode_characters_user_id_character_id_characters_user_id_id_fk" FOREIGN KEY ("user_id","character_id") REFERENCES "public"."characters"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_props" ADD CONSTRAINT "episode_props_user_id_episode_id_episodes_user_id_id_fk" FOREIGN KEY ("user_id","episode_id") REFERENCES "public"."episodes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_props" ADD CONSTRAINT "episode_props_user_id_prop_id_props_user_id_id_fk" FOREIGN KEY ("user_id","prop_id") REFERENCES "public"."props"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_scenes" ADD CONSTRAINT "episode_scenes_user_id_episode_id_episodes_user_id_id_fk" FOREIGN KEY ("user_id","episode_id") REFERENCES "public"."episodes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_scenes" ADD CONSTRAINT "episode_scenes_user_id_scene_id_scenes_user_id_id_fk" FOREIGN KEY ("user_id","scene_id") REFERENCES "public"."scenes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_user_id_drama_id_dramas_user_id_id_fk" FOREIGN KEY ("user_id","drama_id") REFERENCES "public"."dramas"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "props" ADD CONSTRAINT "props_user_id_drama_id_dramas_user_id_id_fk" FOREIGN KEY ("user_id","drama_id") REFERENCES "public"."dramas"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_user_id_drama_id_dramas_user_id_id_fk" FOREIGN KEY ("user_id","drama_id") REFERENCES "public"."dramas"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_user_id_episode_id_episodes_user_id_id_fk" FOREIGN KEY ("user_id","episode_id") REFERENCES "public"."episodes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_characters" ADD CONSTRAINT "storyboard_characters_user_id_storyboard_id_storyboards_user_id_id_fk" FOREIGN KEY ("user_id","storyboard_id") REFERENCES "public"."storyboards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_characters" ADD CONSTRAINT "storyboard_characters_user_id_character_id_characters_user_id_id_fk" FOREIGN KEY ("user_id","character_id") REFERENCES "public"."characters"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_props" ADD CONSTRAINT "storyboard_props_user_id_storyboard_id_storyboards_user_id_id_fk" FOREIGN KEY ("user_id","storyboard_id") REFERENCES "public"."storyboards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_props" ADD CONSTRAINT "storyboard_props_user_id_prop_id_props_user_id_id_fk" FOREIGN KEY ("user_id","prop_id") REFERENCES "public"."props"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_user_id_episode_id_episodes_user_id_id_fk" FOREIGN KEY ("user_id","episode_id") REFERENCES "public"."episodes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_user_id_scene_id_scenes_user_id_id_fk" FOREIGN KEY ("user_id","scene_id") REFERENCES "public"."scenes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_task" ADD CONSTRAINT "sys_task_user_id_drama_id_dramas_user_id_id_fk" FOREIGN KEY ("user_id","drama_id") REFERENCES "public"."dramas"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_task" ADD CONSTRAINT "sys_task_user_id_storyboard_id_storyboards_user_id_id_fk" FOREIGN KEY ("user_id","storyboard_id") REFERENCES "public"."storyboards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_task" ADD CONSTRAINT "sys_task_user_id_scene_id_scenes_user_id_id_fk" FOREIGN KEY ("user_id","scene_id") REFERENCES "public"."scenes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_task" ADD CONSTRAINT "sys_task_user_id_character_id_characters_user_id_id_fk" FOREIGN KEY ("user_id","character_id") REFERENCES "public"."characters"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_task" ADD CONSTRAINT "sys_task_user_id_prop_id_props_user_id_id_fk" FOREIGN KEY ("user_id","prop_id") REFERENCES "public"."props"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_merges" ADD CONSTRAINT "video_merges_user_id_drama_id_dramas_user_id_id_fk" FOREIGN KEY ("user_id","drama_id") REFERENCES "public"."dramas"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_merges" ADD CONSTRAINT "video_merges_user_id_episode_id_episodes_user_id_id_fk" FOREIGN KEY ("user_id","episode_id") REFERENCES "public"."episodes"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tasks_owner_status" ON "agent_tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "ai_configs_owner_type" ON "ai_service_configs" USING btree ("user_id","service_type");--> statement-breakpoint
CREATE INDEX "assets_owner_drama" ON "assets" USING btree ("user_id","drama_id");--> statement-breakpoint
CREATE INDEX "characters_owner_drama" ON "characters" USING btree ("user_id","drama_id");--> statement-breakpoint
CREATE INDEX "dramas_owner_created" ON "dramas" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "episodes_owner_drama" ON "episodes" USING btree ("user_id","drama_id","episode_number");--> statement-breakpoint
CREATE INDEX "props_owner_drama" ON "props" USING btree ("user_id","drama_id");--> statement-breakpoint
CREATE INDEX "scenes_owner_drama" ON "scenes" USING btree ("user_id","drama_id");--> statement-breakpoint
CREATE INDEX "storyboards_owner_episode" ON "storyboards" USING btree ("user_id","episode_id","storyboard_number");--> statement-breakpoint
CREATE UNIQUE INDEX "style_presets_system_value" ON "style_presets" USING btree ("value") WHERE "style_presets"."user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "style_presets_owner_value" ON "style_presets" USING btree ("user_id","value") WHERE "style_presets"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sys_task_owner_status" ON "sys_task" USING btree ("user_id","status","type");--> statement-breakpoint
CREATE INDEX "user_skills_owner_enabled" ON "user_agent_skills" USING btree ("user_id","agent_type","enabled","sort_order");--> statement-breakpoint
CREATE INDEX "video_merges_owner_episode" ON "video_merges" USING btree ("user_id","episode_id","created_at");