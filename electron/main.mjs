import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { prepareProviderMessages } from './multimodal.mjs'

const currentDir = dirname(fileURLToPath(import.meta.url))
const activeRequests = new Map()
const smokeMode = process.argv.includes('--smoke-test')
const capturePath = process.argv.find(argument => argument.startsWith('--capture='))?.slice('--capture='.length)
const contractSmokeUrl = process.argv.find(argument => argument.startsWith('--contract-smoke-url='))?.slice('--contract-smoke-url='.length)
const profileSmokePath = process.argv.find(argument => argument.startsWith('--profile-smoke-path='))?.slice('--profile-smoke-path='.length)
if (profileSmokePath) app.setPath('userData', profileSmokePath)
const automationMode = smokeMode || Boolean(capturePath) || Boolean(contractSmokeUrl) || Boolean(profileSmokePath)
const CONFIG_SCHEMA_VERSION = 2
const hasSingleInstanceLock = automationMode || app.requestSingleInstanceLock()
let configMutationQueue = Promise.resolve()

if (!hasSingleInstanceLock) app.quit()
if (hasSingleInstanceLock && !automationMode) {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f6f7f9',
    title: '栖言 Qiyan',
    icon: join(currentDir, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  window.once('ready-to-show', () => { if (!automationMode) window.show() })
  if (automationMode) {
    window.webContents.once('did-finish-load', async () => {
      try {
        const renderer = await window.webContents.executeJavaScript(`({
          title: document.title,
          desktopBridge: window.desktopAPI?.isDesktop === true,
          hasFourFeatures: ['AI 聊天', '灵感笔记', '哄哄模拟器', 'ChatPDF'].every(label => document.body.innerText.includes(label))
        })`)
        let contract = null
        if (contractSmokeUrl) {
          const candidate = {
            provider: 'openai-compatible', providerName: 'Contract Mock', baseUrl: contractSmokeUrl,
            apiKey: 'test-key', authMode: 'bearer', apiKeyHeader: 'X-API-Key', chatModel: 'mock-chat',
            embeddingModel: 'mock-embedding', temperature: 0.2, maxTokens: 64, timeoutSeconds: 10,
            tokenParameter: 'max_tokens'
          }
          const models = await listModels(candidate)
          let reply = ''
          await streamOpenAI(candidate, [{ role: 'user', content: '你好' }], token => reply += token, new AbortController().signal)
          let multimodalReply = ''
          await streamOpenAI(candidate, [{
            role: 'user',
            content: '识别附件',
            attachments: [
              { id: 'smoke-image', name: 'smoke.png', kind: 'image', mimeType: 'image/png', size: 5, dataUrl: `data:image/png;base64,${Buffer.from('image').toString('base64')}` },
              { id: 'smoke-audio', name: 'smoke.mp3', kind: 'audio', mimeType: 'audio/mpeg', size: 5, dataUrl: `data:audio/mpeg;base64,${Buffer.from('audio').toString('base64')}` }
            ]
          }], token => multimodalReply += token, new AbortController().signal)
          const vectors = await embedTexts(candidate, ['测试'])
          contract = { models, reply, multimodalReply, embeddingDimensions: vectors[0]?.length || 0 }
          console.log(`CHATAGENT_CONTRACT=${JSON.stringify(contract)}`)
        }
        const profileContract = profileSmokePath ? await runProfileConfigSmoke() : null
        if (profileContract) console.log(`QIYAN_PROFILE_CONTRACT=${JSON.stringify(profileContract)}`)
        if (capturePath) {
          const image = await window.webContents.capturePage()
          await writeFile(capturePath, image.toPNG())
          console.log(`CHATAGENT_CAPTURE=${capturePath}`)
        }
        console.log(`CHATAGENT_SMOKE=${JSON.stringify({ ...renderer, encryptionAvailable: safeStorage.isEncryptionAvailable() })}`)
        const contractOk = !contractSmokeUrl || (contract?.models?.includes('mock-chat') && contract.reply === '你好' && contract.multimodalReply === '附件识别成功' && contract.embeddingDimensions === 3)
        const profileContractOk = !profileContract || (profileContract.migratedProfiles === 1 && profileContract.afterAdd === 2 && profileContract.afterDelete === 1 && profileContract.keysIsolated && profileContract.encryptedAtRest && profileContract.publicSecretsHidden && profileContract.concurrentSavesSerialized && profileContract.futureSchemaRejected)
        app.exit(renderer.desktopBridge && renderer.hasFourFeatures && contractOk && profileContractOk ? 0 : 2)
      } catch (error) {
        console.error('CHATAGENT_SMOKE_ERROR', error)
        app.exit(3)
      }
    })
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (!devUrl && url.startsWith('file:')) return
    event.preventDefault()
  })

  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL)
  else window.loadFile(join(currentDir, '..', 'dist', 'index.html'))
}

function configPath() {
  return join(app.getPath('userData'), 'model-config.json')
}

