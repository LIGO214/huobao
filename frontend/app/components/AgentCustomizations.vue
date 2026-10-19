<template>
  <div class="agent-settings">
    <nav class="agent-nav" :aria-label="t('settings.skills.agentList')">
      <button v-for="agent in agents" :key="agent.type" type="button" :disabled="saving" :class="{ active: selected === agent.type }" @click="selected = agent.type">
        <component :is="agent.icon" :size="16" />
        <span>{{ agent.label }}</span>
      </button>
    </nav>
    <div class="agent-main">
      <header class="agent-header">
        <h2>{{ selectedAgent?.label }}</h2>
        <span class="tag">{{ language }}</span>
      </header>
      <div class="agent-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="pane === 'prompt'" :class="{ active: pane === 'prompt' }" @click="pane = 'prompt'">Prompt</button>
        <button type="button" role="tab" :aria-selected="pane === 'skills'" :class="{ active: pane === 'skills' }" @click="pane = 'skills'">Skills <span>{{ currentSkills.length }}</span></button>
      </div>
      <div v-if="loadError" class="load-error" role="alert">
        <span>{{ loadError }}</span>
        <button class="btn btn-icon" :title="t('agentCustomization.retry')" :disabled="saving" @click="reload"><RefreshCw :size="15" /></button>
      </div>
      <div v-if="loading" class="loading-state"><Loader2 :size="18" class="animate-spin" /></div>
      <template v-else-if="prompt && limits">
        <section v-if="pane === 'prompt'" class="prompt-section">
          <details class="builtin-prompt">
            <summary><LockKeyhole :size="14" />{{ t('agentCustomization.builtInPrompt') }}</summary>
            <textarea class="textarea" :value="prompt.system_prompt" readonly rows="10" :aria-label="t('agentCustomization.builtInPrompt')" />
          </details>
          <form @submit.prevent="savePrompt">
            <label class="field">
              <span class="field-label">{{ t('agentCustomization.personalPrompt') }}</span>
              <textarea v-model="promptDraft" class="textarea" rows="14" :disabled="saving" :maxlength="prompt.max_length" :aria-label="t('agentCustomization.personalPrompt')" />
            </label>
            <footer class="editor-footer">
              <span class="dim">{{ promptDraft.length }} / {{ prompt.max_length }}</span>
              <button type="button" class="btn btn-icon" :title="t('agentCustomization.clearPrompt')" :disabled="saving" @click="resetPrompt"><RotateCcw :size="15" /></button>
              <button class="btn btn-primary" :disabled="saving || !promptDraft.trim() || promptDraft === prompt.user_prompt">
                <Loader2 v-if="saving" :size="14" class="animate-spin" /><Save v-else :size="14" />{{ t('common.save') }}
              </button>
            </footer>
          </form>
        </section>
        <section v-else class="skills-section">
          <div class="skill-toolbar">
            <span class="dim">{{ personalCount }} / {{ limits.max_count }}</span>
            <button class="btn btn-primary" :disabled="saving || personalCount >= limits.max_count" @click="showCreate = true"><Plus :size="14" />{{ t('settings.skills.add') }}</button>
          </div>
          <article v-for="skill in currentSkills" :key="skill.id" class="skill-entry">
            <div class="skill-heading">
              <button class="skill-open" :aria-expanded="openSkill === skill.id" @click="toggleSkill(skill)">
                <ChevronDown :size="15" :class="{ expanded: openSkill === skill.id }" />
                <span>{{ skill.name }}</span>
              </button>
              <span v-if="skill.is_default" class="tag"><LockKeyhole :size="11" />{{ t('agentCustomization.builtIn') }}</span>
              <template v-else>
                <label class="enabled-control"><input type="checkbox" :checked="skill.enabled" :disabled="saving" @change="toggleEnabled(skill, $event.target as HTMLInputElement)" />{{ t('agentCustomization.enabled') }}</label>
                <button class="btn btn-icon" :title="t('common.delete')" :disabled="saving" @click="deleteTarget = skill"><Trash2 :size="15" /></button>
              </template>
            </div>
            <form v-if="openSkill === skill.id && skillDrafts[skill.id]" class="skill-editor" @submit.prevent="saveSkill(skill)">
              <div v-if="!skill.is_default" class="skill-properties">
                <label class="field"><span class="field-label">{{ t('settings.skills.name') }}</span><input v-model="skillDrafts[skill.id].name" class="input" :disabled="saving" maxlength="120" required /></label>
                <label class="field"><span class="field-label">{{ t('agentCustomization.order') }}</span><input v-model.number="skillDrafts[skill.id].sort_order" class="input" :disabled="saving" type="number" min="0" max="10000" required /></label>
              </div>
              <textarea v-model="skillDrafts[skill.id].content" class="textarea" rows="14" :readonly="skill.is_default" :disabled="saving" :maxlength="skill.is_default ? undefined : limits.max_length" :aria-label="skill.name" />
              <footer v-if="!skill.is_default" class="editor-footer">
                <span class="dim">{{ skillDrafts[skill.id].content.length }} / {{ limits.max_length }}</span>
                <button class="btn btn-primary" :disabled="saving || !skillDrafts[skill.id].content.trim()"><Loader2 v-if="saving" :size="14" class="animate-spin" /><Save v-else :size="14" />{{ t('common.save') }}</button>
              </footer>
            </form>
          </article>
        </section>
      </template>
    </div>
    <div v-if="showCreate && limits" class="overlay" @click.self="!saving && (showCreate = false)">
      <form class="dialog" @submit.prevent="createSkill">
        <div class="dialog-head"><h3>{{ t('settings.skills.add') }}</h3><button type="button" class="btn btn-icon" :title="t('common.cancel')" :disabled="saving" @click="showCreate = false"><X :size="16" /></button></div>
        <div class="dialog-body">
          <label class="field"><span class="field-label">{{ t('settings.skills.name') }}</span><input v-model="newSkill.name" class="input" :disabled="saving" maxlength="120" required /></label>
          <label class="field"><span class="field-label">{{ t('agentCustomization.content') }}</span><textarea v-model="newSkill.content" class="textarea" rows="12" :disabled="saving" :maxlength="limits.max_length" required /></label>
          <span class="dim">{{ newSkill.content.length }} / {{ limits.max_length }}</span>
        </div>
        <div class="dialog-foot"><button type="button" class="btn" :disabled="saving" @click="showCreate = false">{{ t('common.cancel') }}</button><button class="btn btn-primary" :disabled="saving || !newSkill.name.trim() || !newSkill.content.trim()"><Plus :size="14" />{{ t('settings.skills.create') }}</button></div>
      </form>
    </div>
    <ConfirmDialog :open="!!deleteTarget" :title="t('settings.skillDelete.title')" :message="deleteTarget?.name || ''" :loading="saving" @confirm="deleteSkill" @cancel="deleteTarget = null" />
  </div>
