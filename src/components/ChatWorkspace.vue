<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { AudioLines, Bot, Image as ImageIcon, MessageSquarePlus, PanelLeftClose, Paperclip, Send, Settings, Square, Trash2, UploadCloud, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import MessageBubble from './MessageBubble.vue'
import { useSettingsStore } from '@/stores/settings'
import { useConversationStore } from '@/stores/conversations'
import { streamChat } from '@/services/model'
import type { ChatAttachment, ChatAttachmentKind, ChatMessage, Conversation } from '@/types'

const props = withDefaults(defineProps<{
  feature: Conversation['feature']
  title: string
  description: string
  systemPrompt?: string
  suggestions?: string[]
}>(), { systemPrompt: '你是一个专业、友善、准确的中文 AI 助手。', suggestions: () => [] })

const router = useRouter()
const settings = useSettingsStore()
const conversations = useConversationStore()
const activeId = ref('')
const input = ref('')
const streaming = ref(false)
const error = ref('')
const messageList = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const attachments = ref<ChatAttachment[]>([])
const attachmentError = ref('')
const dragDepth = ref(0)
let abortController: AbortController | null = null

const MAX_ATTACHMENTS = 6
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 24 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/webm', 'audio/flac', 'audio/x-flac'])
const ACCEPTED_FILES = 'image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/webm,audio/flac,.mp3,.m4a,.flac'

const featureItems = computed(() => conversations.byFeature(props.feature).sort((a, b) => b.updatedAt - a.updatedAt))
const active = computed(() => conversations.get(activeId.value))

function newConversation() {
  const item = conversations.create(props.feature, `新${props.title}`)
  activeId.value = item.id
  input.value = ''
  error.value = ''
  clearPendingAttachments()
}

function selectConversation(id: string) {
  activeId.value = id
  input.value = ''
  error.value = ''
  clearPendingAttachments()
}

function removeConversation(id: string) {
  conversations.remove(id)
  if (activeId.value === id) activeId.value = featureItems.value[0]?.id || ''
  if (!activeId.value) newConversation()
}

function clearPendingAttachments() {
  attachments.value = []
  attachmentError.value = ''
  dragDepth.value = 0
  if (fileInput.value) fileInput.value.value = ''
}

function inferredMimeType(file: File) {
  if (file.type) return file.type.toLowerCase()
  const extension = file.name.split('.').pop()?.toLowerCase()
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' } as Record<string, string>)[extension || ''] || ''
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('文件读取失败'))
    reader.onerror = () => reject(new Error(`无法读取“${file.name}”`))
    reader.readAsDataURL(file)
  })
}

async function addFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList)
  if (!files.length) return
  attachmentError.value = ''
  if (attachments.value.length + files.length > MAX_ATTACHMENTS) throw new Error(`每条消息最多添加 ${MAX_ATTACHMENTS} 个附件。`)
  const checked = files.map(file => {
    const mimeType = inferredMimeType(file)
    const kind: ChatAttachmentKind | null = IMAGE_TYPES.has(mimeType) ? 'image' : AUDIO_TYPES.has(mimeType) ? 'audio' : null
    if (!kind) throw new Error(`不支持“${file.name}”的格式，请添加常见图片或音频文件。`)
    const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES
    if (file.size > limit) throw new Error(`“${file.name}”超过${kind === 'image' ? '图片 8 MB' : '音频 20 MB'}限制。`)
    return { file, mimeType, kind }
  })
  const totalSize = attachments.value.reduce((sum, item) => sum + item.size, 0) + checked.reduce((sum, item) => sum + item.file.size, 0)
  if (totalSize > MAX_TOTAL_BYTES) throw new Error('本条消息的附件总计不能超过 24 MB。')
  const prepared = await Promise.all(checked.map(async ({ file, mimeType, kind }) => ({
    id: crypto.randomUUID(),
    name: file.name || (kind === 'image' ? '粘贴的图片' : '粘贴的音频'),
    kind,
    mimeType,
    size: file.size,
    dataUrl: await readAsDataUrl(file)
  } satisfies ChatAttachment)))
  attachments.value.push(...prepared)
}

async function safelyAddFiles(fileList: FileList | File[]) {
  try { await addFiles(fileList) }
  catch (cause) { attachmentError.value = cause instanceof Error ? cause.message : '添加附件失败' }
  finally { if (fileInput.value) fileInput.value.value = '' }
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(attachment => attachment.id !== id)
  attachmentError.value = ''
}