async function readStoredConfig() {
  let source
  try {
    source = await readFile(configPath(), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw storedConfigError(`无法读取模型配置文件（${error?.code || '未知文件错误'}）`, error)
  }

  let stored
  try {
    stored = JSON.parse(source)
  } catch (error) {
    throw storedConfigError('模型配置文件 JSON 已损坏，请恢复 model-config.json.bak 或手动修复', error)
  }
  assertStoredConfigEnvelope(stored)
  return stored
}

async function loadPublicConfig() {
  const stored = await readStoredConfig()
  if (!stored) return null
  return publicConfigState(normalizeConfigState(stored))
}

function clampNumber(value, minimum, maximum, fallback, integer = false) {
  const parsed = Number(value)
  const bounded = Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
  return integer ? Math.round(bounded) : bounded
}

function normalizeConfig(candidate = {}) {
  const providers = ['openai-compatible', 'anthropic', 'gemini', 'ollama']
  const authModes = ['bearer', 'api-key-header', 'none']
  const tokenParameters = ['auto', 'max_tokens', 'max_completion_tokens']
  const themes = ['light', 'dark', 'system']
  const safetyModes = ['read-only', 'confirm-write', 'full-access']
  const text = (value, maximum = 8000) => String(value || '').trim().slice(0, maximum)
  return {
    profileId: text(candidate.profileId, 120),
    profileName: text(candidate.profileName, 120),
    provider: providers.includes(candidate.provider) ? candidate.provider : 'openai-compatible',
    providerName: text(candidate.providerName, 80) || '自定义',
    baseUrl: text(candidate.baseUrl, 2048).replace(/\/+$/, ''),
    apiKey: text(candidate.apiKey, 4096),
    chatModel: text(candidate.chatModel, 240),
    gameModel: text(candidate.gameModel, 240),
    serviceModel: text(candidate.serviceModel, 240),
    pdfModel: text(candidate.pdfModel, 240),
    embeddingModel: text(candidate.embeddingModel, 240),
    temperature: clampNumber(candidate.temperature, 0, 2, 0.7),
    maxTokens: clampNumber(candidate.maxTokens, 64, 32768, 2048, true),
    timeoutSeconds: clampNumber(candidate.timeoutSeconds, 10, 600, 60, true),
    tokenParameter: tokenParameters.includes(candidate.tokenParameter) ? candidate.tokenParameter : 'auto',
    authMode: authModes.includes(candidate.authMode) ? candidate.authMode : 'bearer',
    apiKeyHeader: text(candidate.apiKeyHeader, 120) || 'X-API-Key',
    historyLimit: clampNumber(candidate.historyLimit, 2, 100, 20, true),
    contextCharLimit: clampNumber(candidate.contextCharLimit, 4000, 120000, 24000, true),
    safetyMode: safetyModes.includes(candidate.safetyMode) ? candidate.safetyMode : 'confirm-write',
    globalPrompt: text(candidate.globalPrompt, 2000),
    chatPrompt: text(candidate.chatPrompt),
    gamePrompt: text(candidate.gamePrompt),
    servicePrompt: text(candidate.servicePrompt),
    pdfPrompt: text(candidate.pdfPrompt),
    theme: themes.includes(candidate.theme) ? candidate.theme : 'light',
    uiScale: clampNumber(candidate.uiScale, 85, 115, 100, true),
    fontSize: clampNumber(candidate.fontSize, 12, 17, 14, true),
    compactSidebar: Boolean(candidate.compactSidebar),
    lastTestedAt: text(candidate.lastTestedAt, 80),
    lastTestedFingerprint: text(candidate.lastTestedFingerprint, 2000)
  }
}

const PROFILE_FIELDS = [
  'provider', 'providerName', 'baseUrl', 'chatModel', 'gameModel', 'serviceModel', 'pdfModel',
  'embeddingModel', 'temperature', 'maxTokens', 'timeoutSeconds', 'tokenParameter', 'authMode',
  'apiKeyHeader', 'lastTestedAt', 'lastTestedFingerprint'
]
const PREFERENCE_FIELDS = [
  'historyLimit', 'contextCharLimit', 'safetyMode', 'globalPrompt', 'chatPrompt', 'gamePrompt',
  'servicePrompt', 'pdfPrompt', 'theme', 'uiScale', 'fontSize', 'compactSidebar'
]

function pickFields(source, fields) {
  return Object.fromEntries(fields.map(field => [field, source[field]]))
}

function cleanProfileId(value) {
  const id = String(value || '').trim().slice(0, 120)
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : ''
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function storedConfigError(message, cause) {
  const error = new Error(`${message}。为保护现有配置，栖言已停止写入。`)
  error.code = 'QIYAN_CONFIG_STORAGE_ERROR'
  if (cause) error.cause = cause
  return error
}

function assertStoredSchemaV2(raw) {
  if (!isRecord(raw) || raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw storedConfigError('模型配置 schema 2 根结构无效')
  }
  if (!Array.isArray(raw.profiles) || !isRecord(raw.preferences) || typeof raw.activeProfileId !== 'string') {
    throw storedConfigError('模型配置 schema 2 结构已损坏（profiles、preferences 或 activeProfileId 无效）')
  }

  const profileIds = new Set()
  raw.profiles.forEach((profile, index) => {
    const id = typeof profile?.id === 'string' ? cleanProfileId(profile.id) : ''
    const hasValidShape = isRecord(profile)
      && id === profile.id
      && typeof profile.name === 'string'
      && typeof profile.provider === 'string'
      && typeof profile.baseUrl === 'string'
      && Boolean(profile.baseUrl.trim())
      && typeof profile.chatModel === 'string'
      && Boolean(profile.chatModel.trim())
      && typeof profile.encryptedApiKey === 'string'
    if (!hasValidShape || profileIds.has(id)) {
      throw storedConfigError(`模型配置 schema 2 的 profiles[${index}] 已损坏或 ID 重复`)
    }
    try {
      assertConfig(normalizeConfig({ ...profile, profileId: id, profileName: profile.name }))
    } catch (error) {
      throw storedConfigError(`模型配置 schema 2 的 profiles[${index}] 内容无效`, error)
    }
    profileIds.add(id)
  })

  if (raw.activeProfileId && !profileIds.has(raw.activeProfileId)) {
    throw storedConfigError('模型配置 schema 2 的 activeProfileId 指向不存在的配置')
  }
}

function assertStoredConfigEnvelope(raw) {
  if (!isRecord(raw)) throw storedConfigError('模型配置文件根结构无效')
  if (!Object.hasOwn(raw, 'schemaVersion')) return
  if (raw.schemaVersion === CONFIG_SCHEMA_VERSION) {
    assertStoredSchemaV2(raw)
    return
  }
  if (Number.isInteger(raw.schemaVersion) && raw.schemaVersion > CONFIG_SCHEMA_VERSION) {
    throw storedConfigError(`模型配置由更新版本创建（schema ${raw.schemaVersion}），当前版本仅支持 schema ${CONFIG_SCHEMA_VERSION}`)
  }
  throw storedConfigError(`不支持的模型配置 schema：${String(raw.schemaVersion)}`)
}

function defaultProfileName(config) {
  return [config.providerName, config.chatModel].filter(Boolean).join(' · ') || '未命名模型'
}

function storedProfileFromConfig(config, encryptedApiKey = '') {
  const id = cleanProfileId(config.profileId) || randomUUID()
  return {
    id,
    name: String(config.profileName || defaultProfileName(config)).trim().slice(0, 120),
    ...pickFields(config, PROFILE_FIELDS),
    encryptedApiKey: String(encryptedApiKey || '')
  }
}

function normalizeStoredProfile(candidate, index) {
  const normalized = normalizeConfig({
    ...candidate,
    profileId: candidate?.id,
    profileName: candidate?.name
  })
  normalized.profileId = cleanProfileId(normalized.profileId) || `profile-${index + 1}`
  return storedProfileFromConfig(normalized, candidate?.encryptedApiKey)
}

function normalizeConfigState(raw) {
  if (raw && Object.hasOwn(raw, 'schemaVersion')) {
    assertStoredConfigEnvelope(raw)
    const profiles = raw.profiles
      .map(normalizeStoredProfile)
    const activeProfileId = profiles.some(profile => profile.id === raw.activeProfileId)
      ? raw.activeProfileId
      : profiles[0]?.id || ''
    return {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      activeProfileId,
      preferences: pickFields(normalizeConfig(raw.preferences || {}), PREFERENCE_FIELDS),
      profiles
    }
  }

  const legacy = normalizeConfig(raw || {})
  const hasLegacyProfile = Boolean(raw && (legacy.chatModel || raw.encryptedApiKey))
  const profiles = hasLegacyProfile
    ? [storedProfileFromConfig({
        ...legacy,
        profileId: cleanProfileId(raw.profileId) || 'legacy-default',
        profileName: raw.profileName || defaultProfileName(legacy)
      }, raw.encryptedApiKey)]
    : []
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProfileId: profiles[0]?.id || '',
    preferences: pickFields(legacy, PREFERENCE_FIELDS),
    profiles
  }
}

function publicProfile(profile) {
  const { encryptedApiKey, ...safeProfile } = profile
  return { ...safeProfile, hasApiKey: Boolean(encryptedApiKey) }
}

function configFromProfile(profile, preferences) {
  return normalizeConfig({
    ...preferences,
    ...(profile ? pickFields(profile, PROFILE_FIELDS) : {}),
    profileId: profile?.id || '',
    profileName: profile?.name || '',
    apiKey: ''
  })
}

function publicConfigState(state) {
  const active = state.profiles.find(profile => profile.id === state.activeProfileId) || null
  return {
    config: configFromProfile(active, state.preferences),
    profiles: state.profiles.map(publicProfile),
    activeProfileId: active?.id || '',
    hasApiKey: Boolean(active?.encryptedApiKey)
  }
}

async function readStoredState() {
  return normalizeConfigState(await readStoredConfig())
}

async function writeStoredState(state) {
  assertStoredSchemaV2(state)
  const targetPath = configPath()
  const temporaryPath = `${targetPath}.${process.pid}-${randomUUID()}.tmp`
  const backupPath = `${targetPath}.bak`
  let committed = false
  let failure = null

  await mkdir(dirname(targetPath), { recursive: true })
  try {
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
    try {
      await copyFile(targetPath, backupPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await rename(temporaryPath, targetPath)
    committed = true
  } catch (error) {
    failure = error
  }

  if (!committed) {
    try {
      await unlink(temporaryPath)
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        throw new AggregateError(
          failure ? [failure, cleanupError] : [cleanupError],
          '模型配置写入失败，且临时文件无法清理。'
        )
      }
    }
  }
  if (failure) throw failure
}

function enqueueConfigMutation(operation) {
  const result = configMutationQueue.then(operation)
  configMutationQueue = result.then(() => undefined, () => undefined)
  return result
}

function sameSecretScope(profile, config) {
  return Boolean(profile &&
    profile.provider === config.provider &&
    profile.baseUrl === config.baseUrl &&
    profile.authMode === config.authMode &&
    String(profile.apiKeyHeader || '').trim().toLowerCase() === String(config.apiKeyHeader || '').trim().toLowerCase())
}

function saveModelConfig(candidate) {
  return enqueueConfigMutation(async () => {
    const normalized = normalizeConfig(candidate)
    assertConfig(normalized, true)
    const state = await readStoredState()
    state.preferences = pickFields(normalized, PREFERENCE_FIELDS)
    const shouldSaveProfile = Boolean(normalized.profileId || normalized.chatModel || normalized.apiKey)

    if (shouldSaveProfile) {
      assertConfig(normalized)
      const existing = state.profiles.find(profile => profile.id === cleanProfileId(normalized.profileId))
      const id = existing?.id || cleanProfileId(normalized.profileId) || randomUUID()
      const encryptedApiKey = normalized.apiKey
        ? encryptApiKey(normalized.apiKey)
        : sameSecretScope(existing, normalized) ? existing.encryptedApiKey : ''
      if (requiresApiKey(normalized) && !encryptedApiKey) throw new Error('请填写 API Key。')
      const nextProfile = storedProfileFromConfig({ ...normalized, profileId: id }, encryptedApiKey)
      const index = state.profiles.findIndex(profile => profile.id === id)
      if (index >= 0) state.profiles[index] = nextProfile
      else state.profiles.push(nextProfile)
      state.activeProfileId = id
    }

    await writeStoredState(state)
    return publicConfigState(state)
  })
}

function activateModelProfile(profileId) {
  return enqueueConfigMutation(async () => {
    const state = await readStoredState()
    const id = cleanProfileId(profileId)
    if (!state.profiles.some(profile => profile.id === id)) throw new Error('模型配置不存在或已被删除。')
    state.activeProfileId = id
    await writeStoredState(state)
    return publicConfigState(state)
  })
}

function deleteModelProfile(profileId) {
  return enqueueConfigMutation(async () => {
    const state = await readStoredState()
    const id = cleanProfileId(profileId)
    if (!state.profiles.some(profile => profile.id === id)) throw new Error('模型配置不存在或已被删除。')
    state.profiles = state.profiles.filter(profile => profile.id !== id)
    if (state.activeProfileId === id) state.activeProfileId = state.profiles[0]?.id || ''
    await writeStoredState(state)
    return publicConfigState(state)
  })
}

function importedProfileConfig(candidate, index) {
  if (!isRecord(candidate) || typeof candidate.id !== 'string' || cleanProfileId(candidate.id) !== candidate.id) {
    throw new Error(`备份中的 profiles[${index}] 缺少有效 ID。`)
  }
  const normalized = normalizeConfig({
    ...candidate,
    profileId: candidate.id,
    profileName: candidate.name,
    apiKey: ''
  })
  assertConfig(normalized)
  return normalized
}

function importModelProfiles(payload) {
  return enqueueConfigMutation(async () => {
    if (!isRecord(payload) || payload.version !== 3 || !Array.isArray(payload.profiles) || !isRecord(payload.config)) {
      throw new Error('仅支持结构完整的栖言 version 3 备份。')
    }
    if (typeof payload.activeProfileId !== 'string') throw new Error('备份中的 activeProfileId 无效。')

    const importedIds = new Set()
    const importedProfiles = payload.profiles.map((candidate, index) => {
      const normalized = importedProfileConfig(candidate, index)
      if (importedIds.has(normalized.profileId)) throw new Error(`备份中存在重复的模型配置 ID：${normalized.profileId}`)
      importedIds.add(normalized.profileId)
      return normalized
    })
    const activeProfileId = payload.activeProfileId ? cleanProfileId(payload.activeProfileId) : ''
    if (payload.activeProfileId && (!activeProfileId || !importedIds.has(activeProfileId))) {
      throw new Error('备份中的当前模型不在 profiles 列表中。')
    }

    const state = await readStoredState()
    const existingProfiles = new Map(state.profiles.map(profile => [profile.id, profile]))
    state.profiles = importedProfiles.map(imported => {
      const existing = existingProfiles.get(imported.profileId)
      const encryptedApiKey = sameSecretScope(existing, imported) ? existing.encryptedApiKey : ''
      return storedProfileFromConfig(imported, encryptedApiKey)
    })
    state.activeProfileId = activeProfileId || state.profiles[0]?.id || ''
    state.preferences = pickFields(normalizeConfig(payload.config), PREFERENCE_FIELDS)

    await writeStoredState(state)
    return publicConfigState(state)
  })
}

async function runProfileConfigSmoke() {
  const legacy = normalizeConfig({
    provider: 'openai-compatible',
    providerName: 'Legacy Mock',
    baseUrl: 'https://legacy.example/v1',
    chatModel: 'legacy-chat',
    authMode: 'bearer',
    apiKeyHeader: 'X-API-Key'
  })
  const { apiKey: _legacySecret, ...legacyPublic } = legacy
  await mkdir(dirname(configPath()), { recursive: true })
  await writeFile(configPath(), JSON.stringify({ ...legacyPublic, encryptedApiKey: encryptApiKey('legacy-secret') }, null, 2), { encoding: 'utf8', mode: 0o600 })

  const migrated = await loadPublicConfig()
  const legacyProfile = migrated.profiles[0]
  const legacyResolved = await resolveConfig(migrated.config)
  const added = await saveModelConfig({
    ...migrated.config,
    profileId: '',
    profileName: 'Second Mock',
    providerName: 'Second Mock',
    baseUrl: 'https://second.example/v1',
    chatModel: 'second-chat',
    apiKey: 'second-secret'
  })
  const secondProfile = added.profiles.find(profile => profile.name === 'Second Mock')
  const secondResolved = await resolveConfig(added.config)
  const activated = await activateModelProfile(legacyProfile.id)
  const reactivatedResolved = await resolveConfig(activated.config)
  const deleted = await deleteModelProfile(secondProfile.id)

  await Promise.all([
    saveModelConfig({
      ...migrated.config,
      profileId: 'concurrent-a',
      profileName: 'Concurrent A',
      providerName: 'Concurrent A',
      baseUrl: 'https://concurrent-a.example/v1',
      chatModel: 'concurrent-a-chat',
      apiKey: 'concurrent-a-secret'
    }),
    saveModelConfig({
      ...migrated.config,
      profileId: 'concurrent-b',
      profileName: 'Concurrent B',
      providerName: 'Concurrent B',
      baseUrl: 'https://concurrent-b.example/v1',
      chatModel: 'concurrent-b-chat',
      apiKey: 'concurrent-b-secret'
    })
  ])
  const afterConcurrent = await loadPublicConfig()
  const concurrentSavesSerialized = afterConcurrent.profiles.length === 3
    && afterConcurrent.profiles.some(profile => profile.id === 'concurrent-a')
    && afterConcurrent.profiles.some(profile => profile.id === 'concurrent-b')
  await Promise.all([
    deleteModelProfile('concurrent-a'),
    deleteModelProfile('concurrent-b')
  ])

  const stableConfigText = await readFile(configPath(), 'utf8')
  await writeFile(configPath(), JSON.stringify({ schemaVersion: 3, activeProfileId: '', preferences: {}, profiles: [] }, null, 2), { encoding: 'utf8', mode: 0o600 })
  let futureSchemaRejected = false
  try {
    await saveModelConfig(deleted.config)
  } catch (error) {
    const untouchedFutureConfig = JSON.parse(await readFile(configPath(), 'utf8'))
    futureSchemaRejected = /更新版本/.test(error instanceof Error ? error.message : '')
      && untouchedFutureConfig.schemaVersion === 3
  } finally {
    await writeFile(configPath(), stableConfigText, { encoding: 'utf8', mode: 0o600 })
  }
  const diskText = JSON.stringify(await readStoredConfig())

  return {
    migratedProfiles: migrated.profiles.length,
    afterAdd: added.profiles.length,
    afterDelete: deleted.profiles.length,
    activeName: deleted.config.profileName,
    keysIsolated: legacyResolved.apiKey === 'legacy-secret' && secondResolved.apiKey === 'second-secret' && reactivatedResolved.apiKey === 'legacy-secret',
    encryptedAtRest: !diskText.includes('legacy-secret') && !diskText.includes('second-secret') && !diskText.includes('concurrent-a-secret') && !diskText.includes('concurrent-b-secret'),
    publicSecretsHidden: migrated.config.apiKey === '' && migrated.profiles.every(profile => !('encryptedApiKey' in profile)),
    concurrentSavesSerialized,
    futureSchemaRejected
  }
}

function encryptApiKey(apiKey) {
  if (!apiKey) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法提供安全密钥存储，请检查 Windows 用户凭据服务。')
  return safeStorage.encryptString(apiKey).toString('base64')
}

function decryptApiKey(value) {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法解密 API Key。')
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

function assertConfig(config, allowIncomplete = false) {
  if (!config || typeof config !== 'object') throw new Error('模型配置无效。')
  if (!allowIncomplete && !config.baseUrl) throw new Error('Base URL 不能为空。')
  if (config.baseUrl) {
    const url = new URL(config.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 只允许 HTTP 或 HTTPS。')
    const isLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
    if (url.protocol === 'http:' && !isLoopback) throw new Error('远程模型端点必须使用 HTTPS。')
  }
  if (!allowIncomplete && !String(config.chatModel || '').trim()) throw new Error('聊天模型不能为空。')
  if (config.authMode === 'api-key-header' && !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(config.apiKeyHeader)) throw new Error('API Key Header 名称无效。')
}

function requiresApiKey(config) {
  return config.provider !== 'ollama' && (config.provider !== 'openai-compatible' || config.authMode !== 'none')
}

function timeoutSeconds(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(600, Math.max(10, parsed)) : 60
}

function requestScope(seconds, externalSignal) {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  if (externalSignal?.aborted) abort()
  else externalSignal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutSeconds(seconds) * 1000)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abort)
    }
  }
}

