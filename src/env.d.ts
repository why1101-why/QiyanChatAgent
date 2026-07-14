/// <reference types="vite/client" />

import type { ChatAttachment, ModelConfig, ModelConfigState, ModelProfilesBackup, ModelRequestOptions } from './types'

type DesktopStreamEvent = {
  requestId: string
  type: 'token' | 'done' | 'error' | 'aborted'
  token?: string
  message?: string
}

interface DesktopAPI {
  isDesktop: true
  platform: string
  loadModelConfig(): Promise<ModelConfigState | null>
  saveModelConfig(config: ModelConfig): Promise<ModelConfigState>
  activateModelProfile(profileId: string): Promise<ModelConfigState>
  deleteModelProfile(profileId: string): Promise<ModelConfigState>
  importModelProfiles(payload: ModelProfilesBackup): Promise<ModelConfigState>
  listModels(config: ModelConfig): Promise<string[]>
  testModel(config: ModelConfig): Promise<{ models: string[], preview: string, latencyMs: number, embeddingOk: boolean, embeddingError: string }>
  embedTexts(config: ModelConfig, texts: string[], requestId: string): Promise<number[][]>
  startStream(payload: { requestId: string, config: ModelConfig, messages: { role: string, content: string, attachments?: ChatAttachment[] }[], options?: ModelRequestOptions }): Promise<{ started: boolean }>
  abortStream(requestId: string): Promise<{ aborted: boolean }>
  onStreamEvent(requestId: string, callback: (event: DesktopStreamEvent) => void): boolean
  clearStreamListener(requestId: string): void
}

declare global {
  interface Window { desktopAPI?: DesktopAPI }
}