function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files) void safelyAddFiles(target.files)
}

function handlePaste(event: ClipboardEvent) {
  const files = event.clipboardData?.files
  if (!files?.length) return
  event.preventDefault()
  void safelyAddFiles(files)
}

function hasDraggedFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function handleDragEnter(event: DragEvent) {
  if (hasDraggedFiles(event)) dragDepth.value += 1
}

function handleDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

function handleDrop(event: DragEvent) {
  dragDepth.value = 0
  const files = event.dataTransfer?.files
  if (files?.length) void safelyAddFiles(files)
}

async function scrollToBottom() {
  await nextTick()
  messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' })
}

async function send(text = input.value) {
  const prompt = text.trim()
  const pendingAttachments = attachments.value.map(attachment => ({ ...attachment }))
  if ((!prompt && !pendingAttachments.length) || streaming.value) return
  if (!settings.isConfigured) { router.push('/settings'); return }
  if (!active.value) newConversation()
  const conversation = active.value!
  const requestText = prompt || '请识别并分析这些附件。'
  if (!conversation.messages.length) conversation.title = (prompt || `分析 ${pendingAttachments[0]?.name || '附件'}`).slice(0, 22)
  conversations.addMessage(conversation.id, { id: crypto.randomUUID(), role: 'user', content: requestText, attachments: pendingAttachments, createdAt: Date.now(), status: 'done' })
  const answer: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: Date.now(), status: 'streaming' }
  conversations.addMessage(conversation.id, answer)
  input.value = ''
  attachments.value = []
  attachmentError.value = ''
  error.value = ''
  streaming.value = true
  const requestController = new AbortController()
  abortController = requestController
  await scrollToBottom()
  try {
    const messages = [
      { role: 'system' as const, content: props.systemPrompt },
      ...conversation.messages
        .filter(item => item.id !== answer.id && (item.content.trim() || item.attachments?.some(attachment => attachment.dataUrl)) && item.status !== 'error')
        .slice(-settings.config.historyLimit)
        .map(item => ({ role: item.role, content: item.content, attachments: item.attachments }))
    ]
    await streamChat(settings.config, messages, token => {
      conversations.appendMessageContent(conversation.id, answer.id, token)
      void scrollToBottom()
    }, requestController.signal, { purpose: props.feature === 'service' ? 'service' : 'chat', model: settings.modelFor(props.feature === 'service' ? 'service' : 'chat') })
    conversations.updateMessage(conversation.id, answer.id, { status: 'done' })
  } catch (cause) {
    if (requestController.signal.aborted) conversations.updateMessage(conversation.id, answer.id, { status: 'stopped' })
    else {
      conversations.updateMessage(conversation.id, answer.id, { status: 'error' })
      error.value = cause instanceof Error ? cause.message : '模型请求失败'
    }
  } finally {
    streaming.value = false
    if (abortController === requestController) abortController = null
    void scrollToBottom()
  }
}

function stop() { abortController?.abort() }

onMounted(() => {
  activeId.value = featureItems.value[0]?.id || ''
  if (!activeId.value) newConversation()
})
onBeforeUnmount(() => abortController?.abort())
</script>