async function resolveConfig(candidate) {
  const config = normalizeConfig(candidate)
  assertConfig(config)
  const state = await readStoredState()
  const storedProfile = config.profileId
    ? state.profiles.find(profile => profile.id === config.profileId)
    : state.profiles.find(profile => profile.id === state.activeProfileId)
  const apiKey = config.apiKey || decryptApiKey(sameSecretScope(storedProfile, config) ? storedProfile?.encryptedApiKey || '' : '')
  if (requiresApiKey(config) && !apiKey) throw new Error('请填写 API Key。')
  return { ...config, apiKey }
}

function authHeaders(config) {
  if (config.authMode === 'none') return {}
  if (config.authMode === 'api-key-header') return { [String(config.apiKeyHeader || 'X-API-Key')]: config.apiKey }
  return { Authorization: `Bearer ${config.apiKey}` }
}

function endpoint(baseUrl, suffix) {
  const base = baseUrl.replace(/\/$/, '').replace(/\/chat\/completions$/, '')
  if (base.endsWith(suffix)) return base
  if (suffix === '/chat/completions' && base.endsWith('/v1')) return `${base}${suffix}`
  return `${base}${suffix}`
}

async function embedTexts(candidate, texts, externalSignal) {
  const config = await resolveConfig(candidate)
  const model = String(config.embeddingModel || '').trim()
  if (!model) throw new Error('请先配置 Embedding 模型。')
  if (!Array.isArray(texts) || !texts.length || texts.length > 32) throw new Error('单次 Embedding 数量必须为 1 到 32。')
  if (config.provider === 'anthropic') throw new Error('Anthropic 不提供 Embedding API，请改用关键词检索或其他供应商。')
  const scope = requestScope(config.timeoutSeconds, externalSignal)
  try {
    let response
    if (config.provider === 'ollama') {
      response = await fetch(endpoint(config.baseUrl, '/api/embed'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: texts }), signal: scope.signal })
    } else if (config.provider === 'gemini') {
      const requests = texts.map(text => ({ model: `models/${model}`, content: { parts: [{ text }] } }))
      response = await fetch(`${endpoint(config.baseUrl, `/models/${encodeURIComponent(model)}:batchEmbedContents`)}?key=${encodeURIComponent(config.apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }), signal: scope.signal })
    } else {
      response = await fetch(endpoint(config.baseUrl, '/embeddings'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(config) }, body: JSON.stringify({ model, input: texts, encoding_format: 'float' }), signal: scope.signal })
    }
    if (!response.ok) throw new Error(await parseError(response))
    const data = await response.json()
    const vectors = config.provider === 'ollama'
      ? data.embeddings
      : config.provider === 'gemini'
        ? data.embeddings?.map(item => item.values)
        : data.data?.sort((a, b) => a.index - b.index).map(item => item.embedding)
    if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error('Embedding 服务返回的向量数量不正确。')
    return vectors
  } catch (error) {
    if (scope.timedOut()) throw new Error(`Embedding 请求超过 ${timeoutSeconds(config.timeoutSeconds)} 秒，请检查模型或网络。`)
    if (externalSignal?.aborted) throw new Error('Embedding 请求已取消。')
    throw error
  } finally { scope.cleanup() }
}

function modelFor(config, purpose = 'chat') {
  const value = config[`${purpose}Model`]
  return String(value || config.chatModel || '').trim()
}

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || part?.content || '').join('')
  return content?.text || ''
}

function openAIText(data) {
  const choice = data?.choices?.[0]
  return textFromContent(choice?.delta?.content)
    || textFromContent(choice?.message?.content)
    || textFromContent(data?.output_text)
    || textFromContent(data?.delta)
}

function openAIReasoning(data) {
  const choice = data?.choices?.[0]
  return textFromContent(choice?.delta?.reasoning_content)
    || textFromContent(choice?.message?.reasoning_content)
    || ''
}

async function parseError(response) {
  const text = await response.text()
  try {
    const data = JSON.parse(text)
    return data.error?.message || data.message || `请求失败 (${response.status})`
  } catch { return text.slice(0, 240) || `请求失败 (${response.status})` }
}

async function listModels(candidate, externalSignal) {
  const config = await resolveConfig(candidate)
  const scope = requestScope(config.timeoutSeconds, externalSignal)
  try {
    const isOllama = config.provider === 'ollama'
    const isAnthropic = config.provider === 'anthropic'
    const isGemini = config.provider === 'gemini'
    const url = isOllama
      ? endpoint(config.baseUrl, '/api/tags')
      : isGemini
        ? `${endpoint(config.baseUrl, '/models')}?key=${encodeURIComponent(config.apiKey)}`
        : endpoint(config.baseUrl, isAnthropic ? '/v1/models' : '/models')
    const headers = isOllama || isGemini
      ? {}
      : isAnthropic
        ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
        : authHeaders(config)
    const response = await fetch(url, {
      headers,
      signal: scope.signal
    })
    if (!response.ok) throw new Error(await parseError(response))
    const data = await response.json()
    const models = isOllama
      ? data.models?.map(item => item.name)
      : isGemini
        ? data.models?.filter(item => item.supportedGenerationMethods?.includes('generateContent')).map(item => String(item.name).replace(/^models\//, ''))
        : data.data?.map(item => item.id)
    return [...new Set(models || [])].sort()
  } catch (error) {
    if (scope.timedOut()) throw new Error(`获取模型列表超过 ${timeoutSeconds(config.timeoutSeconds)} 秒。`)
    if (externalSignal?.aborted) throw new Error('获取模型列表已取消。')
    throw error
  } finally { scope.cleanup() }
}

async function streamOpenAI(config, messages, onToken, signal, options = {}) {
  const model = options.model || modelFor(config, options.purpose)
  const reasoningModel = /(?:^|[\/:_-])(o\d|gpt-5)/i.test(model)
  const tokenParameter = config.tokenParameter === 'auto'
    ? (reasoningModel ? 'max_completion_tokens' : 'max_tokens')
    : config.tokenParameter
  const payload = {
    model,
    messages: prepareProviderMessages('openai-compatible', messages),
    stream: true,
    [tokenParameter]: Number(options.maxTokens || config.maxTokens || 2048)
  }
  if (!reasoningModel) payload.temperature = Number(options.temperature ?? config.temperature ?? 0.7)
  if (options.responseFormat === 'json') payload.response_format = { type: 'json_object' }
  const sendRequest = () => fetch(endpoint(config.baseUrl, '/chat/completions'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(config) }, body: JSON.stringify(payload), signal
  })
  let response = await sendRequest()
  if (!response.ok) {
    const firstError = await parseError(response)
    let shouldRetry = false
    if (response.status === 400 && payload.response_format) {
      delete payload.response_format
      shouldRetry = true
    }
    if (response.status === 400 && config.tokenParameter === 'auto' && /max_tokens|max_completion_tokens/i.test(firstError)) {
      const alternate = tokenParameter === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
      delete payload[tokenParameter]
      payload[alternate] = Number(options.maxTokens || config.maxTokens || 2048)
      shouldRetry = true
    }
    if (!shouldRetry) throw new Error(firstError)
    response = await sendRequest()
    if (!response.ok) throw new Error(await parseError(response))
  }
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await response.json()
    const text = openAIText(data) || openAIReasoning(data)
    if (!text) throw new Error('模型返回成功，但回复内容为空。请更换模型或将兼容模式设为自动。')
    onToken(text)
    return
  }
  if (!response.body) throw new Error('模型服务没有返回数据流。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emitted = ''
  let reasoning = ''
  const consume = line => {
    const value = line.trim().replace(/^data:\s*/, '')
    if (!value || value === '[DONE]' || !value.startsWith('{')) return
    try {
      const data = JSON.parse(value)
      const text = openAIText(data)
      reasoning += openAIReasoning(data)
      if (text) { emitted += text; onToken(text) }
    } catch { /* heartbeat or partial event */ }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) consume(line)
  }
  if (buffer.trim()) consume(buffer)
  if (!emitted && reasoning) { emitted = reasoning; onToken(reasoning) }
  if (!emitted) throw new Error('模型连接成功，但没有产生可显示的回复。请检查模型名称与兼容模式。')
}

async function streamOllama(config, messages, onToken, signal, options = {}) {
  const response = await fetch(endpoint(config.baseUrl, '/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: options.model || modelFor(config, options.purpose), messages: prepareProviderMessages('ollama', messages), stream: true, format: options.responseFormat === 'json' ? 'json' : undefined, options: { temperature: Number(options.temperature ?? config.temperature), num_predict: Number(options.maxTokens || config.maxTokens) } }),
    signal
  })
  if (!response.ok) throw new Error(await parseError(response))
  if (!response.body) throw new Error('Ollama 没有返回数据流。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emitted = ''
  const consume = line => {
    if (!line.trim()) return
    try {
      const data = JSON.parse(line)
      const text = textFromContent(data.message?.content) || textFromContent(data.response)
      if (text) { emitted += text; onToken(text) }
    } catch { /* partial event */ }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) consume(line)
  }
  if (buffer.trim()) consume(buffer)
  if (!emitted) throw new Error('Ollama 未返回回复，请确认模型已下载且支持聊天。')
}

async function streamAnthropic(config, messages, onToken, signal, options = {}) {
  const preparedMessages = prepareProviderMessages('anthropic', messages)
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
  const chatMessages = preparedMessages.filter(message => message.role !== 'system')
  const response = await fetch(endpoint(config.baseUrl, '/v1/messages'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: options.model || modelFor(config, options.purpose), system, messages: chatMessages, max_tokens: Number(options.maxTokens || config.maxTokens), temperature: Math.min(1, Math.max(0, Number(options.temperature ?? config.temperature))), stream: true }),
    signal
  })
  if (!response.ok) throw new Error(await parseError(response))
  if (!response.body) throw new Error('Anthropic 没有返回数据流。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emitted = ''
  const consume = line => {
    const value = line.trim().replace(/^data:\s*/, '')
    if (!value.startsWith('{')) return
    try {
      const data = JSON.parse(value)
      const text = data.delta?.text || textFromContent(data.content)
      if (text) { emitted += text; onToken(text) }
    } catch { /* event metadata */ }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach(consume)
  }
  if (buffer.trim()) consume(buffer)
  if (!emitted) throw new Error('Anthropic 连接成功，但回复为空。')
}

async function streamGemini(config, messages, onToken, signal, options = {}) {
  const model = options.model || modelFor(config, options.purpose)
  const preparedMessages = prepareProviderMessages('gemini', messages)
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
  const contents = preparedMessages.filter(message => message.role !== 'system')
  const url = `${endpoint(config.baseUrl, `/models/${encodeURIComponent(model)}:streamGenerateContent`)}?alt=sse&key=${encodeURIComponent(config.apiKey)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { temperature: Number(options.temperature ?? config.temperature), maxOutputTokens: Number(options.maxTokens || config.maxTokens), responseMimeType: options.responseFormat === 'json' ? 'application/json' : 'text/plain' } }),
    signal
  })
  if (!response.ok) throw new Error(await parseError(response))
  if (!response.body) throw new Error('Gemini 没有返回数据流。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emitted = ''
  const consume = line => {
    const value = line.trim().replace(/^data:\s*/, '')
    if (!value.startsWith('{')) return
    try {
      const data = JSON.parse(value)
      const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || ''
      if (text) { emitted += text; onToken(text) }
    } catch { /* event metadata */ }
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach(consume)
  }
  if (buffer.trim()) consume(buffer)
  if (!emitted) throw new Error('Gemini 连接成功，但回复为空。')
}