</template>

<script setup lang="ts">
import { Bot, Clapperboard, ScanText, PenLine, ChevronDown, LockKeyhole, Plus, Save, Trash2, RotateCcw, RefreshCw, Loader2, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { promptAPI, skillsAPI, type AgentPrompt, type AgentSkill, type SkillLimits } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

const props = defineProps<{ language: string }>()
const { t } = useI18n()
const agents = computed(() => [
  { type: 'script_rewriter', label: t('settings.agents.scriptRewriter'), icon: PenLine },
  { type: 'extractor', label: t('settings.agents.extractor'), icon: ScanText },
  { type: 'storyboard_breaker', label: t('settings.agents.storyboardBreaker'), icon: Clapperboard },
  { type: 'prompt_generator', label: t('settings.agents.promptGenerator'), icon: Bot },
])
const selected = ref('script_rewriter'), pane = ref('prompt')
const selectedAgent = computed(() => agents.value.find(agent => agent.type === selected.value))
const prompt = ref<AgentPrompt | null>(null), limits = ref<SkillLimits | null>(null), skills = ref<AgentSkill[]>([])
const loading = ref(false), saving = ref(false), loadError = ref(''), openSkill = ref<string | null>(null)
const promptDrafts = reactive<Record<string, string>>({})
const draftKey = computed(() => `${selected.value}:${props.language}`)
const promptDraft = computed({ get: () => promptDrafts[draftKey.value] ?? '', set: value => { promptDrafts[draftKey.value] = value } })
const skillDrafts = reactive<Record<string, { name: string; content: string; sort_order: number }>>({})
const currentSkills = computed(() => skills.value.filter(skill => skill.agent_type === selected.value)
  .sort((a, b) => Number(b.is_default) - Number(a.is_default) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id)))
