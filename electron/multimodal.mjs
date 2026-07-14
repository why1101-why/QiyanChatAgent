export const ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 6,
  maxImageBytes: 8 * 1024 * 1024,
  maxAudioBytes: 20 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024
})

export const SUPPORTED_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export const SUPPORTED_AUDIO_TYPES = Object.freeze([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a',
  'audio/ogg', 'audio/webm', 'audio/flac', 'audio/x-flac'
])

function attachmentError(message) {
  const error = new Error(message)
  error.code = 'INVALID_ATTACHMENT'
  return error
}

function parseDataUrl(attachment) {
  const dataUrl = String(attachment.dataUrl || '')
  const maximumEncodedLength = Math.ceil(ATTACHMENT_LIMITS.maxAudioBytes * 4 / 3) + 1024
  if (dataUrl.length > maximumEncodedLength) throw attachmentError(`附件“${attachment.name || '未命名文件'}”超过大小限制。`)
  const match = dataUrl.match(/^data:([^;,]+);base64,([a-z\d+/=\r\n]+)$/i)
  if (!match) throw attachmentError(`附件“${attachment.name || '未命名文件'}”的数据无效，请重新添加。`)
  const mimeType = match[1].toLowerCase()
  const data = match[2].replace(/[\r\n]/g, '')
  const size = Buffer.from(data, 'base64').byteLength
  const kind = String(attachment.kind)
  const supported = kind === 'image' ? SUPPORTED_IMAGE_TYPES : kind === 'audio' ? SUPPORTED_AUDIO_TYPES : []
  if (!supported.includes(mimeType)) throw attachmentError(`不支持附件“${attachment.name || '未命名文件'}”的格式 ${mimeType}。`)
  const limit = kind === 'image' ? ATTACHMENT_LIMITS.maxImageBytes : ATTACHMENT_LIMITS.maxAudioBytes
  if (size > limit) throw attachmentError(`附件“${attachment.name || '未命名文件'}”超过大小限制。`)
  return { ...attachment, dataUrl, kind, mimeType, data, size }
}

function validatedMessages(messages) {
  if (!Array.isArray(messages)) throw attachmentError('消息数据无效。')
  let totalBytes = 0
  return messages.map(message => {
    const rawAttachments = Array.isArray(message.attachments) ? message.attachments.filter(attachment => attachment?.dataUrl) : []
    if (rawAttachments.length > ATTACHMENT_LIMITS.maxCount) throw attachmentError(`单条消息最多添加 ${ATTACHMENT_LIMITS.maxCount} 个附件。`)
    const attachments = rawAttachments.map(parseDataUrl)
    totalBytes += attachments.reduce((total, attachment) => total + attachment.size, 0)
    if (totalBytes > ATTACHMENT_LIMITS.maxTotalBytes) throw attachmentError('当前对话发送的附件总计超过 24 MB，请新建会话或减少附件。')
    return { role: message.role, content: String(message.content || ''), attachments }
  })
}

function audioFormat(mimeType) {
  return mimeType.split('/')[1].replace('mpeg', 'mp3').replace('x-wav', 'wav').replace('x-m4a', 'm4a').replace('x-flac', 'flac')
}

function openAIMessages(messages) {
  return messages.map(message => {
    if (!message.attachments.length) return { role: message.role, content: message.content }
    const content = []
    if (message.content.trim()) content.push({ type: 'text', text: message.content })
    for (const attachment of message.attachments) {
      if (attachment.kind === 'image') content.push({ type: 'image_url', image_url: { url: attachment.dataUrl } })
      else content.push({ type: 'input_audio', input_audio: { data: attachment.data, format: audioFormat(attachment.mimeType) } })
    }
    return { role: message.role, content }
  })
}

function anthropicMessages(messages) {
  const unsupported = messages.flatMap(message => message.attachments).find(attachment => attachment.kind === 'audio')
  if (unsupported) throw attachmentError('Anthropic 聊天接口暂不支持音频附件，请改用支持音频输入的 OpenAI 兼容模型或 Gemini。')
  return messages.map(message => {
    if (message.role === 'system' || !message.attachments.length) return { role: message.role, content: message.content }
    const content = []
    for (const attachment of message.attachments) {
      content.push({ type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.data } })
    }
    if (message.content.trim()) content.push({ type: 'text', text: message.content })
    return { role: message.role === 'assistant' ? 'assistant' : 'user', content }
  })
}

function geminiMessages(messages) {
  return messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : message.role,
    parts: [
      ...(message.content.trim() ? [{ text: message.content }] : []),
      ...message.attachments.map(attachment => ({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } }))
    ]
  }))
}

function ollamaMessages(messages) {
  const unsupported = messages.flatMap(message => message.attachments).find(attachment => attachment.kind === 'audio')
  if (unsupported) throw attachmentError('Ollama 暂不支持在聊天中识别音频，请改用支持音频输入的 OpenAI 兼容模型或 Gemini。')
  return messages.map(message => ({
    role: message.role,
    content: message.content,
    ...(message.attachments.length ? { images: message.attachments.map(attachment => attachment.data) } : {})
  }))
}

export function prepareProviderMessages(provider, messages) {
  const validated = validatedMessages(messages)
  if (provider === 'anthropic') return anthropicMessages(validated)
  if (provider === 'gemini') return geminiMessages(validated)
  if (provider === 'ollama') return ollamaMessages(validated)
  return openAIMessages(validated)
}