function streamForProvider(provider) {
  if (provider === 'ollama') return streamOllama
  if (provider === 'anthropic') return streamAnthropic
  if (provider === 'gemini') return streamGemini
  return streamOpenAI
}

async function testModel(candidate) {
  const config = await resolveConfig(candidate)
  const controller = new AbortController()
  const startedAt = Date.now()
  const timer = setTimeout(() => controller.abort(), Math.min(Number(config.timeoutSeconds || 60), 60) * 1000)
  let preview = ''
  let models = []
  try {
    try { models = await listModels(candidate, controller.signal) } catch { /* Some compatible APIs do not expose /models. */ }
    const stream = streamForProvider(config.provider)
    const purposeModels = ['chat', 'game', 'service', 'pdf'].map(purpose => ({ purpose, model: modelFor(config, purpose) }))
    const uniqueModels = [...new Map(purposeModels.map(item => [item.model, item])).values()]
    for (const item of uniqueModels) {
      let reply = ''
      try {
        await stream(config, [
          { role: 'system', content: '只回复 OK。' },
          { role: 'user', content: '连接测试' }
        ], token => reply += token, controller.signal, { purpose: item.purpose, model: item.model, maxTokens: 32, temperature: 0 })
      } catch (error) {
        throw new Error(`模型 ${item.model} 测试失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
      if (!preview) preview = reply
    }
    let embeddingOk = false
    let embeddingError = ''
    if (candidate.embeddingModel) {
      try { await embedTexts(candidate, ['连接测试'], controller.signal); embeddingOk = true } catch (error) {
        if (controller.signal.aborted) throw error
        embeddingError = error instanceof Error ? error.message : 'Embedding 测试失败'
      }
    }
    return { models, preview: preview.slice(0, 80), latencyMs: Date.now() - startedAt, embeddingOk, embeddingError }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('连接测试超时，请检查地址、代理或模型状态。')
    throw error
  } finally { clearTimeout(timer) }
}

async function runStream(event, requestId, candidate, messages, options = {}) {
  const controller = new AbortController()
  activeRequests.set(requestId, controller)
  let timedOut = false
  const requestTimeout = timeoutSeconds(candidate?.timeoutSeconds)
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, requestTimeout * 1000)
  const emit = payload => {
    if (!event.sender.isDestroyed()) event.sender.send('model:stream-event', { requestId, ...payload })
  }
  try {
    const config = await resolveConfig(candidate)
    const stream = streamForProvider(config.provider)
    await stream(config, messages, token => emit({ type: 'token', token }), controller.signal, options)
    emit({ type: 'done' })
  } catch (error) {
    if (timedOut) emit({ type: 'error', message: `模型请求超过 ${requestTimeout} 秒，请检查模型速度或调高超时。` })
    else if (controller.signal.aborted) emit({ type: 'aborted' })
    else emit({ type: 'error', message: error instanceof Error ? error.message : '模型请求失败' })
  } finally { clearTimeout(timer); activeRequests.delete(requestId) }
}

ipcMain.handle('config:load', loadPublicConfig)
ipcMain.handle('config:save', (_event, candidate) => saveModelConfig(candidate))
ipcMain.handle('config:activate', (_event, profileId) => activateModelProfile(profileId))
ipcMain.handle('config:delete', (_event, profileId) => deleteModelProfile(profileId))
ipcMain.handle('config:import', (_event, payload) => importModelProfiles(payload))
ipcMain.handle('model:list', (_event, config) => listModels(config))
ipcMain.handle('model:test', (_event, config) => testModel(config))
ipcMain.handle('model:embed', async (_event, config, texts, requestId) => {
  if (!requestId) throw new Error('Embedding 请求参数无效。')
  const controller = new AbortController()
  activeRequests.set(requestId, controller)
  try { return await embedTexts(config, texts, controller.signal) }
  finally { activeRequests.delete(requestId) }
})
ipcMain.handle('model:stream', (event, payload) => {
  if (!payload?.requestId || !Array.isArray(payload.messages)) throw new Error('流式请求参数无效。')
  void runStream(event, payload.requestId, payload.config, payload.messages, payload.options || {})
  return { started: true }
})
ipcMain.handle('model:abort', (_event, requestId) => {
  activeRequests.get(requestId)?.abort()
  return { aborted: true }
})

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