<template>
  <div class="chat-workspace">
    <aside class="conversation-rail">
      <button class="new-chat" @click="newConversation"><MessageSquarePlus :size="16" />新建{{ title }}</button>
      <div class="conversation-list">
        <div v-for="item in featureItems" :key="item.id" :class="['conversation-item', { active: item.id === activeId }]">
          <button class="conversation-select" :aria-current="item.id === activeId ? 'true' : undefined" @click="selectConversation(item.id)"><span>{{ item.title }}</span></button>
          <button class="conversation-delete" :aria-label="`删除会话：${item.title}`" title="删除会话" @click="removeConversation(item.id)"><Trash2 :size="13" /></button>
        </div>
      </div>
      <div class="rail-footer"><PanelLeftClose :size="15" />会话保存在本地</div>
    </aside>

    <section class="chat-main" @dragenter.prevent="handleDragEnter" @dragover.prevent @dragleave.prevent="handleDragLeave" @drop.prevent="handleDrop">
      <div v-if="dragDepth > 0" class="drop-overlay"><UploadCloud :size="28" /><strong>松开即可添加附件</strong><span>支持图片与音频文件</span></div>
      <div v-if="!settings.isConfigured" class="empty-action">
        <span class="empty-icon"><Settings :size="24" /></span><h3>先配置一个模型</h3><p>填写 API Key 或连接本地 Ollama，完成测试后即可使用 {{ title }}。</p><button class="primary-btn" @click="router.push('/settings')"><Settings :size="16" />打开设置</button>
      </div>
      <template v-else>
        <div ref="messageList" class="messages">
          <div v-if="!active?.messages.length" class="chat-empty">
            <span><Bot :size="25" /></span><h2>{{ title }}</h2><p>{{ description }}</p>
            <div class="suggestions"><button v-for="suggestion in suggestions" :key="suggestion" @click="send(suggestion)">{{ suggestion }}</button></div>
          </div>
          <MessageBubble v-for="message in active?.messages" :key="message.id" :message="message" />
        </div>
        <div class="composer-wrap">
          <div v-if="error || attachmentError" class="composer-error">{{ attachmentError || error }}</div>
          <div class="composer">
            <div v-if="attachments.length" class="pending-attachments">
              <div v-for="attachment in attachments" :key="attachment.id" class="pending-attachment">
                <img v-if="attachment.kind === 'image' && attachment.dataUrl" :src="attachment.dataUrl" :alt="attachment.name" />
                <span v-else class="attachment-kind"><AudioLines v-if="attachment.kind === 'audio'" :size="17" /><ImageIcon v-else :size="17" /></span>
                <span class="attachment-info"><strong>{{ attachment.name }}</strong><small>{{ attachment.kind === 'image' ? '图片' : '音频' }} · {{ formatSize(attachment.size) }}</small></span>
                <button type="button" :aria-label="`移除附件：${attachment.name}`" title="移除附件" @click="removeAttachment(attachment.id)"><X :size="14" /></button>
              </div>
            </div>
            <div class="composer-input-row">
              <input ref="fileInput" class="file-input" type="file" multiple :accept="ACCEPTED_FILES" @change="handleFileChange" />
              <button type="button" class="attach-btn" title="添加图片或音频" aria-label="添加图片或音频" :disabled="streaming" @click="fileInput?.click()"><Paperclip :size="17" /></button>
              <textarea v-model="input" rows="1" :placeholder="`给 ${title} 发送消息，或粘贴图片和音频`" @paste="handlePaste" @keydown.enter.exact.prevent="send()" />
              <button v-if="streaming" class="stop-btn" title="停止生成" @click="stop"><Square :size="14" /></button>
              <button v-else class="send-btn" title="发送" :disabled="!input.trim() && !attachments.length" @click="send()"><Send :size="17" /></button>
            </div>
          </div>
          <small>AI 可能会犯错，请核对重要信息。</small>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.chat-workspace { height: 100%; display: grid; grid-template-columns: 210px minmax(0, 1fr); background: var(--surface); color: var(--ink); }
