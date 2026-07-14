<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Bot, Check, ChevronRight, CircleCheck, CircleHelp, Database, Download, ExternalLink, Eye, EyeOff, FileText,
  Gauge, Github, HeartHandshake, KeyRound, Languages, LoaderCircle, LockKeyhole, MessageCircle,
  MonitorCog, Network, NotebookPen, Palette, Pencil, Plus, RotateCcw, Save, Settings2, ShieldCheck,
  SlidersHorizontal, Trash2, Upload, WandSparkles
} from 'lucide-vue-next'
import { configForProfile, connectionFingerprint, needsApiKey, sameSecretScope, useSettingsStore } from '@/stores/settings'
import { useConversationStore } from '@/stores/conversations'
import { useNotesStore } from '@/stores/notes'
import { testConnection } from '@/services/model'
import BrandMark from '@/components/BrandMark.vue'
import { APP_INFO } from '@/appInfo'
import type { ModelConfig, ModelProfile, ModelProfilesBackup, ProviderType } from '@/types'

type TabId = 'providers' | 'models' | 'safety' | 'prompts' | 'appearance' | 'data' | 'about'
type ProfileAction = { type: 'activate' | 'delete' | 'import', profileId?: string }

const store = useSettingsStore()
const conversations = useConversationStore()
const notes = useNotesStore()
const isDesktop = Boolean(window.desktopAPI)
const activeTab = ref<TabId>('providers')
const form = reactive<ModelConfig>({ ...store.config })
const showKey = ref(false)
const testing = ref(false)
const saving = ref(false)
const profileAction = ref<ProfileAction | null>(null)
const feedback = ref<{ type: 'success' | 'error', text: string } | null>(null)
const models = ref<string[]>([])
const importInput = ref<HTMLInputElement | null>(null)
const savedSnapshot = ref('')
let testedApiKey = ''

const tabs = [
  { id: 'providers' as const, label: '模型配置', desc: '保存、切换与连接', icon: Network },
  { id: 'models' as const, label: '功能模型', desc: '为四项功能分配模型', icon: Bot },
  { id: 'safety' as const, label: '上下文与数据', desc: '保护、历史和生成参数', icon: ShieldCheck },
  { id: 'prompts' as const, label: '提示词', desc: '各工作区行为规则', icon: WandSparkles },
  { id: 'appearance' as const, label: '外观', desc: '主题、缩放与字号', icon: Palette },
  { id: 'data' as const, label: '数据管理', desc: '导入、导出与清理', icon: Database },
  { id: 'about' as const, label: '关于', desc: '版本与运行环境', icon: CircleHelp }
]

