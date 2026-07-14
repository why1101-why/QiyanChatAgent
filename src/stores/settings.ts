import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ModelConfig, ModelConfigState, ModelProfile, ModelProfilesBackup, ModelPurpose } from '@/types'

const LEGACY_STORAGE_KEY = 'chat-agent:model-config:v1'
const STORAGE_KEY = 'qiyan:model-settings:v2'
const isDesktop = Boolean(window.desktopAPI)

type SecretScope = Pick<ModelConfig, 'provider' | 'baseUrl' | 'authMode' | 'apiKeyHeader'>

export function normalizeBaseUrl(value: string) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function normalizeHeader(value: string) {
  return String(value || '').trim().toLowerCase()
}

export function sameSecretScope(left: SecretScope, right: SecretScope) {
  return left.provider === right.provider &&
    normalizeBaseUrl(left.baseUrl) === normalizeBaseUrl(right.baseUrl) &&
    left.authMode === right.authMode &&
    normalizeHeader(left.apiKeyHeader) === normalizeHeader(right.apiKeyHeader)
}

export function needsApiKey(config: Pick<ModelConfig, 'provider' | 'authMode'>) {
  return config.provider !== 'ollama' && (config.provider !== 'openai-compatible' || config.authMode !== 'none')
}

export function connectionFingerprint(config: ModelConfig) {
  return JSON.stringify([
    config.provider,
    config.providerName,
    normalizeBaseUrl(config.baseUrl),
    config.authMode,
    normalizeHeader(config.apiKeyHeader),
    config.chatModel,
    config.gameModel,
    config.serviceModel,
    config.pdfModel,
    config.embeddingModel,
    config.tokenParameter
  ])
}

const defaults: ModelConfig = {
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
  temperature: 0.7,
  maxTokens: 2048,
  timeoutSeconds: 60,
  tokenParameter: 'auto',
  authMode: 'bearer',
  apiKeyHeader: 'X-API-Key',
  historyLimit: 20,
  contextCharLimit: 24000,
  safetyMode: 'confirm-write',
  globalPrompt: '',
  chatPrompt: '',
  gamePrompt: '',
  servicePrompt: '',
  pdfPrompt: '',
  theme: 'light',
  uiScale: 100,
  fontSize: 14,
  compactSidebar: false,
  lastTestedAt: '',
  lastTestedFingerprint: ''
}

function normalizeConfig(value: Partial<ModelConfig> = {}): ModelConfig {
  const config = { ...defaults, ...value }
  config.baseUrl = normalizeBaseUrl(config.baseUrl)
  config.apiKey = String(config.apiKey || '').trim()
  config.apiKeyHeader = String(config.apiKeyHeader || 'X-API-Key').trim() || 'X-API-Key'
  if (config.providerName === 'OpenAI Compatible' && config.baseUrl.includes('api.openai.com')) config.providerName = 'OpenAI'
  return config
}

function withoutSecret(value: Partial<ModelConfig>) {
  return normalizeConfig({ ...value, apiKey: '' })
}

function defaultProfileName(config: ModelConfig) {
  return [config.providerName, config.chatModel].filter(Boolean).join(' · ') || '未命名模型'
}

function profileFromConfig(config: ModelConfig, hasApiKey: boolean): ModelProfile {
  return {
    id: config.profileId,
    name: config.profileName || defaultProfileName(config),
    provider: config.provider,
    providerName: config.providerName,
    baseUrl: config.baseUrl,
    chatModel: config.chatModel,
    gameModel: config.gameModel,
    serviceModel: config.serviceModel,
    pdfModel: config.pdfModel,
    embeddingModel: config.embeddingModel,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutSeconds: config.timeoutSeconds,
    tokenParameter: config.tokenParameter,
    authMode: config.authMode,
    apiKeyHeader: config.apiKeyHeader,
    lastTestedAt: config.lastTestedAt,
    lastTestedFingerprint: config.lastTestedFingerprint,
    hasApiKey
  }
}

