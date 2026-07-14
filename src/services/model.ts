import type { ChatAttachment, ChatMessage, ModelConfig, ModelRequestOptions } from '@/types'
import { toRaw } from 'vue'

export class ModelError extends Error {
  constructor(message: string, public code = 'MODEL_ERROR') { super(message) }
}

function endpoint(baseUrl: string, suffix: string) {
  return `${baseUrl.replace(/\/$/, '')}${suffix}`
}

function snapshotConfig(config: ModelConfig): ModelConfig {
  return { ...toRaw(config) }
}

type ModelMessage = Pick<ChatMessage, 'role' | 'content' | 'attachments'>

function snapshotMessages(messages: ModelMessage[]) {
  return messages.map(({ role, content, attachments }) => ({
    role,
    content,
    attachments: attachments?.map(attachment => ({ ...attachment }))
  }))
}

function attachmentBase64(attachment: ChatAttachment) {
  const match = attachment.dataUrl?.match(/^data:([^;,]+);base64,(.+)$/s)
  if (!match) throw new ModelError(`附件“${attachment.name}”的数据无效，请重新添加。`, 'INVALID_ATTACHMENT')
  return { mimeType: match[1].toLowerCase(), data: match[2] }
}

function openAIMessages(messages: ModelMessage[]) {
  return messages.map(message => {
    const attachments = message.attachments?.filter(attachment => attachment.dataUrl) || []
    if (!attachments.length) return { role: message.role, content: message.content }
    const content: Record<string, unknown>[] = []
    if (message.content.trim()) content.push({ type: 'text', text: message.content })
    for (const attachment of attachments) {
      const source = attachmentBase64(attachment)
      if (attachment.kind === 'image') content.push({ type: 'image_url', image_url: { url: attachment.dataUrl } })
      else content.push({ type: 'input_audio', input_audio: { data: source.data, format: source.mimeType.split('/')[1].replace('mpeg', 'mp3').replace('x-wav', 'wav') } })
    }
    return { role: message.role, content }
  })
}

function ollamaMessages(messages: ModelMessage[]) {
  return messages.map(message => {
    const attachments = message.attachments?.filter(attachment => attachment.dataUrl) || []
    const audio = attachments.find(attachment => attachment.kind === 'audio')
    if (audio) throw new ModelError('Ollama 暂不支持在聊天中识别音频，请改用支持音频输入的 OpenAI 兼容模型或 Gemini。', 'UNSUPPORTED_ATTACHMENT')
    const images = attachments.filter(attachment => attachment.kind === 'image').map(attachment => attachmentBase64(attachment).data)
    return { role: message.role, content: message.content, ...(images.length ? { images } : {}) }
  })
}

async function parseError(response: Response) {
  const text = await response.text()
  try {
    const payload = JSON.parse(text)
    return payload.error?.message || payload.message || `请求失败 (${response.status})`
  } catch { return text.slice(0, 240) || `请求失败 (${response.status})` }
}