const personalCount = computed(() => currentSkills.value.filter(skill => !skill.is_default).length)
const showCreate = ref(false), deleteTarget = ref<AgentSkill | null>(null)
const newSkill = reactive({ name: '', content: '' })
let loadVersion = 0

async function reload() {
  const version = ++loadVersion, type = selected.value, language = props.language, key = draftKey.value
  loading.value = true
  loadError.value = ''
  prompt.value = null
  try {
    const [config, listing] = await Promise.all([promptAPI.get(type, language), skillsAPI.list()])
    if (version !== loadVersion) return
    prompt.value = config
    limits.value = listing.limits
    skills.value = [...listing.built_in, ...listing.user]
    if (!(key in promptDrafts)) promptDrafts[key] = config.user_prompt
  } catch (error) {
    if (version === loadVersion) loadError.value = (error as Error).message
  } finally { if (version === loadVersion) loading.value = false }
}
watch([selected, () => props.language], () => {
  openSkill.value = null
  for (const skill of skills.value.filter(entry => entry.is_default)) delete skillDrafts[skill.id]
  void reload()
}, { immediate: true })

function acceptSkill(skill: AgentSkill) {
  skills.value = [...skills.value.filter(row => row.id !== skill.id), skill]
  skillDrafts[skill.id] = { name: skill.name, content: skill.content!, sort_order: skill.sort_order ?? 0 }
}
async function savePrompt() {
  if (saving.value) return
  const type = selected.value, language = props.language, key = draftKey.value, text = promptDraft.value
  saving.value = true
  try {
    const result = await promptAPI.update(type, { user_prompt: text }, language)
    promptDrafts[key] = result.user_prompt
    if (draftKey.value === key && prompt.value) prompt.value.user_prompt = result.user_prompt
    toast.success(t('common.saved'))
  } catch (error) { toastError(error) } finally { saving.value = false }
}
async function resetPrompt() {
  if (saving.value) return
  const type = selected.value, language = props.language, key = draftKey.value
  saving.value = true
  try {
    await promptAPI.reset(type, language)
    promptDrafts[key] = ''
    if (draftKey.value === key && prompt.value) prompt.value.user_prompt = ''
    toast.success(t('common.saved'))
  } catch (error) { toastError(error) } finally { saving.value = false }
}
async function toggleSkill(skill: AgentSkill) {
  if (openSkill.value === skill.id) { openSkill.value = null; return }
  const type = selected.value, language = props.language, version = loadVersion
  try {
    if (!skillDrafts[skill.id]) {
      const detail = skill.is_default ? await skillsAPI.get(skill.id, language) : skill
      if (version !== loadVersion) return
      skillDrafts[skill.id] = { name: skill.name, content: detail.content!, sort_order: detail.sort_order ?? 0 }
    }
    if (selected.value === type && props.language === language) openSkill.value = skill.id
  } catch (error) { toastError(error) }
}
async function saveSkill(skill: AgentSkill) {
  if (saving.value) return
  saving.value = true
  try {
    acceptSkill(await skillsAPI.update(skill.id, { ...skillDrafts[skill.id] }))
    toast.success(t('common.saved'))
  } catch (error) { toastError(error) } finally { saving.value = false }
}
async function toggleEnabled(skill: AgentSkill, input: HTMLInputElement) {
  if (saving.value) return
  saving.value = true
  try {
    const saved = await skillsAPI.update(skill.id, { enabled: input.checked })
    skills.value = skills.value.map(row => row.id === skill.id ? saved : row)
  } catch (error) { input.checked = skill.enabled ?? false; toastError(error) }
  finally { saving.value = false }
}
async function createSkill() {
  if (saving.value) return
  saving.value = true
  try {
    acceptSkill(await skillsAPI.create({ agent_type: selected.value, ...newSkill }))
    showCreate.value = false
    newSkill.name = ''; newSkill.content = ''
    toast.success(t('settings.skills.created'))
  } catch (error) { toastError(error) } finally { saving.value = false }
}
async function deleteSkill() {
  if (saving.value || !deleteTarget.value) return
  const id = deleteTarget.value.id
  saving.value = true
  try {
    await skillsAPI.del(id)
    skills.value = skills.value.filter(row => row.id !== id)
    deleteTarget.value = null
    if (openSkill.value === id) openSkill.value = null
    delete skillDrafts[id]
  } catch (error) { toastError(error) } finally { saving.value = false }
}
</script>