function preferenceFields(config: ModelConfig): Partial<ModelConfig> {
  return {
    historyLimit: config.historyLimit,
    contextCharLimit: config.contextCharLimit,
    safetyMode: config.safetyMode,
    globalPrompt: config.globalPrompt,
    chatPrompt: config.chatPrompt,
    gamePrompt: config.gamePrompt,
    servicePrompt: config.servicePrompt,
    pdfPrompt: config.pdfPrompt,
    theme: config.theme,
    uiScale: config.uiScale,
    fontSize: config.fontSize,
    compactSidebar: config.compactSidebar
  }
}

export function configForProfile(profile: ModelProfile, preferences: ModelConfig): ModelConfig {
  return normalizeConfig({
    ...preferenceFields(preferences),
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    providerName: profile.providerName,
    baseUrl: profile.baseUrl,
    apiKey: '',
    chatModel: profile.chatModel,
    gameModel: profile.gameModel,
    serviceModel: profile.serviceModel,
    pdfModel: profile.pdfModel,
    embeddingModel: profile.embeddingModel,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    timeoutSeconds: profile.timeoutSeconds,
    tokenParameter: profile.tokenParameter,
    authMode: profile.authMode,
    apiKeyHeader: profile.apiKeyHeader,
    lastTestedAt: profile.lastTestedAt,
    lastTestedFingerprint: profile.lastTestedFingerprint
  })
}

type BrowserState = {
  activeProfileId: string
  config: ModelConfig
  savedConfigs: ModelConfig[]
}

function persistLoadedBrowserState(state: BrowserState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 2,
    activeProfileId: state.activeProfileId,
    config: withoutSecret(state.config),
    savedConfigs: state.savedConfigs.map(withoutSecret)
  }))
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