export async function listModels(config: ModelConfig): Promise<string[]> {
  if (window.desktopAPI) return window.desktopAPI.listModels(snapshotConfig(config))
  const url = config.provider === 'ollama' ? endpoint(config.baseUrl, '/api/tags') : endpoint(config.baseUrl, '/models')
  const response = await fetch(url, {
    headers: config.provider === 'ollama' ? {} : { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(config.timeoutSeconds * 1000)
  })
  if (!response.ok) throw new ModelError(await parseError(response), response.status === 401 ? 'AUTH_FAILED' : 'CONNECTION_FAILED')
  const data = await response.json()
  const models = config.provider === 'ollama' ? data.models?.map((item: { name: string }) => item.name) : data.data?.map((item: { id: string }) => item.id)
  return (models || []).sort()
}

export async function testConnection(config: ModelConfig) {
  if (window.desktopAPI) return window.desktopAPI.testModel(snapshotConfig(config))
  const models = await listModels(config)
  if (config.chatModel && !models.includes(config.chatModel)) {
    throw new ModelError(`已连接，但未找到模型 ${config.chatModel}`, 'MODEL_NOT_FOUND')
  }
  return { models, preview: '', latencyMs: 0, embeddingOk: false, embeddingError: '' }
}

export async function embedTexts(config: ModelConfig, texts: string[], signal?: AbortSignal) {
  if (window.desktopAPI) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const requestId = crypto.randomUUID()
    const abort = () => { void window.desktopAPI?.abortStream(requestId) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      return await window.desktopAPI.embedTexts(snapshotConfig(config), [...texts], requestId)
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }
  throw new ModelError('向量检索仅在桌面应用中可用')
}

export async function streamChat(
  config: ModelConfig,
  messages: ModelMessage[],
  onToken: (token: string) => void,
  signal?: AbortSignal,
  options: ModelRequestOptions = {}
) {
  if (window.desktopAPI) return streamDesktop(config, messages, onToken, signal, options)
  if (config.provider === 'ollama') return streamOllama(config, messages, onToken, signal, options)
  return streamOpenAI(config, messages, onToken, signal, options)
}

async function streamDesktop(config: ModelConfig, messages: ModelMessage[], onToken: (token: string) => void, signal?: AbortSignal, options: ModelRequestOptions = {}) {
  const api = window.desktopAPI!
  const requestId = crypto.randomUUID()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      api.clearStreamListener(requestId)
      callback()
    }
    const abort = () => {
      void api.abortStream(requestId)
      finish(() => reject(new DOMException('Aborted', 'AbortError')))
    }
    api.onStreamEvent(requestId, event => {
      if (event.requestId !== requestId) return
      if (event.type === 'token') onToken(event.token || '')
      else if (event.type === 'done') finish(resolve)
      else if (event.type === 'aborted') finish(() => reject(new DOMException('Aborted', 'AbortError')))
      else if (event.type === 'error') finish(() => reject(new ModelError(event.message || '模型请求失败')))
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    api.startStream({
      requestId,
      config: snapshotConfig(config),
      messages: snapshotMessages(messages),
      options: { ...options }
    }).catch(error => finish(() => reject(error)))
  })
}

async function streamOpenAI(config: ModelConfig, messages: ModelMessage[], onToken: (token: string) => void, signal?: AbortSignal, options: ModelRequestOptions = {}) {
  const model = options.model || config.chatModel
  const reasoningModel = /^(o\d|gpt-5)/i.test(model)
  const tokenParameter = config.tokenParameter === 'auto' ? (reasoningModel ? 'max_completion_tokens' : 'max_tokens') : config.tokenParameter
  const payload: Record<string, unknown> = { model, messages: openAIMessages(messages), stream: true, [tokenParameter]: options.maxTokens || config.maxTokens }
  if (!reasoningModel) payload.temperature = options.temperature ?? config.temperature
  const response = await fetch(endpoint(config.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(payload),
    signal
  })
  if (!response.ok) throw new ModelError(await parseError(response), response.status === 401 ? 'AUTH_FAILED' : 'REQUEST_FAILED')
  if (!response.body) throw new ModelError('模型服务没有返回可读取的数据流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emitted = ''
  const consume = (line: string) => {
    const value = line.trim().replace(/^data:\s*/, '')
    if (!value || value === '[DONE]') return
    try {
      const data = JSON.parse(value)
      const content = data.choices?.[0]?.delta?.content || data.choices?.[0]?.message?.content || data.choices?.[0]?.delta?.reasoning_content || ''
      const text = Array.isArray(content) ? content.map((item: { text?: string }) => item.text || '').join('') : content
      if (text) { emitted += text; onToken(text) }
    } catch { /* event metadata */ }
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
  if (!emitted) throw new ModelError('模型没有返回可显示的回复')
}

async function streamOllama(config: ModelConfig, messages: ModelMessage[], onToken: (token: string) => void, signal?: AbortSignal, options: ModelRequestOptions = {}) {
  const response = await fetch(endpoint(config.baseUrl, '/api/chat'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: options.model || config.chatModel, messages: ollamaMessages(messages), stream: true, options: { temperature: options.temperature ?? config.temperature, num_predict: options.maxTokens || config.maxTokens } }), signal
  })
  if (!response.ok) throw new ModelError(await parseError(response), 'REQUEST_FAILED')
  if (!response.body) throw new ModelError('Ollama 没有返回可读取的数据流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { onToken(JSON.parse(line).message?.content || '') } catch { /* partial event */ }
    }
  }
}