<style scoped>
.agent-settings { display: flex; height: 100%; min-height: 0; min-width: 0; }
.agent-nav { width: 190px; flex-shrink: 0; padding: 16px 10px; border-right: 1px solid var(--border); }
.agent-nav button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 11px 10px; background: transparent; border: 0; border-radius: 6px; text-align: left; color: var(--text-1); cursor: pointer; }
.agent-nav button.active { background: var(--accent-bg); color: var(--accent); }
.agent-nav svg { flex-shrink: 0; }
.agent-main { flex: 1; min-width: 0; overflow-y: auto; padding: 24px; }
.agent-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.agent-header h2 { font-size: 18px; margin: 0; }
.agent-tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--border); margin: 18px 0 22px; }
.agent-tabs button { border: 0; background: transparent; padding: 10px 0; border-bottom: 2px solid transparent; color: var(--text-1); cursor: pointer; }
.agent-tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
.agent-tabs span { margin-left: 4px; font-size: 11px; }
.prompt-section, .skills-section { max-width: 960px; }
.builtin-prompt { margin-bottom: 24px; }
.builtin-prompt summary { display: flex; align-items: center; gap: 8px; padding: 10px 0; cursor: pointer; color: var(--text-1); }
.builtin-prompt textarea { margin-top: 10px; color: var(--text-1); }
.textarea { width: 100%; resize: vertical; line-height: 1.7; }
.editor-footer { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.editor-footer .dim { margin-right: auto; font-size: 12px; }
.skill-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 12px; }
.skill-entry { border-bottom: 1px solid var(--border); padding: 10px 0; }
.skill-heading { display: flex; align-items: center; gap: 10px; min-height: 38px; }
.skill-open { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; color: var(--text-0); text-align: left; border: 0; background: transparent; padding: 5px 0; cursor: pointer; }
.skill-open span { overflow-wrap: anywhere; }
.skill-open svg { flex-shrink: 0; transition: transform .15s; }
.skill-open svg.expanded { transform: rotate(180deg); }
.enabled-control { display: flex; align-items: center; gap: 5px; font-size: 12px; flex-shrink: 0; }
.skill-editor { padding: 14px 0 10px; }
.skill-properties { display: grid; grid-template-columns: minmax(0, 1fr) 100px; gap: 12px; margin-bottom: 14px; }
.tag { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; }
.load-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; color: var(--text-1); }
.loading-state { display: flex; justify-content: center; padding: 50px; }
.dialog { width: min(640px, calc(100vw - 32px)); }
.dialog-head h3 { margin: 0; font-size: 16px; }
.dialog-head { justify-content: space-between; }
.dialog-body { display: flex; flex-direction: column; gap: 16px; }
@media (max-width: 900px) {
  .agent-settings { flex-direction: column; }
  .agent-nav { width: auto; display: flex; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); padding: 8px; }
  .agent-nav button { width: auto; flex-shrink: 0; padding: 9px; font-size: 12px; }
  .agent-main { padding: 16px; }
}
@media (max-width: 480px) {
  .skill-heading { flex-wrap: wrap; }
  .skill-open { flex-basis: calc(100% - 120px); }
}
</style>
