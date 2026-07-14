export type ProviderType = 'openai-compatible' | 'anthropic' | 'gemini' | 'ollama'
export type ModelPurpose = 'chat' | 'game' | 'service' | 'pdf'
export type ThemeMode = 'light' | 'dark' | 'system'
export type SafetyMode = 'read-only' | 'confirm-write' | 'full-access'
export type TokenParameter = 'auto' | 'max_tokens' | 'max_completion_tokens'
export type AuthMode = 'bearer' | 'api-key-header' | 'none'

export interface ModelConfig {
  profileId: string
  profileName: string
  provider: ProviderType
  providerName: string
  baseUrl: string
  apiKey: string
  chatModel: string
  gameModel: string
  serviceModel: string
  pdfModel: string
  embeddingModel: string
  temperature: number
  maxTokens: number
  timeoutSeconds: number
  tokenParameter: TokenParameter
  authMode: AuthMode
  apiKeyHeader: string
  historyLimit: number
  contextCharLimit: number
  safetyMode: SafetyMode
  globalPrompt: string
  chatPrompt: string
  gamePrompt: string
  servicePrompt: string
  pdfPrompt: string
  theme: ThemeMode
  uiScale: number
  fontSize: number
  compactSidebar: boolean
  lastTestedAt: string
  lastTestedFingerprint: string
}

export type ModelProfile = Pick<ModelConfig,
  'provider' | 'providerName' | 'baseUrl' | 'chatModel' | 'gameModel' | 'serviceModel' |
  'pdfModel' | 'embeddingModel' | 'temperature' | 'maxTokens' | 'timeoutSeconds' |
  'tokenParameter' | 'authMode' | 'apiKeyHeader' | 'lastTestedAt' | 'lastTestedFingerprint'
> & {
  id: string
  name: string
  hasApiKey: boolean
}

export interface ModelConfigState {
  config: ModelConfig
  profiles: ModelProfile[]
  activeProfileId: string
  hasApiKey: boolean
}

export interface ModelProfilesBackup {
  version: number
  activeProfileId?: string
  config?: Partial<ModelConfig>
  profiles?: Array<Partial<Omit<ModelProfile, 'hasApiKey'>>>
}

export interface ModelRequestOptions {
  purpose?: ModelPurpose
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
}

export type ChatAttachmentKind = 'image' | 'audio'

export interface ChatAttachment {
  id: string
  name: string
  kind: ChatAttachmentKind
  mimeType: string
  size: number
  dataUrl?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: ChatAttachment[]
  createdAt: number
  status?: 'streaming' | 'done' | 'error' | 'stopped'
}

export interface Conversation {
  id: string
  title: string
  feature: 'chat' | 'game' | 'service' | 'pdf'
  messages: ChatMessage[]
  updatedAt: number
}

export interface NoteFolder {
  id: string
  name: string
  createdAt: number
}

export interface InspirationNote {
  id: string
  title: string
  content: string
  folderId: string
  tags: string[]
  pinned: boolean
  revision: number
  createdAt: number
  updatedAt: number
}

export interface GameResult {
  reply: string
  scoreDelta: number
  reason: string
  gameOver: boolean
  ending: 'continue' | 'won' | 'lost'
}