.conversation-rail { min-height: 0; padding: 14px 10px; border-right: 1px solid var(--line); background: var(--canvas); display: flex; flex-direction: column; }
.new-chat { border: 1px solid var(--line); background: var(--control); min-height: 38px; border-radius: 6px; display: flex; align-items: center; justify-content: center; gap: 7px; color: var(--ink); font-size: 11px; font-weight: 650; }
.new-chat:hover { border-color: #8ecfa9; }
.conversation-list { margin-top: 12px; display: grid; gap: 3px; overflow: auto; }
.conversation-item { min-width: 0; width: 100%; min-height: 36px; border-radius: 5px; background: transparent; color: var(--muted); display: grid; grid-template-columns: minmax(0, 1fr) 24px; align-items: center; gap: 2px; padding: 0 4px; font-size: 10px; }
.conversation-select { min-width: 0; height: 100%; border: 0; background: transparent; color: inherit; padding: 0 4px; text-align: left; }
.conversation-select span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-delete { width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 4px; color: var(--muted); background: transparent; opacity: 0; }
.conversation-item:hover { background: var(--hover); }
.conversation-item:hover .conversation-delete, .conversation-item:focus-within .conversation-delete { opacity: 1; }
.conversation-item.active { color: #19683e; background: #e7f5ec; font-weight: 650; }
.rail-footer { margin-top: auto; display: flex; align-items: center; gap: 6px; color: #9aa2ad; font-size: 9px; padding: 8px; }
.chat-main { position: relative; min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.drop-overlay { position: absolute; inset: 12px; z-index: 20; display: grid; place-content: center; justify-items: center; gap: 7px; border: 2px dashed var(--green); border-radius: 8px; color: var(--green-dark); background: color-mix(in srgb, var(--surface) 92%, var(--green-soft)); pointer-events: none; }
.drop-overlay strong { font-size: 13px; }
.drop-overlay span { color: var(--muted); font-size: 10px; }
.messages { min-height: 0; overflow: auto; }
.chat-empty { min-height: 100%; display: grid; place-content: center; justify-items: center; text-align: center; padding: 30px; }
.chat-empty > span { width: 54px; height: 54px; border-radius: 8px; display: grid; place-items: center; color: var(--green); background: var(--green-soft); }
.chat-empty h2 { margin: 16px 0 7px; font-size: 20px; }
.chat-empty p { margin: 0; color: var(--muted); font-size: 12px; }
.suggestions { max-width: 600px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 21px; }
.suggestions button { border: 1px solid var(--line); background: #fff; border-radius: 6px; padding: 9px 11px; color: #56606f; font-size: 10px; }
.suggestions button:hover { border-color: #99d4b1; color: var(--green-dark); }
.composer-wrap { padding: 12px 20px 14px; background: var(--surface); }
.composer { max-width: 780px; margin: 0 auto; border: 1px solid var(--line); border-radius: 8px; padding: 5px 6px; box-shadow: 0 6px 20px rgba(20,27,38,.06); }
.composer:focus-within { border-color: #8acfa5; box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 13%, transparent); }
.composer-input-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) 38px; align-items: end; }
.composer textarea { min-width: 0; resize: none; max-height: 130px; border: 0; outline: 0; padding: 8px 7px; line-height: 1.5; font-size: 12px; color: var(--ink); background: transparent; }
.file-input { display: none; }
.attach-btn { width: 34px; height: 34px; border: 0; border-radius: 6px; display: grid; place-items: center; color: var(--muted); background: transparent; }
.attach-btn:hover:not(:disabled) { color: var(--green-dark); background: var(--green-soft); }
.attach-btn:disabled { opacity: .45; cursor: not-allowed; }
.pending-attachments { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 2px 2px 7px; }
.pending-attachment { min-width: 0; height: 48px; display: grid; grid-template-columns: 38px minmax(0, 1fr) 26px; align-items: center; gap: 7px; padding: 4px; border: 1px solid var(--line); border-radius: 6px; background: var(--subtle); }
.pending-attachment > img, .attachment-kind { width: 38px; height: 38px; border-radius: 5px; object-fit: cover; }
.attachment-kind { display: grid; place-items: center; color: var(--green-dark); background: var(--green-soft); }
.attachment-info { min-width: 0; }
.attachment-info strong, .attachment-info small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-info strong { font-size: 9px; }
.attachment-info small { margin-top: 3px; color: var(--muted); font-size: 8px; }
.pending-attachment > button { width: 24px; height: 24px; border: 0; border-radius: 4px; display: grid; place-items: center; color: var(--muted); background: transparent; }
.pending-attachment > button:hover { color: #b23d3d; background: var(--hover); }
.send-btn, .stop-btn { width: 34px; height: 34px; border: 0; border-radius: 6px; display: grid; place-items: center; color: white; background: var(--green); }
.stop-btn { background: #404955; }
.send-btn:disabled { background: #cbd1d7; cursor: not-allowed; }
.composer-wrap > small { max-width: 780px; margin: 6px auto 0; display: block; text-align: center; color: #a0a7b1; font-size: 9px; }
.composer-error { max-width: 780px; margin: 0 auto 8px; color: #b23d3d; font-size: 10px; }
:global([data-theme="dark"]) .conversation-item.active { color: #81d8a5; background: #173827; }
:global([data-theme="dark"]) .suggestions button { color: var(--muted); background: var(--control); }
@media (max-width: 700px) { .chat-workspace { grid-template-columns: 1fr; grid-template-rows: 52px minmax(0, 1fr); } .conversation-rail { min-width: 0; padding: 6px; border-right: 0; border-bottom: 1px solid var(--line); flex-direction: row; align-items: center; } .new-chat { flex: 0 0 120px; min-height: 38px; } .conversation-list { min-width: 0; flex: 1; margin: 0 0 0 6px; display: flex; gap: 4px; overflow-x: auto; } .conversation-item { flex: 0 0 150px; } .rail-footer { display: none; } .composer-wrap { padding-inline: 10px; } .pending-attachments { grid-template-columns: 1fr; } }
</style>