function loadBrowserState(): BrowserState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const savedConfigs = Array.isArray(parsed.savedConfigs)
        ? parsed.savedConfigs
            .map((item: Partial<ModelConfig>) => withoutSecret(item))
            .filter((item: ModelConfig) => item.profileId && item.chatModel)
        : []
      const parsedConfig = withoutSecret(parsed.config)
      const active = savedConfigs.find((item: ModelConfig) => item.profileId === parsed.activeProfileId) || savedConfigs[0]
      const state = {
        activeProfileId: active?.profileId || '',
        config: active
          ? withoutSecret({ ...active, ...preferenceFields(parsedConfig) })
          : parsedConfig,
        savedConfigs
      }
      persistLoadedBrowserState(state)
      return state
    }

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
    const legacy = legacyRaw ? withoutSecret(JSON.parse(legacyRaw)) : normalizeConfig()
    const state = !legacy.chatModel
      ? { activeProfileId: '', config: legacy, savedConfigs: [] }
      : {
          activeProfileId: 'legacy-browser',
          config: withoutSecret({ ...legacy, profileId: 'legacy-browser', profileName: defaultProfileName(legacy) }),
          savedConfigs: [withoutSecret({ ...legacy, profileId: 'legacy-browser', profileName: defaultProfileName(legacy) })]
        }
    persistLoadedBrowserState(state)
    return state
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return { activeProfileId: '', config: normalizeConfig(), savedConfigs: [] }
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const browserState = isDesktop
    ? { activeProfileId: '', config: normalizeConfig(), savedConfigs: [] }
    : loadBrowserState()
  const config = ref<ModelConfig>(browserState.config)
  const browserConfigs = ref<ModelConfig[]>(browserState.savedConfigs)
  const browserSecrets = new Map<string, string>()
  const profiles = ref<ModelProfile[]>(browserState.savedConfigs.map(item => profileFromConfig(item, false)))
  const activeProfileId = ref(browserState.activeProfileId)
  const testedAt = ref<number | null>(null)
  const hasStoredApiKey = ref(false)
  const initialized = ref(!isDesktop)
  const isConfigured = computed(() => Boolean(config.value.baseUrl && config.value.chatModel && (!needsApiKey(config.value) || config.value.apiKey || hasStoredApiKey.value)))
  const currentFingerprint = computed(() => connectionFingerprint(config.value))
  const isVerified = computed(() => isConfigured.value && config.value.lastTestedFingerprint === currentFingerprint.value)

  function applyAppearance(value: ModelConfig) {
    const root = document.documentElement
    root.dataset.theme = value.theme
    root.dataset.compactSidebar = String(value.compactSidebar)
    root.style.setProperty('--ui-scale', String(value.uiScale / 100))
    root.style.setProperty('--base-font-size', `${value.fontSize}px`)
    document.body.style.zoom = `${value.uiScale}%`
  }

  function applyDesktopState(state: ModelConfigState) {
    config.value = normalizeConfig({ ...state.config, apiKey: '' })
    profiles.value = state.profiles.map(profile => ({ ...profile, baseUrl: normalizeBaseUrl(profile.baseUrl) }))
    activeProfileId.value = state.activeProfileId
    hasStoredApiKey.value = state.hasApiKey
  }

  function sessionSecretFor(candidate: SecretScope & { profileId: string }) {
    const stored = browserConfigs.value.find(item => item.profileId === candidate.profileId)
    return stored && sameSecretScope(stored, candidate) ? browserSecrets.get(candidate.profileId) || '' : ''
  }

  function syncBrowserProfiles() {
    profiles.value = browserConfigs.value.map(item => profileFromConfig(item, Boolean(sessionSecretFor(item))))
    hasStoredApiKey.value = Boolean(config.value.apiKey || (config.value.profileId && sessionSecretFor(config.value)))
  }

  function persistBrowserState() {
    if (isDesktop) return
    persistLoadedBrowserState({
      activeProfileId: activeProfileId.value,
      config: config.value,
      savedConfigs: browserConfigs.value
    })
  }

  watch(config, value => {
    applyAppearance(value)
    persistBrowserState()
  }, { deep: true })

  watch([browserConfigs, activeProfileId], persistBrowserState, { deep: true })

  async function initialize() {
    if (initialized.value) return
    const stored = await window.desktopAPI?.loadModelConfig()
    if (stored) applyDesktopState(stored)
    applyAppearance(config.value)
    initialized.value = true
  }

  async function replace(next: ModelConfig) {
    if (window.desktopAPI) {
      applyDesktopState(await window.desktopAPI.saveModelConfig(next))
      return
    }

    const normalized = normalizeConfig(next)
    if (normalized.chatModel) {
      normalized.profileId ||= crypto.randomUUID()
      normalized.profileName ||= defaultProfileName(normalized)
      const index = browserConfigs.value.findIndex(item => item.profileId === normalized.profileId)
      const existing = index >= 0 ? browserConfigs.value[index] : undefined
      const retainedSecret = !normalized.apiKey && existing && sameSecretScope(existing, normalized)
        ? browserSecrets.get(normalized.profileId) || ''
        : ''
      const sessionSecret = normalized.apiKey || retainedSecret
      if (needsApiKey(normalized) && !sessionSecret) throw new Error('请填写 API Key。')
      if (needsApiKey(normalized) && sessionSecret) browserSecrets.set(normalized.profileId, sessionSecret)
      else browserSecrets.delete(normalized.profileId)
      normalized.apiKey = sessionSecret

      const stored = withoutSecret(normalized)
      if (index >= 0) browserConfigs.value[index] = stored
      else browserConfigs.value.push(stored)
      activeProfileId.value = normalized.profileId
    }
    config.value = normalized
    syncBrowserProfiles()
  }

  async function activateProfile(profileId: string) {
    if (window.desktopAPI) {
      applyDesktopState(await window.desktopAPI.activateModelProfile(profileId))
      return
    }
    const selected = browserConfigs.value.find(item => item.profileId === profileId)
    if (!selected) throw new Error('模型配置不存在或已被删除。')
    config.value = normalizeConfig({
      ...selected,
      ...preferenceFields(config.value),
      apiKey: sessionSecretFor(selected)
    })
    activeProfileId.value = profileId
    syncBrowserProfiles()
  }

  async function deleteProfile(profileId: string) {
    if (window.desktopAPI) {
      applyDesktopState(await window.desktopAPI.deleteModelProfile(profileId))
      return
    }
    browserSecrets.delete(profileId)
    browserConfigs.value = browserConfigs.value.filter(item => item.profileId !== profileId)
    if (activeProfileId.value === profileId) {
      const next = browserConfigs.value[0]
      activeProfileId.value = next?.profileId || ''
      config.value = next
        ? normalizeConfig({ ...next, ...preferenceFields(config.value), apiKey: sessionSecretFor(next) })
        : normalizeConfig(preferenceFields(config.value))
    }
    syncBrowserProfiles()
  }

  async function importProfiles(payload: ModelProfilesBackup) {
    if (window.desktopAPI) {
      applyDesktopState(await window.desktopAPI.importModelProfiles(payload))
      return
    }
    if (payload.version !== 3 || !Array.isArray(payload.profiles)) throw new Error('模型列表备份结构无效。')

    const preferences = normalizeConfig(payload.config || {})
    const seenIds = new Set<string>()
    const importedConfigs = payload.profiles.map((candidate, index) => {
      let profileId = String(candidate.id || '').trim().slice(0, 120) || crypto.randomUUID()
      if (seenIds.has(profileId)) profileId = crypto.randomUUID()
      seenIds.add(profileId)
      const imported = withoutSecret({
        ...preferences,
        ...candidate,
        profileId,
        profileName: String(candidate.name || '').trim(),
        lastTestedAt: '',
        lastTestedFingerprint: ''
      })
      imported.profileName ||= defaultProfileName(imported)
      if (!imported.baseUrl || !imported.chatModel) throw new Error(`第 ${index + 1} 个模型配置缺少 Base URL 或聊天模型。`)
      return imported
    })

    browserSecrets.clear()
    browserConfigs.value = importedConfigs
    const requestedActiveId = String(payload.activeProfileId || '')
    const active = importedConfigs.find(item => item.profileId === requestedActiveId) || importedConfigs[0]
    activeProfileId.value = active?.profileId || ''
    config.value = active
      ? normalizeConfig({ ...active, ...preferenceFields(preferences), apiKey: '' })
      : normalizeConfig(preferenceFields(preferences))
    syncBrowserProfiles()
    persistBrowserState()
  }

  function resolveForRequest(candidate: ModelConfig) {
    if (isDesktop || candidate.apiKey || !candidate.profileId) return candidate
    return { ...candidate, apiKey: sessionSecretFor(candidate) }
  }

  function modelFor(purpose: ModelPurpose) {
    const field = `${purpose}Model` as 'chatModel' | 'gameModel' | 'serviceModel' | 'pdfModel'
    return config.value[field] || config.value.chatModel
  }

  function promptFor(purpose: ModelPurpose, fallback: string) {
    const field = `${purpose}Prompt` as 'chatPrompt' | 'gamePrompt' | 'servicePrompt' | 'pdfPrompt'
    return [fallback, config.value.globalPrompt, config.value[field]].filter(Boolean).join('\n\n')
  }

  function resetLocalPreferences() {
    config.value = {
      ...defaults,
      ...profileFields(config.value),
      apiKey: config.value.apiKey
    }
  }

  function profileFields(value: ModelConfig): Partial<ModelConfig> {
    return {
      profileId: value.profileId,
      profileName: value.profileName,
      provider: value.provider,
      providerName: value.providerName,
      baseUrl: value.baseUrl,
      chatModel: value.chatModel,
      gameModel: value.gameModel,
      serviceModel: value.serviceModel,
      pdfModel: value.pdfModel,
      embeddingModel: value.embeddingModel,
      temperature: value.temperature,
      maxTokens: value.maxTokens,
      timeoutSeconds: value.timeoutSeconds,
      tokenParameter: value.tokenParameter,
      authMode: value.authMode,
      apiKeyHeader: value.apiKeyHeader,
      lastTestedAt: value.lastTestedAt,
      lastTestedFingerprint: value.lastTestedFingerprint
    }
  }

  applyAppearance(config.value)

  return {
    config,
    profiles,
    activeProfileId,
    testedAt,
    hasStoredApiKey,
    initialized,
    isConfigured,
    isVerified,
    initialize,
    replace,
    activateProfile,
    deleteProfile,
    importProfiles,
    resolveForRequest,
    modelFor,
    promptFor,
    resetLocalPreferences
  }
})
