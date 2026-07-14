<script setup lang="ts">
import { computed, ref } from 'vue'
import { AudioLines, Check, Copy, Image as ImageIcon, LoaderCircle, UserRound } from 'lucide-vue-next'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage } from '@/types'

const props = defineProps<{ message: ChatMessage }>()
const copied = ref(false)
const html = computed(() => DOMPurify.sanitize(marked.parse(props.message.content || '') as string))

async function copy() {
  await navigator.clipboard.writeText(props.message.content)
  copied.value = true
  setTimeout(() => copied.value = false, 1300)
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
</script>

<template>
  <article :class="['message', message.role]">
    <div class="avatar"><UserRound v-if="message.role === 'user'" :size="16" /><span v-else>AI</span></div>
    <div class="message-body">
      <div class="message-meta"><strong>{{ message.role === 'user' ? '你' : '栖言' }}</strong><span v-if="message.status === 'streaming'"><LoaderCircle class="spin" :size="12" />生成中</span><span v-else-if="message.status === 'stopped'">已停止</span></div>
      <div v-if="message.attachments?.length" class="message-attachments">
        <div v-for="attachment in message.attachments" :key="attachment.id" :class="['message-attachment', { 'audio-attachment': attachment.kind === 'audio' && attachment.dataUrl }]">
          <img v-if="attachment.kind === 'image' && attachment.dataUrl" :src="attachment.dataUrl" :alt="attachment.name" />
          <audio v-else-if="attachment.kind === 'audio' && attachment.dataUrl" :src="attachment.dataUrl" controls preload="metadata" />
          <span v-else class="stored-attachment"><AudioLines v-if="attachment.kind === 'audio'" :size="18" /><ImageIcon v-else :size="18" /></span>
          <span><strong>{{ attachment.name }}</strong><small>{{ attachment.kind === 'image' ? '图片' : '音频' }} · {{ formatSize(attachment.size) }}<template v-if="!attachment.dataUrl"> · 已从内存清除</template></small></span>
        </div>
      </div>
      <div v-if="message.role === 'assistant'" class="markdown" v-html="html" />
      <div v-else class="plain-text">{{ message.content }}</div>
      <button v-if="message.content" class="copy-action" :title="copied ? '已复制' : '复制消息'" @click="copy"><Check v-if="copied" :size="14" /><Copy v-else :size="14" /></button>
    </div>
  </article>
</template>

<style scoped>
.message { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 11px; padding: 16px 20px; }
.message.assistant { background: var(--subtle); border-block: 1px solid var(--line); }
.avatar { width: 30px; height: 30px; border-radius: 6px; display: grid; place-items: center; background: #e9ecef; color: #576171; font-size: 10px; font-weight: 800; }
.assistant .avatar { color: white; background: var(--green); }
.message-body { position: relative; min-width: 0; padding-right: 28px; }
.message-meta { height: 24px; display: flex; align-items: center; gap: 10px; }
.message-meta strong { font-size: 11px; }
.message-meta span { display: inline-flex; align-items: center; gap: 4px; color: #8b94a0; font-size: 9px; }
.plain-text, .markdown { font-size: 13px; line-height: 1.72; color: var(--ink); overflow-wrap: anywhere; }
.plain-text { white-space: pre-wrap; }
.message-attachments { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 280px)); gap: 8px; margin: 2px 0 10px; }
.message-attachment { min-width: 0; min-height: 48px; display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: center; gap: 8px; padding: 5px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.message-attachment > img { width: 48px; height: 48px; object-fit: cover; border-radius: 5px; }
.message-attachment > audio { grid-column: 1 / -1; width: 100%; height: 34px; }
.message-attachment.audio-attachment { grid-template-columns: minmax(0, 1fr); }
.stored-attachment { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 5px; color: var(--green-dark); background: var(--green-soft); }
.message-attachment > span:last-child { min-width: 0; }
.message-attachment strong, .message-attachment small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.message-attachment strong { font-size: 9px; }.message-attachment small { margin-top: 4px; color: var(--muted); font-size: 8px; }
.markdown :deep(p) { margin: 0 0 9px; }
.markdown :deep(p:last-child) { margin-bottom: 0; }
.markdown :deep(pre) { overflow: auto; padding: 13px; border-radius: 6px; background: #171c23; color: #eef2f5; }
.markdown :deep(code) { font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; }
.markdown :deep(:not(pre) > code) { background: var(--hover); color: #d95c79; padding: 2px 4px; border-radius: 3px; }
.markdown :deep(ul), .markdown :deep(ol) { padding-left: 20px; }
.copy-action { position: absolute; right: 0; top: 0; width: 26px; height: 26px; border: 0; border-radius: 5px; color: #8b94a1; background: transparent; opacity: 0; transition: .15s; }
.message:hover .copy-action { opacity: 1; }
.copy-action:hover, .copy-action:focus-visible { color: var(--ink); background: var(--hover); opacity: 1; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