const providers: { type: ProviderType, name: string, desc: string, baseUrl: string }[] = [
  { type: 'openai-compatible', name: 'OpenAI', desc: 'OpenAI 官方 API', baseUrl: 'https://api.openai.com/v1' },
  { type: 'openai-compatible', name: 'DeepSeek', desc: 'DeepSeek 官方 API', baseUrl: 'https://api.deepseek.com/v1' },
  { type: 'anthropic', name: 'Anthropic', desc: 'Claude Messages API', baseUrl: 'https://api.anthropic.com' },
  { type: 'gemini', name: 'Gemini', desc: 'Google Gemini API', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { type: 'ollama', name: 'Ollama', desc: '本地模型服务', baseUrl: 'http://127.0.0.1:11434' },
  { type: 'openai-compatible', name: '自定义', desc: 'OpenAI 兼容端点', baseUrl: '' }
]

const editingProfile = computed(() => store.profiles.find(profile => profile.id === form.profileId))
const sameStoredScope = computed(() => Boolean(editingProfile.value?.hasApiKey && sameSecretScope(editingProfile.value, form)))
const valid = computed(() => Boolean(form.baseUrl && form.chatModel && (!needsApiKey(form) || form.apiKey || sameStoredScope.value)))
const canSave = computed(() => !['providers', 'models'].includes(activeTab.value) || valid.value)
const showSaveBar = computed(() => !['data', 'about'].includes(activeTab.value))
const isDirty = computed(() => snapshot(form) !== savedSnapshot.value)
const isBusy = computed(() => testing.value || saving.value || Boolean(profileAction.value))
const storageLabel = computed(() => isDesktop ? 'Windows 加密' : '密钥仅保留当前会话')
const storageDescription = computed(() => isDesktop
  ? '备份不包含 API Key；密钥始终留在 Windows 加密存储中。'
  : '备份不包含 API Key；浏览器预览中的密钥只保留到当前页面会话结束。')
const apiKeyHint = computed(() => {
  if (sameStoredScope.value && !form.apiKey) {
    return isDesktop
      ? '已保存加密密钥；留空继续使用。切换连接地址或鉴权方式不会复用此密钥。'
      : '本次会话已有密钥；留空继续使用。刷新或关闭页面后需重新填写。'
  }
  return isDesktop
    ? '密钥仅在当前 Windows 用户下可解密。'
    : '浏览器预览不会保存密钥；刷新或关闭页面后需重新填写。'
})

function snapshot(value: ModelConfig) {
  return JSON.stringify(value)
}

function syncForm(value: ModelConfig) {
  Object.assign(form, value)
  savedSnapshot.value = snapshot(form)
  testedApiKey = ''
  models.value = []
}

onMounted(async () => {
  await store.initialize()
  syncForm(store.config)
  if (form.provider === 'ollama') form.authMode = 'none'
  else if (form.provider !== 'openai-compatible') form.authMode = 'bearer'
})

function selectProvider(item: typeof providers[number]) {
  const changed = form.provider !== item.type || form.providerName !== item.name || form.baseUrl !== item.baseUrl
  if (changed && form.profileId) {
    form.profileId = ''
    form.profileName = ''
  }
  form.provider = item.type
  form.providerName = item.name
  form.baseUrl = item.baseUrl
  form.authMode = item.type === 'ollama' ? 'none' : 'bearer'
  if (changed) {
    form.apiKey = ''
    form.chatModel = ''
    form.gameModel = ''
    form.serviceModel = ''
    form.pdfModel = ''
    form.embeddingModel = ''
    models.value = []
    feedback.value = null
    testedApiKey = ''
  }
}

function discardDraft() {
  return !isDirty.value || window.confirm('当前修改尚未保存，确定放弃吗？')
}

function newProfile() {
  if (isBusy.value) return
  if (!discardDraft()) return
  syncForm({
    ...store.config,
    profileId: '',
    profileName: '',
    provider: 'openai-compatible',
    providerName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    chatModel: '',
    gameModel: '',
    serviceModel: '',
    pdfModel: '',
    embeddingModel: '',
    authMode: 'bearer',
    apiKeyHeader: 'X-API-Key',
    tokenParameter: 'auto',
    lastTestedAt: '',
    lastTestedFingerprint: ''
  })
  feedback.value = null
  activeTab.value = 'providers'
}

function editProfile(profile: ModelProfile) {
  if (isBusy.value) return
  if (form.profileId !== profile.id && !discardDraft()) return
  syncForm(configForProfile(profile, store.config))
  feedback.value = null
  activeTab.value = 'providers'
}

async function activateProfile(profile: ModelProfile) {
  if (isBusy.value) return
  if (profile.id === store.activeProfileId) { editProfile(profile); return }
  if (!discardDraft()) return
  profileAction.value = { type: 'activate', profileId: profile.id }
  try {
    await store.activateProfile(profile.id)
    syncForm(store.config)
    feedback.value = { type: 'success', text: `已切换到“${profile.name}”，四个功能将使用这套配置。` }
  } catch (error) {
    feedback.value = { type: 'error', text: error instanceof Error ? error.message : '模型切换失败。' }
  } finally {
    profileAction.value = null
  }
}

async function removeProfile(profile: ModelProfile) {
  if (isBusy.value) return
  const activeHint = profile.id === store.activeProfileId ? ' 删除后将自动切换到下一套配置。' : ''
  if (!window.confirm(`确定删除“${profile.name}”吗？已保存的 API Key 也会一并移除。${activeHint}`)) return
  const shouldSyncForm = form.profileId === profile.id || profile.id === store.activeProfileId
  profileAction.value = { type: 'delete', profileId: profile.id }
  try {
    await store.deleteProfile(profile.id)
    if (shouldSyncForm) syncForm(store.config)
    feedback.value = { type: 'success', text: `已删除“${profile.name}”。` }
  } catch (error) {
    feedback.value = { type: 'error', text: error instanceof Error ? error.message : '删除失败。' }
  } finally {
    profileAction.value = null
  }
}

function isProfileVerified(profile: ModelProfile) {
  const credentialsAvailable = !needsApiKey(profile) || profile.hasApiKey
  return Boolean(credentialsAvailable && profile.lastTestedFingerprint && profile.lastTestedFingerprint === connectionFingerprint(configForProfile(profile, store.config)))
}

async function runTest() {
  if (isBusy.value) return
  if (!valid.value) { feedback.value = { type: 'error', text: '请先填写连接地址、聊天模型和必要的 API Key。' }; return }
  testing.value = true
  feedback.value = null
  try {
    const result = await testConnection(store.resolveForRequest({ ...form }))
    models.value = result.models
    if (form.embeddingModel && !result.embeddingOk) {
      form.lastTestedAt = ''
      form.lastTestedFingerprint = ''
      feedback.value = { type: 'error', text: `聊天模型测试成功，但 Embedding 测试失败：${result.embeddingError}` }
    } else {
      store.testedAt = Date.now()
      form.lastTestedAt = new Date().toISOString()
      form.lastTestedFingerprint = connectionFingerprint(form)
      testedApiKey = form.apiKey
      feedback.value = { type: 'success', text: `连接及最小对话测试成功，耗时 ${result.latencyMs || '<1'} ms${result.models.length ? `，发现 ${result.models.length} 个模型` : ''}${result.embeddingOk ? '，Embedding 正常' : ''}。` }
    }
  } catch (error) {
    feedback.value = { type: 'error', text: error instanceof Error ? error.message : '连接失败，请检查配置。' }
  } finally { testing.value = false }
}

async function save() {
  if (isBusy.value) return
  if (!canSave.value) { feedback.value = { type: 'error', text: '请先补全当前页面的模型配置。' }; return }
  saving.value = true
  try {
    const next = { ...form }
    next.profileName = next.profileName.trim() || [next.providerName, next.chatModel].filter(Boolean).join(' · ')
    if ((next.apiKey && next.apiKey !== testedApiKey) || (!next.apiKey && testedApiKey)) {
      next.lastTestedAt = ''
      next.lastTestedFingerprint = ''
    }
    await store.replace(next)
    syncForm(store.config)
    feedback.value = { type: 'success', text: activeTab.value === 'providers' ? `“${store.config.profileName}”已保存并设为当前使用。` : isDesktop ? '全部设置已保存，API Key 已由 Windows 加密。' : '全部设置已保存，API Key 仅保留在当前会话。' }
  } catch (error) {
    feedback.value = { type: 'error', text: error instanceof Error ? error.message : '设置保存失败。' }
  } finally {
    saving.value = false
  }
}

function exportData() {
  const { apiKey: _secret, ...safeConfig } = form
  const safeProfiles = store.profiles.map(({ hasApiKey: _hasKey, ...profile }) => profile)
  const payload = { version: 3, exportedAt: new Date().toISOString(), activeProfileId: store.activeProfileId, config: safeConfig, profiles: safeProfiles, conversations: conversations.items, notes: notes.items, noteFolders: notes.folders }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `qiyan-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

async function importData(file?: File) {
  if (!file) return
  if (isBusy.value) return
  if (form.safetyMode === 'read-only') { feedback.value = { type: 'error', text: '只读模式不允许导入并覆盖本地数据。' }; return }
  profileAction.value = { type: 'import' }
  try {
    const payload = JSON.parse(await file.text())
    if (!payload?.config || !Array.isArray(payload?.conversations)) throw new Error('备份文件结构无效。')
    if (payload.version === 3 && Array.isArray(payload.profiles)) {
      await store.importProfiles(payload as ModelProfilesBackup)
      syncForm(store.config)
      feedback.value = { type: 'success', text: `已恢复 ${store.profiles.length} 个模型配置。备份不含 API Key，请为显示“缺少密钥”的配置重新填写。` }
    } else {
      Object.assign(form, payload.config, { profileId: '', apiKey: '', lastTestedAt: '', lastTestedFingerprint: '' })
      form.profileName = `${form.profileName || [form.providerName, form.chatModel].filter(Boolean).join(' · ') || '导入模型'}（导入）`
      if (form.provider === 'ollama') form.authMode = 'none'
      else if (form.provider !== 'openai-compatible') form.authMode = 'bearer'
      feedback.value = { type: 'success', text: '旧版备份已载入为单个模型草稿。请检查配置后点击保存。' }
    }
    conversations.items.splice(0, conversations.items.length, ...payload.conversations)
    if (Array.isArray(payload.notes)) notes.replaceAll(payload.notes, payload.noteFolders)
    activeTab.value = 'providers'
  } catch (error) { feedback.value = { type: 'error', text: error instanceof Error ? error.message : '导入失败。' } }
  finally {
    profileAction.value = null
    if (importInput.value) importInput.value.value = ''
  }
}

function clearConversations() {
  if (form.safetyMode === 'read-only') { feedback.value = { type: 'error', text: '只读模式不允许删除本地会话。' }; return }
  if (form.safetyMode !== 'full-access' && !window.confirm('确定删除全部本地会话吗？此操作不可撤销。')) return
  conversations.items.splice(0)
  localStorage.removeItem('chat-agent:conversations:v1')
  feedback.value = { type: 'success', text: '全部本地会话已清除。' }
}

function clearNotes() {
  if (form.safetyMode === 'read-only') { feedback.value = { type: 'error', text: '防误删模式不允许清空笔记。' }; return }
  if (form.safetyMode !== 'full-access' && !window.confirm('确定删除全部笔记和文件夹吗？此操作不可撤销。')) return
  notes.clear()
  feedback.value = { type: 'success', text: '全部本地笔记已清除。' }
}

function restoreAppearance() {
  form.theme = 'light'
  form.uiScale = 100
  form.fontSize = 14
  form.compactSidebar = false
}
</script>

<template>
  <div class="settings-page">
    <aside class="settings-nav">
      <div class="settings-title"><span><Settings2 :size="20" /></span><div><strong>设置中心</strong><small>模型、行为与应用偏好</small></div></div>
      <button v-for="tab in tabs" :key="tab.id" type="button" :class="['settings-nav-item', { active: activeTab === tab.id }]" :aria-current="activeTab === tab.id ? 'page' : undefined" @click="activeTab = tab.id; feedback = null">
        <span class="nav-icon"><component :is="tab.icon" :size="18" /></span>
        <span><strong>{{ tab.label }}</strong><small>{{ tab.desc }}</small></span><ChevronRight :size="15" />
      </button>
    </aside>

    <form class="settings-content" :aria-busy="isBusy" @submit.prevent="save">
      <template v-if="activeTab === 'providers'">
        <div class="settings-header"><div><h2>模型配置</h2><p>保存多个模型连接，并随时切换当前使用的模型。</p></div><div class="settings-header-actions"><span class="local-tag"><LockKeyhole :size="14" />{{ storageLabel }}</span><button type="button" class="secondary-btn" :disabled="isBusy" @click="newProfile"><Plus :size="15" />添加模型</button></div></div>

        <section class="profile-library" aria-labelledby="profile-library-title">
          <div class="profile-library-heading"><div><strong id="profile-library-title">已配置模型</strong><span>{{ store.profiles.length }} 个配置</span></div></div>
          <div v-if="!store.profiles.length" class="profile-empty"><Network :size="22" /><div><strong>还没有模型配置</strong><p>添加一个模型并填写连接信息，保存后即可在四个功能中使用。</p></div><button type="button" class="secondary-btn" :disabled="isBusy" @click="newProfile"><Plus :size="15" />添加第一个模型</button></div>
          <div v-else class="model-profile-list">
            <article v-for="profile in store.profiles" :key="profile.id" :class="['model-profile-row', { active: profile.id === store.activeProfileId }]">
              <span class="profile-provider-logo">{{ profile.providerName.slice(0, 1) }}</span>
              <div class="profile-main"><strong :title="profile.name">{{ profile.name }}</strong><span :title="profile.chatModel">{{ profile.providerName }} · {{ profile.chatModel }}</span><small :title="profile.baseUrl">{{ profile.baseUrl }}</small></div>
              <div class="profile-status"><span :class="['verification-state', { verified: isProfileVerified(profile) }]"><i />{{ isProfileVerified(profile) ? '已验证' : '待测试' }}</span><span v-if="profile.hasApiKey" class="key-state"><LockKeyhole :size="12" />{{ isDesktop ? '密钥已加密' : '会话密钥可用' }}</span><span v-else-if="needsApiKey(profile)" class="key-state missing"><KeyRound :size="12" />缺少密钥</span><span v-else class="key-state"><CircleCheck :size="12" />无需密钥</span></div>
              <div class="profile-actions"><span v-if="profile.id === store.activeProfileId" class="active-profile"><CircleCheck :size="14" />当前使用</span><button v-else type="button" class="secondary-btn profile-use" :disabled="isBusy" @click="activateProfile(profile)"><LoaderCircle v-if="profileAction?.type === 'activate' && profileAction.profileId === profile.id" class="spin" :size="14" />{{ profileAction?.type === 'activate' && profileAction.profileId === profile.id ? '切换中' : '使用' }}</button><button type="button" class="icon-btn" :title="`编辑 ${profile.name}`" :aria-label="`编辑 ${profile.name}`" :disabled="isBusy" @click="editProfile(profile)"><Pencil :size="15" /></button><button type="button" class="icon-btn danger-icon" :title="`删除 ${profile.name}`" :aria-label="`删除 ${profile.name}`" :disabled="isBusy" @click="removeProfile(profile)"><LoaderCircle v-if="profileAction?.type === 'delete' && profileAction.profileId === profile.id" class="spin" :size="15" /><Trash2 v-else :size="15" /></button></div>
            </article>
          </div>
        </section>

        <div class="model-editor-heading"><div><strong>{{ form.profileId ? '编辑模型配置' : '添加模型' }}</strong><span>{{ form.profileId ? '修改后保存会更新该配置并设为当前使用。' : '选择供应商并填写连接信息，保存不会覆盖已有配置。' }}</span></div><span v-if="form.profileId">{{ form.profileName || '未命名配置' }}</span></div>
        <div class="provider-grid">
          <button v-for="provider in providers" :key="provider.name" type="button" :class="['provider-option', { active: form.providerName === provider.name }]" :aria-pressed="form.providerName === provider.name" :disabled="isBusy" @click="selectProvider(provider)">
            <span class="provider-logo">{{ provider.name.slice(0, 1) }}</span><span><strong>{{ provider.name }}</strong><small>{{ provider.desc }}</small></span><Check v-if="form.providerName === provider.name" :size="17" />
          </button>
        </div>
        <section class="settings-section">
          <div class="section-heading"><Network :size="18" /><div><strong>认证与连接</strong><span>支持官方服务、本地 Ollama 和 OpenAI 兼容接口</span></div></div>
          <div class="form-grid">
            <div class="field wide"><label>配置名称</label><input v-model.trim="form.profileName" aria-label="配置名称" maxlength="120" :placeholder="`${form.providerName || '模型'} · ${form.chatModel || '聊天模型'}`" /><small>用于区分相同供应商下的不同地址、模型或账号；留空会自动生成。</small></div>
            <div class="field wide"><label>Base URL</label><input v-model.trim="form.baseUrl" aria-label="Base URL" placeholder="https://api.example.com/v1" /><small>可填写 API 根地址，也可直接填写以 `/chat/completions` 结尾的地址。</small></div>
            <div v-if="form.provider === 'openai-compatible'" class="field"><label>鉴权方式</label><select v-model="form.authMode" aria-label="鉴权方式"><option value="bearer">Bearer Token</option><option value="api-key-header">自定义 API Key Header</option><option value="none">无鉴权（仅可信本地服务）</option></select></div><div v-else-if="form.provider !== 'ollama'" class="field"><label>鉴权方式</label><input :value="form.provider === 'anthropic' ? 'Anthropic x-api-key' : 'Gemini URL API Key'" aria-label="鉴权方式" disabled /></div><div v-if="form.provider === 'openai-compatible' && form.authMode === 'api-key-header'" class="field"><label>API Key Header</label><input v-model.trim="form.apiKeyHeader" aria-label="API Key Header" placeholder="X-API-Key" /></div>
            <div v-if="needsApiKey(form)" class="field wide"><label>API Key</label><div class="secret-input"><input v-model.trim="form.apiKey" :type="showKey ? 'text' : 'password'" aria-label="API Key" autocomplete="off" placeholder="输入新的 API Key" /><button type="button" class="ghost-btn" :title="showKey ? '隐藏密钥' : '显示密钥'" @click="showKey = !showKey"><component :is="showKey ? EyeOff : Eye" :size="17" /></button></div><small>{{ apiKeyHint }}</small></div>
            <div class="field"><label>默认聊天模型</label><input v-model.trim="form.chatModel" list="model-list" aria-label="默认聊天模型" placeholder="例如 gpt-4.1-mini" /><datalist id="model-list"><option v-for="model in models" :key="model" :value="model" /></datalist></div>
            <div class="field"><label>Token 参数兼容</label><select v-model="form.tokenParameter" aria-label="Token 参数兼容"><option value="auto">自动检测</option><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></select></div>
          </div>
        </section>
      </template>

      <template v-else-if="activeTab === 'models'">
        <div class="settings-header"><div><h2>功能模型</h2><p>不同功能可使用不同模型；留空时自动跟随默认聊天模型。</p></div></div>
        <section class="settings-section model-assignments">
          <div class="assignment-row"><span class="assignment-icon chat"><MessageCircle :size="19" /></span><div><strong>AI 聊天</strong><small>通用问答、写作与分析</small></div><input v-model.trim="form.chatModel" list="model-list" aria-label="AI 聊天模型" placeholder="必填" /></div>
          <div class="assignment-row"><span class="assignment-icon game"><HeartHandshake :size="19" /></span><div><strong>哄哄模拟器</strong><small>建议选择指令遵循和 JSON 能力稳定的模型</small></div><input v-model.trim="form.gameModel" list="model-list" aria-label="哄哄模拟器模型" :placeholder="`跟随 ${form.chatModel || '默认模型'}`" /></div>
          <div class="assignment-row"><span class="assignment-icon notes"><NotebookPen :size="19" /></span><div><strong>灵感笔记</strong><small>用于摘要、润色、续写与整理</small></div><input v-model.trim="form.serviceModel" list="model-list" aria-label="灵感笔记模型" :placeholder="`跟随 ${form.chatModel || '默认模型'}`" /></div>
          <div class="assignment-row"><span class="assignment-icon pdf"><FileText :size="19" /></span><div><strong>ChatPDF</strong><small>建议选择长上下文模型</small></div><input v-model.trim="form.pdfModel" list="model-list" aria-label="ChatPDF 模型" :placeholder="`跟随 ${form.chatModel || '默认模型'}`" /></div>
          <div class="assignment-row"><span class="assignment-icon embed"><Gauge :size="19" /></span><div><strong>Embedding</strong><small>可选；当前无配置时使用中文关键词检索</small></div><input v-model.trim="form.embeddingModel" list="model-list" aria-label="Embedding 模型" placeholder="例如 text-embedding-3-small" /></div>
        </section>
      </template>

      <template v-else-if="activeTab === 'safety'">
        <div class="settings-header"><div><h2>上下文与数据</h2><p>控制本地数据保护、历史窗口和生成参数。</p></div></div>
        <section class="settings-section"><div class="section-heading"><ShieldCheck :size="18" /><div><strong>本地操作保护</strong><span>用于笔记删除、备份导入和批量清理</span></div></div><div class="choice-grid"><button type="button" :class="{ active: form.safetyMode === 'read-only' }" :aria-pressed="form.safetyMode === 'read-only'" @click="form.safetyMode = 'read-only'"><LockKeyhole :size="18" /><strong>防误删</strong><small>阻止导入覆盖和删除本地内容</small></button><button type="button" :class="{ active: form.safetyMode === 'confirm-write' }" :aria-pressed="form.safetyMode === 'confirm-write'" @click="form.safetyMode = 'confirm-write'"><ShieldCheck :size="18" /><strong>标准模式</strong><small>删除和批量清理前要求确认</small></button><button type="button" :class="{ active: form.safetyMode === 'full-access' }" :aria-pressed="form.safetyMode === 'full-access'" @click="form.safetyMode = 'full-access'"><KeyRound :size="18" /><strong>快捷模式</strong><small>明确点击后直接执行本地操作</small></button></div></section>
        <section class="settings-section"><div class="section-heading"><SlidersHorizontal :size="18" /><div><strong>上下文与生成</strong><span>参数过大会增加延迟和费用</span></div></div><div class="form-grid"><div class="field"><label>历史消息数</label><input v-model.number="form.historyLimit" type="number" min="2" max="100" /><small>每次发送携带最近多少条消息。</small></div><div class="field"><label>上下文字数上限</label><input v-model.number="form.contextCharLimit" type="number" min="4000" max="120000" step="1000" /><small>ChatPDF 会按此预算增加检索页数并截取文档。</small></div><div class="field"><label>Temperature</label><input v-model.number="form.temperature" type="number" min="0" max="2" step="0.1" /></div><div class="field"><label>最大输出 Token</label><input v-model.number="form.maxTokens" type="number" min="64" max="32768" step="64" /></div><div class="field"><label>请求超时（秒）</label><input v-model.number="form.timeoutSeconds" type="number" min="10" max="600" /><small>现在会真正中止超时的生成请求。</small></div></div></section>
      </template>

      <template v-else-if="activeTab === 'prompts'">
        <div class="settings-header"><div><h2>提示词</h2><p>自定义内容追加在应用内置安全规则之后。</p></div></div>
        <section class="settings-section prompt-list"><div class="field"><label>全局补充提示词 <span>{{ form.globalPrompt.length }}/2000</span></label><textarea v-model="form.globalPrompt" aria-label="全局补充提示词" maxlength="2000" rows="3" placeholder="例如：先给结论，回答保持简洁。" /></div><div class="field"><label>AI 聊天</label><textarea v-model="form.chatPrompt" aria-label="AI 聊天提示词" rows="3" placeholder="留空使用内置提示词" /></div><div class="field"><label>哄哄模拟器</label><textarea v-model="form.gamePrompt" aria-label="哄哄模拟器提示词" rows="3" placeholder="可补充角色语气与场景边界" /></div><div class="field"><label>灵感笔记</label><textarea v-model="form.servicePrompt" aria-label="灵感笔记提示词" rows="3" placeholder="可补充写作语气、格式与处理偏好" /></div><div class="field"><label>ChatPDF</label><textarea v-model="form.pdfPrompt" aria-label="ChatPDF 提示词" rows="3" placeholder="可补充引用格式与回答约束" /></div></section>
      </template>

      <template v-else-if="activeTab === 'appearance'">
        <div class="settings-header"><div><h2>外观</h2><p>调整主题、界面缩放、字号和侧栏密度。</p></div><button type="button" class="secondary-btn" @click="restoreAppearance"><RotateCcw :size="15" />恢复默认</button></div>
        <section class="settings-section"><div class="section-heading"><Palette :size="18" /><div><strong>主题</strong><span>选择适合当前环境的显示方式</span></div></div><div class="theme-grid"><button v-for="theme in [{id:'light',name:'亮色'},{id:'dark',name:'暗色'},{id:'system',name:'跟随系统'}]" :key="theme.id" type="button" :class="{ active: form.theme === theme.id }" :aria-pressed="form.theme === theme.id" @click="form.theme = theme.id as ModelConfig['theme']"><span :class="['theme-preview', theme.id]" /><strong>{{ theme.name }}</strong><Check v-if="form.theme === theme.id" :size="16" /></button></div></section>
        <section class="settings-section sliders"><label><span>界面缩放</span><output>{{ form.uiScale }}%</output><input v-model.number="form.uiScale" type="range" min="85" max="115" step="5" :style="{ background: `linear-gradient(to right, var(--green) 0%, var(--green) ${(form.uiScale - 85) / 30 * 100}%, var(--line) ${(form.uiScale - 85) / 30 * 100}%, var(--line) 100%)` }" /></label><label><span>基础字号</span><output>{{ form.fontSize }}px</output><input v-model.number="form.fontSize" type="range" min="12" max="17" step="1" :style="{ background: `linear-gradient(to right, var(--green) 0%, var(--green) ${(form.fontSize - 12) / 5 * 100}%, var(--line) ${(form.fontSize - 12) / 5 * 100}%, var(--line) 100%)` }" /></label><label class="toggle-row"><span><strong>紧凑侧栏</strong><small>减少主导航宽度，给内容区更多空间</small></span><input v-model="form.compactSidebar" type="checkbox" /></label></section>
      </template>

      <template v-else-if="activeTab === 'data'">
        <div class="settings-header"><div><h2>数据管理</h2><p>{{ storageDescription }}</p></div></div>
        <section class="settings-section action-list"><button type="button" :disabled="isBusy" @click="exportData"><span><Download :size="19" /></span><div><strong>导出备份</strong><small>导出设置、模型列表、会话、笔记和文件夹</small></div><ChevronRight :size="17" /></button><button type="button" :disabled="isBusy" @click="importInput?.click()"><span><LoaderCircle v-if="profileAction?.type === 'import'" class="spin" :size="19" /><Upload v-else :size="19" /></span><div><strong>{{ profileAction?.type === 'import' ? '正在导入' : '导入备份' }}</strong><small>恢复模型列表时需重新填写备份中未包含的密钥</small></div><ChevronRight :size="17" /></button><button type="button" class="danger-action" :disabled="isBusy" @click="clearConversations"><span><Database :size="19" /></span><div><strong>清除聊天与游戏记录</strong><small>删除 AI 聊天和哄哄模拟器的本地记录</small></div><ChevronRight :size="17" /></button><button type="button" class="danger-action" :disabled="isBusy" @click="clearNotes"><span><NotebookPen :size="19" /></span><div><strong>清除全部笔记</strong><small>删除所有笔记、标签和文件夹</small></div><ChevronRight :size="17" /></button><input ref="importInput" hidden type="file" accept="application/json" @change="importData(($event.target as HTMLInputElement).files?.[0])" /></section>
      </template>

      <template v-else>
        <div class="settings-header"><div><h2>关于栖言</h2><p>让对话、文档和工作安静地落在本机。</p></div></div>
        <section class="settings-section about-panel"><BrandMark class="about-logo" :size="54" /><div><h3>{{ APP_INFO.name }} {{ APP_INFO.englishName }} {{ APP_INFO.version }}</h3><p>{{ isDesktop ? 'Electron 桌面版 · Windows x64' : '浏览器预览模式' }}</p></div><dl><div><dt>本版更新</dt><dd>通知中心 · 首次引导 · 关于信息</dd></div><div><dt>作者</dt><dd>{{ APP_INFO.author }}</dd></div><div><dt>GitHub 仓库</dt><dd><a class="about-link" :href="APP_INFO.repositoryUrl" target="_blank" rel="noopener noreferrer"><Github :size="14" />{{ APP_INFO.repositoryLabel }}<ExternalLink :size="12" /></a></dd></div><div><dt>密钥保护</dt><dd>{{ isDesktop ? 'Windows DPAPI' : '仅当前页面会话' }}</dd></div><div><dt>模型协议</dt><dd>OpenAI · Anthropic · Gemini · Ollama</dd></div><div><dt>语言</dt><dd><Languages :size="14" /> 简体中文</dd></div><div><dt>数据位置</dt><dd>{{ isDesktop ? '当前 Windows 用户目录' : '浏览器本地存储（不含密钥）' }}</dd></div></dl></section>
      </template>

      <div v-if="feedback" :class="['notice', feedback.type]"><component :is="feedback.type === 'success' ? Check : KeyRound" :size="17" />{{ feedback.text }}</div>
      <div v-if="showSaveBar" class="settings-actions"><button v-if="activeTab === 'providers'" type="button" class="secondary-btn" :disabled="isBusy" @click="runTest"><LoaderCircle v-if="testing" class="spin" :size="16" /><Network v-else :size="16" />{{ testing ? '测试中' : '测试连接与对话' }}</button><button type="submit" class="primary-btn" :disabled="!canSave || isBusy"><LoaderCircle v-if="saving" class="spin" :size="16" /><Save v-else :size="16" />{{ saving ? '保存中' : activeTab === 'providers' ? '保存并使用' : '保存全部设置' }}</button></div>
    </form>
  </div>
</template>

<style scoped>
.settings-page { min-height: 100%; display: grid; grid-template-columns: 250px minmax(0, 1fr); background: #fff; }
.settings-nav { border-right: 1px solid var(--line); padding: 22px 16px; background: #fbfcfc; overflow: auto; }
.settings-title { display: flex; gap: 11px; align-items: center; padding: 0 8px 22px; }
.settings-title > span { width: 38px; height: 38px; display: grid; place-items: center; color: var(--green); background: var(--green-soft); border-radius: 8px; }
.settings-title strong, .settings-title small { display: block; }.settings-title strong { font-size: 15px; }.settings-title small { color: #8a93a0; margin-top: 3px; font-size: 10px; }
.settings-nav-item { width: 100%; border: 1px solid transparent; background: transparent; display: grid; grid-template-columns: 34px 1fr 16px; align-items: center; gap: 8px; padding: 10px; margin-bottom: 5px; border-radius: 8px; text-align: left; color: #667080; }
.settings-nav-item:hover { background: #f2f4f5; }.settings-nav-item.active { color: #17241c; border-color: #b9dfc7; background: #eaf8ef; box-shadow: inset 3px 0 var(--green); }
.nav-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 7px; background: #f0f2f4; }.active .nav-icon { color: var(--green); background: #d9f4e3; }
.settings-nav-item strong, .settings-nav-item small { display: block; }.settings-nav-item strong { font-size: 12px; }.settings-nav-item small { margin-top: 3px; color: #939ba7; font-size: 9px; }
.settings-content { min-width: 0; width: 100%; max-width: 1040px; padding: 30px 36px 92px; overflow: visible; }
.settings-header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 22px; }.settings-header h2 { margin: 0 0 6px; font-size: 21px; }.settings-header p { margin: 0; color: var(--muted); font-size: 12px; }.local-tag { display: flex; gap: 6px; align-items: center; color: #647081; border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; font-size: 10px; }
.settings-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.profile-library { margin-bottom: 24px; }.profile-library-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px; }.profile-library-heading strong { font-size: 12px; }.profile-library-heading span { margin-left: 8px; color: var(--muted); font-size: 10px; font-weight: 400; }
.profile-empty { min-height: 86px; border: 1px dashed var(--line); border-radius: 8px; display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 12px; padding: 15px 17px; color: var(--green); }.profile-empty strong { color: var(--ink); font-size: 12px; }.profile-empty p { margin: 4px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
.model-profile-list { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }.model-profile-row { min-width: 0; display: grid; grid-template-columns: 38px minmax(180px, 1fr) minmax(115px, auto) auto; gap: 12px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--line); background: var(--control); }.model-profile-row:last-child { border-bottom: 0; }.model-profile-row.active { background: var(--green-soft); box-shadow: inset 3px 0 var(--green); }.profile-provider-logo { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 7px; background: var(--hover); color: var(--ink); font-weight: 800; font-size: 12px; }.model-profile-row.active .profile-provider-logo { color: var(--green-dark); background: color-mix(in srgb, var(--green-soft) 65%, var(--surface)); }
.profile-main { min-width: 0; }.profile-main strong, .profile-main span, .profile-main small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.profile-main strong { font-size: 12px; }.profile-main span { margin-top: 3px; color: var(--muted); font-size: 10px; }.profile-main small { margin-top: 2px; color: #929aa5; font-size: 9px; }.profile-status { display: grid; gap: 5px; justify-items: start; color: var(--muted); font-size: 9px; white-space: nowrap; }.verification-state, .key-state, .active-profile { display: inline-flex; align-items: center; gap: 5px; }.verification-state i { width: 6px; height: 6px; border-radius: 50%; background: #c7ccd3; }.verification-state.verified { color: var(--green-dark); }.verification-state.verified i { background: var(--green); }.key-state { color: var(--muted); }.profile-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }.active-profile { color: var(--green-dark); font-size: 10px; font-weight: 650; white-space: nowrap; }.profile-use { min-height: 34px; padding-inline: 11px; font-size: 10px; }.danger-icon { color: #bb4c4c; }.danger-icon:hover { color: #a13232; background: #fff1f1; }
.key-state.missing { color: #b05f34; }.settings-content button:disabled { cursor: not-allowed; opacity: .55; }
.model-editor-heading { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; margin: 0 0 10px; padding-top: 2px; }.model-editor-heading strong, .model-editor-heading span { display: block; }.model-editor-heading strong { font-size: 13px; }.model-editor-heading div > span { margin-top: 4px; color: var(--muted); font-size: 10px; }.model-editor-heading > span { max-width: 45%; color: var(--green-dark); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-bottom: 16px; }.provider-option { min-width: 0; border: 1px solid var(--line); border-radius: 8px; background: #fff; display: grid; grid-template-columns: 34px 1fr 17px; gap: 9px; align-items: center; text-align: left; padding: 12px; }.provider-option:hover { background: #fafbfb; }.provider-option.active { border-color: #65c18a; background: #f2fbf5; box-shadow: 0 0 0 2px #e2f5e9; }.provider-logo { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 7px; background: #eef1f3; font-weight: 800; }.provider-option.active .provider-logo { color: var(--green-dark); background: #dbf4e4; }.provider-option strong, .provider-option small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.provider-option strong { font-size: 11px; }.provider-option small { color: #8b94a1; margin-top: 3px; font-size: 9px; }.provider-option > svg { color: var(--green); }
.settings-section { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 20px; margin-bottom: 14px; }.section-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; color: #53606e; }.section-heading strong, .section-heading span { display: block; }.section-heading strong { color: var(--ink); font-size: 13px; }.section-heading span { color: #9099a5; margin-top: 3px; font-size: 10px; }.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }.field.wide { grid-column: 1 / -1; }.secret-input { display: grid; grid-template-columns: 1fr 42px; border: 1px solid #d9dde3; border-radius: 6px; }.secret-input:focus-within { border-color: var(--green); box-shadow: 0 0 0 3px rgba(18,168,90,.1); }.secret-input input { border: 0; box-shadow: none; }.secret-input button { min-height: 36px; padding: 0; }.model-assignments { padding: 0; overflow: hidden; }.assignment-row { display: grid; grid-template-columns: 42px minmax(180px, 1fr) minmax(220px, .8fr); align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--line); }.assignment-row:last-child { border-bottom: 0; }.assignment-row strong, .assignment-row small { display: block; }.assignment-row strong { font-size: 12px; }.assignment-row small { color: var(--muted); margin-top: 3px; font-size: 10px; }.assignment-row input { border: 1px solid #d9dde3; border-radius: 6px; padding: 9px 10px; min-width: 0; }.assignment-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 7px; }.assignment-icon.chat { color: #09894a; background: #e4f6eb; }.assignment-icon.game { color: #c64c68; background: #fbe9ed; }.assignment-icon.service { color: #357ba8; background: #e8f2f8; }.assignment-icon.pdf { color: #a66a00; background: #fcf1d8; }.assignment-icon.embed { color: #6b5bb6; background: #efedfa; }
.assignment-icon.notes { color: #357ba8; background: #e8f2f8; }
.choice-grid, .theme-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }.choice-grid button, .theme-grid button { border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--ink); padding: 15px; display: grid; gap: 7px; text-align: left; }.choice-grid button.active, .theme-grid button.active { border-color: var(--green); background: #edfaf2; }.choice-grid button > svg { color: #66717f; }.choice-grid button.active > svg { color: var(--green); }.choice-grid small { color: var(--muted); font-size: 10px; }.prompt-list { display: grid; gap: 18px; }.prompt-list textarea { resize: vertical; min-height: 74px; }.prompt-list label { display: flex; justify-content: space-between; }.prompt-list label span { color: #9aa1aa; font-weight: 400; }.theme-grid button { grid-template-columns: 42px 1fr 18px; align-items: center; }.theme-preview { width: 38px; height: 28px; border: 1px solid #d9dde3; border-radius: 5px; background: #fff; }.theme-preview.dark { background: #202630; }.theme-preview.system { background: linear-gradient(90deg,#fff 50%,#202630 50%); }.theme-grid svg { color: var(--green); }.sliders { display: grid; gap: 25px; }.sliders > label:not(.toggle-row) { display: grid; grid-template-columns: 1fr auto; gap: 10px; font-size: 12px; }.sliders input[type='range'] { grid-column: 1 / -1; accent-color: var(--green); }.sliders output { color: var(--muted); }.toggle-row { display: flex; justify-content: space-between; align-items: center; }.toggle-row strong, .toggle-row small { display: block; }.toggle-row small { color: var(--muted); margin-top: 4px; font-size: 10px; }.toggle-row input { width: 18px; height: 18px; accent-color: var(--green); }.action-list { padding: 0; overflow: hidden; }.action-list > button { width: 100%; border: 0; border-bottom: 1px solid var(--line); background: #fff; display: grid; grid-template-columns: 40px 1fr 20px; align-items: center; gap: 12px; padding: 16px 18px; text-align: left; }.action-list > button:last-of-type { border-bottom: 0; }.action-list > button:hover { background: #fafbfb; }.action-list > button > span { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 7px; color: var(--green); background: var(--green-soft); }.action-list strong, .action-list small { display: block; }.action-list strong { font-size: 12px; }.action-list small { color: var(--muted); margin-top: 4px; font-size: 10px; }.action-list > svg { color: #adb4bd; }.action-list .danger-action > span { color: #c34242; background: #fbeaea; }.about-panel { display: grid; grid-template-columns: 58px 1fr; gap: 14px; align-items: center; }.about-logo { display: block; width: 54px; height: 54px; }.about-panel h3 { margin: 0 0 4px; font-size: 16px; }.about-panel p { margin: 0; color: var(--muted); font-size: 11px; }.about-panel dl { grid-column: 1 / -1; margin: 14px 0 0; border-top: 1px solid var(--line); }.about-panel dl > div { display: flex; justify-content: space-between; gap: 20px; padding: 12px 0; border-bottom: 1px solid var(--line); font-size: 11px; }.about-panel dt { color: var(--muted); }.about-panel dd { margin: 0; display: flex; align-items: center; gap: 5px; }.settings-actions { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 10px; margin: 22px -36px -92px; padding: 13px 36px; border-top: 1px solid var(--line); background: rgba(255,255,255,.97); z-index: 5; }.notice { margin-top: 12px; }.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
.about-panel dd { min-width: 0; justify-content: flex-end; text-align: right; overflow-wrap: anywhere; }
.about-link { min-width: 0; display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; color: var(--green-dark); text-decoration: none; overflow-wrap: anywhere; }
.about-link:hover { text-decoration: underline; }
.about-link:focus-visible { outline: 3px solid color-mix(in srgb, var(--green) 30%, transparent); outline-offset: 3px; border-radius: 3px; }
.about-link svg { flex: 0 0 auto; }
.settings-page { background: var(--surface); color: var(--ink); }
.settings-nav { background: var(--canvas); }
.settings-title strong { font-size: 16px; }
.settings-title small, .settings-nav-item small { color: var(--muted); font-size: 10px; }
.settings-nav-item { color: var(--muted); }
.settings-nav-item:hover { background: var(--hover); }
.settings-nav-item.active { color: var(--ink); border-color: #77bb91; background: var(--green-soft); }
.nav-icon { background: var(--hover); }
.active .nav-icon { background: var(--green-soft); }
.settings-nav-item strong { font-size: 13px; }
.settings-header h2 { font-size: 22px; }
.settings-header p { font-size: 13px; }
.local-tag { color: var(--muted); font-size: 11px; }
.provider-option { background: var(--control); color: var(--ink); }
.provider-option:hover { background: var(--subtle); }
.provider-option.active { background: var(--green-soft); }
.provider-logo { background: var(--hover); }
.provider-option.active .provider-logo { color: var(--green); background: var(--green-soft); }
.provider-option strong { font-size: 12px; }
.provider-option small { color: var(--muted); font-size: 10px; }
.section-heading { color: var(--muted); }
.section-heading strong { font-size: 14px; }
.section-heading span { color: var(--muted); font-size: 11px; }
.secret-input, .assignment-row input { border-color: var(--line); }
.assignment-row input { color: var(--ink); background: var(--control); }
.assignment-row strong { font-size: 13px; }
.assignment-row small { font-size: 11px; }
.choice-grid button, .theme-grid button, .action-list > button { background: var(--control); color: var(--ink); }
.choice-grid button.active, .theme-grid button.active { background: var(--green-soft); }
.choice-grid small, .action-list small, .toggle-row small { font-size: 11px; }
.action-list > button:hover { background: var(--subtle); }
.settings-actions { background: color-mix(in srgb, var(--surface) 96%, transparent); }
.sliders input[type='range'] { appearance: none; height: 5px; border-radius: 5px; }
.sliders input[type='range']::-webkit-slider-thumb { appearance: none; width: 17px; height: 17px; border: 2px solid var(--surface); border-radius: 50%; background: var(--green); box-shadow: 0 0 0 1px var(--green); }
.toggle-row input { appearance: none; position: relative; width: 38px; height: 22px; border: 1px solid var(--line); border-radius: 11px; background: var(--hover); transition: .18s ease; }
.toggle-row input::before { content: ''; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 4px rgba(0,0,0,.2); transition: transform .18s ease; }
.toggle-row input:checked { border-color: var(--green); background: var(--green); }
.toggle-row input:checked::before { transform: translateX(16px); }
@media (max-width: 1050px) { .provider-grid { grid-template-columns: repeat(2, 1fr); }.settings-content { padding-inline: 24px; }.settings-actions { margin-inline: -24px; padding-inline: 24px; }.model-profile-row { grid-template-columns: 38px minmax(160px, 1fr) auto; }.profile-status { display: none; } }
@media (max-width: 760px) { .settings-page { display: block; }.settings-nav { display: flex; gap: 6px; padding: 10px; border-right: 0; border-bottom: 1px solid var(--line); overflow-x: auto; }.settings-title { display: none; }.settings-nav-item { flex: 0 0 auto; width: auto; grid-template-columns: 30px auto; padding: 6px 9px; margin: 0; }.settings-nav-item > svg, .settings-nav-item small { display: none; }.settings-content { padding: 20px 14px 92px; }.settings-header { flex-wrap: wrap; }.settings-header-actions { width: 100%; justify-content: space-between; }.provider-grid, .form-grid, .choice-grid, .theme-grid { grid-template-columns: 1fr; }.field.wide { grid-column: auto; }.profile-empty { grid-template-columns: 30px 1fr; }.profile-empty button { grid-column: 1 / -1; min-height: 42px; }.model-profile-row { grid-template-columns: 34px minmax(0, 1fr); gap: 9px; }.profile-main small { display: none; }.profile-actions { grid-column: 1 / -1; justify-content: flex-end; padding-top: 2px; }.profile-actions .icon-btn { min-height: 40px; }.profile-use { min-height: 40px; }.model-editor-heading { align-items: flex-start; }.model-editor-heading > span { display: none; }.assignment-row { grid-template-columns: 38px 1fr; }.assignment-row input { grid-column: 1 / -1; }.settings-actions { bottom: 0; margin-inline: -14px; padding: 10px 14px; } }
@media (max-width: 480px) { .about-panel dl > div { align-items: flex-start; flex-direction: column; gap: 5px; }.about-panel dd, .about-link { justify-content: flex-start; text-align: left; } }
</style>
