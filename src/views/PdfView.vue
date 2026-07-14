<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { FileCheck2, FileText, LoaderCircle, Search, Send, Settings, Square, UploadCloud, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useSettingsStore } from '@/stores/settings'
import { embedTexts, streamChat } from '@/services/model'
import MessageBubble from '@/components/MessageBubble.vue'
import type { ChatMessage } from '@/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const router = useRouter()
const settings = useSettingsStore()
const fileInput = ref<HTMLInputElement | null>(null)
const fileName = ref('')
const fileSize = ref(0)
const pages = ref<{ page: number, text: string }[]>([])
const indexing = ref(false)
const progress = ref(0)
const error = ref('')
const input = ref('')
const loading = ref(false)
const messages = ref<ChatMessage[]>([])
const lastSources = ref<number[]>([])
const retrievalNote = ref('')
const pageEmbeddings = ref<{ page: number, vector: number[] }[]>([])
const embeddingNotice = ref('')
let controller: AbortController | null = null
let indexController: AbortController | null = null

const pageCount = computed(() => pages.value.length)

async function importPdf(file?: File) {
  if (!file) return
  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!looksLikePdf) { error.value = '请选择扩展名为 .pdf 的文件。'; return }
  if (file.size > 50 * 1024 * 1024) { error.value = 'PDF 不能超过 50 MB。'; return }
  indexController?.abort()
  const currentIndexController = new AbortController()
  indexController = currentIndexController
  indexing.value = true
  error.value = ''
  progress.value = 4
  pages.value = []
  pageEmbeddings.value = []
  embeddingNotice.value = ''
  retrievalNote.value = ''
  try {
    const data = await file.arrayBuffer()
    if (currentIndexController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const signature = new TextDecoder().decode(data.slice(0, 5))
    if (signature !== '%PDF-') throw new Error('文件内容不是有效的 PDF。')
    const useEmbeddings = Boolean(settings.config.embeddingModel && settings.config.provider !== 'anthropic')
    const loadingTask = pdfjsLib.getDocument({ data })
    let destroyPromise: Promise<void> | null = null
    const destroyLoadingTask = () => destroyPromise ||= loadingTask.destroy()
    const abortLoadingTask = () => { void destroyLoadingTask() }
    currentIndexController.signal.addEventListener('abort', abortLoadingTask, { once: true })
    try {
      const pdf = await loadingTask.promise
      if (currentIndexController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index)
        if (currentIndexController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const content = await page.getTextContent()
        if (currentIndexController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const text = content.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim()
        pages.value.push({ page: index, text })
        progress.value = Math.round(index / pdf.numPages * (useEmbeddings ? 60 : 100))
      }
    } finally {
      currentIndexController.signal.removeEventListener('abort', abortLoadingTask)
      await destroyLoadingTask()
    }
    fileName.value = file.name
    fileSize.value = file.size
    messages.value = []
    if (!pages.value.some(page => page.text.length > 10)) {
      error.value = '该 PDF 没有可提取文字，可能是扫描件。当前版本暂不包含 OCR。'
    } else if (useEmbeddings) {
      indexing.value = false
      await buildVectorIndex(currentIndexController.signal)
    }
  } catch (cause) {
    if (currentIndexController.signal.aborted) return
    const message = cause instanceof Error ? cause.message : 'PDF 解析失败'
    error.value = message.includes('Password') ? '该 PDF 已加密，请先移除密码后重试。' : `PDF 解析失败：${message}`
  } finally {
    if (indexController === currentIndexController) {
      indexing.value = false
      indexController = null
    }
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function buildVectorIndex(signal: AbortSignal) {
  pageEmbeddings.value = []
  embeddingNotice.value = '正在建立向量索引…'
  const allCandidates = pages.value.filter(page => page.text.length > 10)
  const candidates = allCandidates.length <= 200
    ? allCandidates
    : Array.from({ length: 200 }, (_, index) => allCandidates[Math.round(index * (allCandidates.length - 1) / 199)])
  try {
    for (let offset = 0; offset < candidates.length; offset += 12) {
      const batch = candidates.slice(offset, offset + 12)
      const vectors = await embedTexts(settings.config, batch.map(page => page.text.slice(0, 4000)), signal)
      vectors.forEach((vector, index) => pageEmbeddings.value.push({ page: batch[index].page, vector }))
      progress.value = 60 + Math.round(Math.min(candidates.length, offset + batch.length) / candidates.length * 40)
    }
    embeddingNotice.value = `向量索引已就绪（${pageEmbeddings.value.length} 页）`
  } catch (cause) {
    if (signal.aborted) return
    pageEmbeddings.value = []
    embeddingNotice.value = `向量索引不可用，已自动改用关键词检索：${cause instanceof Error ? cause.message : '未知错误'}`
    progress.value = 100
  }
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return -1
  let dot = 0, left = 0, right = 0
  for (let index = 0; index < a.length; index++) { dot += a[index] * b[index]; left += a[index] ** 2; right += b[index] ** 2 }
  return dot / (Math.sqrt(left) * Math.sqrt(right) || 1)
}

async function relevantPages(question: string, signal: AbortSignal, limit: number) {
  const summaryQuestion = /(总结|摘要|概括|主要|核心|讲了什么|全文)/.test(question)
  if (summaryQuestion) {
    const candidates = pages.value.filter(page => page.text.length > 10).sort((a, b) => a.page - b.page)
    const sampleCount = Math.min(limit, candidates.length)
    const positions = Array.from({ length: sampleCount }, (_, index) => Math.round(index * (candidates.length - 1) / Math.max(1, sampleCount - 1)))
    const sampled = [...new Map(positions.map(index => [candidates[index].page, candidates[index]])).values()]
    retrievalNote.value = `摘要问题：已均匀抽取 ${sampled.length} 个代表页`
    return sampled
  }

  let vectorRanked: { page: number, text: string, score: number }[] = []
  if (pageEmbeddings.value.length) {
    try {
      const [queryVector] = await embedTexts(settings.config, [question], signal)
      vectorRanked = pageEmbeddings.value.map(entry => ({ ...pages.value.find(page => page.page === entry.page)!, score: cosineSimilarity(queryVector, entry.vector) })).filter(page => page.text).sort((a, b) => b.score - a.score).slice(0, limit)
    } catch (cause) {
      if (signal.aborted) throw cause
      embeddingNotice.value = `向量查询失败，已回退关键词检索：${cause instanceof Error ? cause.message : '未知错误'}`
    }
  }
  const normalized = question.toLowerCase().replace(/[\s，。！？、：；,.!?;:()（）]+/g, '')
  const latinTerms = question.toLowerCase().match(/[a-z0-9_-]{2,}/g) || []
  const chinese = [...normalized].filter(char => /[\u3400-\u9fff]/.test(char))
  const grams = []
  for (let index = 0; index < chinese.length - 1; index++) grams.push(chinese.slice(index, index + 2).join(''))
  const terms = [...new Set([...latinTerms, ...grams])]
  const scored = pages.value.map(page => {
    const text = page.text.toLowerCase()
    const score = terms.reduce((total, term) => total + (text.includes(term) ? 1 + Math.min(3, text.split(term).length - 1) : 0), 0)
    return { ...page, score }
  }).filter(page => page.text.length > 10).sort((a, b) => b.score - a.score)
  const matched = scored.filter(page => page.score > 0).slice(0, limit)
  if (vectorRanked.length) {
    const vectorCount = Math.max(2, Math.ceil(limit * 0.6))
    const merged = [...new Map([...vectorRanked.slice(0, vectorCount), ...matched.slice(0, limit - vectorCount + 1)].map(page => [page.page, page])).values()].slice(0, limit)
    retrievalNote.value = matched.length ? `混合检索命中 ${merged.length} 页` : `向量检索命中 ${merged.length} 页`
    return merged
  }
  if (matched.length) { retrievalNote.value = `已按关键词命中 ${matched.length} 页`; return matched }
  retrievalNote.value = '未命中明确关键词，已提供前几页作为保守上下文'
  return scored.sort((a, b) => a.page - b.page).slice(0, Math.min(3, limit))
}

async function ask() {
  const question = input.value.trim()
  if (!question || loading.value || !pages.value.length) return
  if (!settings.isConfigured) { router.push('/settings'); return }
  const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: question, createdAt: Date.now(), status: 'done' }
  messages.value.push(userMessage)
  const answer: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: Date.now(), status: 'streaming' }
  messages.value.push(answer)
  input.value = ''
  loading.value = true
  error.value = ''
  controller = new AbortController()
  try {
    const isFollowUp = /(它|他|她|这个|上述|上面|刚才|继续|进一步|前者|后者|该内容|这一点)/.test(question) || /^(为什么|怎么做|请展开|再详细|还有呢|然后呢)/.test(question)
    const previousQuestion = messages.value.filter(message => message.role === 'user' && message.id !== userMessage.id).at(-1)?.content
    const retrievalQuery = isFollowUp && previousQuestion ? `${previousQuestion}\n当前问题：${question}` : question
    const contextBudget = Math.max(4000, settings.config.contextCharLimit)
    const retrievalLimit = Math.min(20, Math.max(3, Math.ceil(contextBudget / 6000)))
    const hits = await relevantPages(retrievalQuery, controller.signal, retrievalLimit)
    lastSources.value = hits.map(item => item.page)
    let remaining = contextBudget
    const contextParts: string[] = []
    for (const item of hits) {
      if (remaining <= 0) break
      const text = item.text.slice(0, Math.min(remaining, 6000))
      contextParts.push(`[第 ${item.page} 页]\n${text}`)
      remaining -= text.length
    }
    const context = contextParts.join('\n\n')
    const documentInfo = `[文档信息]\n文件名：${fileName.value}\n总页数：${pageCount.value}`
    const recentHistory = messages.value
      .filter(message => message.id !== userMessage.id && message.id !== answer.id && message.status !== 'error')
      .slice(-6)
      .map(message => ({ role: message.role, content: message.content }))
    await streamChat(settings.config, [
      { role: 'system', content: settings.promptFor('pdf', '你是文档问答助手。只根据提供的 PDF 上下文回答，并在相关句子后标注 [第X页]。没有依据时明确说文档中未找到，不得使用外部知识补写。') },
      ...recentHistory,
      { role: 'user', content: `${documentInfo}\n\nPDF 上下文：\n${context}\n\n问题：${question}` }
    ], token => {
      const current = messages.value.find(message => message.id === answer.id)
      if (current) current.content += token
    }, controller.signal, { purpose: 'pdf', model: settings.modelFor('pdf'), temperature: 0.2 })
    const current = messages.value.find(message => message.id === answer.id)
    if (current) current.status = 'done'
  } catch (cause) {
    const current = messages.value.find(message => message.id === answer.id)
    if (current) current.status = controller.signal.aborted ? 'stopped' : 'error'
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '问答失败'
  } finally { loading.value = false; controller = null }
}

function clearPdf() { controller?.abort(); indexController?.abort(); indexing.value = false; loading.value = false; pages.value = []; pageEmbeddings.value = []; fileName.value = ''; fileSize.value = 0; messages.value = []; error.value = ''; lastSources.value = []; retrievalNote.value = ''; embeddingNotice.value = ''; if (fileInput.value) fileInput.value.value = '' }

function stopGeneration() { controller?.abort() }
onBeforeUnmount(() => { controller?.abort(); indexController?.abort() })
</script>

<template>
  <div class="pdf-page">
    <section class="document-pane">
      <header><div><FileText :size="18" /><strong>文档</strong></div><button v-if="fileName" class="icon-btn" title="移除文档" @click="clearPdf"><X :size="15" /></button></header>
      <button v-if="!fileName && !indexing" type="button" class="drop-zone" aria-label="导入 PDF 文件" @click="fileInput?.click()" @dragover.prevent @drop.prevent="importPdf($event.dataTransfer?.files[0])">
        <span class="upload-icon"><UploadCloud :size="25" /></span><strong>导入 PDF</strong><p>拖放文件到这里，或点击选择</p><small>本地解析，不会上传到应用服务器</small>
        <span v-if="error" class="document-error">{{ error }}</span>
      </button>
      <div v-else-if="indexing" class="index-state"><LoaderCircle class="spin" :size="26" /><strong>正在解析文档</strong><div><i :style="{ width: `${progress}%` }" /></div><small>{{ progress }}%</small></div>
      <div v-else class="document-summary">
        <span><FileCheck2 :size="29" /></span><h3>{{ fileName }}</h3><p>{{ pageCount }} 页 · {{ (fileSize / 1024 / 1024).toFixed(2) }} MB</p>
        <small v-if="embeddingNotice" class="embedding-status">{{ embeddingNotice }}</small><div class="page-preview"><div v-for="page in pages" :key="page.page"><small>第 {{ page.page }} 页</small><p>{{ page.text.slice(0, 130) || '此页没有可提取文本' }}</p></div></div>
      </div>
      <input ref="fileInput" type="file" accept="application/pdf" hidden @change="importPdf(($event.target as HTMLInputElement).files?.[0])" />
    </section>

    <section class="pdf-chat">
      <div v-if="!settings.isConfigured" class="empty-action"><span class="empty-icon"><Settings :size="24" /></span><h3>先配置一个模型</h3><p>PDF 在本地解析，问题与命中的文本片段会发送给你选择的模型。</p><button class="primary-btn" @click="router.push('/settings')">打开设置</button></div>
      <div v-else-if="!fileName" class="empty-action"><span class="empty-icon"><Search :size="24" /></span><h3>与 PDF 对话</h3><p>请先从左侧导入文档。解析完成后即可基于页内文本提问。</p></div>
      <template v-else>
        <div class="pdf-messages"><div v-if="!messages.length" class="pdf-ready"><Search :size="24" /><h3>文档已准备好</h3><p>试着询问摘要、关键结论或某个具体概念。</p></div><MessageBubble v-for="message in messages" :key="message.id" :message="message" /></div>
        <footer class="pdf-composer"><span v-if="lastSources.length" class="sources">引用页：{{ lastSources.join('、') }} · {{ retrievalNote }}</span><span v-if="error" class="pdf-error">{{ error }}</span><div><textarea v-model="input" rows="1" placeholder="基于当前 PDF 提问…" @keydown.enter.exact.prevent="ask" /><button v-if="loading" title="停止" @click="stopGeneration"><Square :size="14" /></button><button v-else :disabled="!input.trim()" title="发送" @click="ask"><Send :size="16" /></button></div></footer>
      </template>
    </section>
  </div>
</template>

<style scoped>
.pdf-page { height: 100%; min-height: 0; display: grid; grid-template-columns: minmax(300px, 42%) minmax(0, 1fr); background: var(--surface); color: var(--ink); }
.document-pane { min-height: 0; border-right: 1px solid var(--line); background: var(--canvas); display: grid; grid-template-rows: 52px minmax(0, 1fr); }
.document-pane > header { padding: 0 14px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; }
.document-pane > header > div { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.drop-zone { margin: 22px; border: 1px dashed #9ca7b3; border-radius: 8px; display: grid; place-content: center; justify-items: center; text-align: center; cursor: pointer; background: var(--surface); }
.drop-zone:hover { border-color: var(--green); background: var(--subtle); }
.drop-zone > .upload-icon { width: 50px; height: 50px; display: grid; place-items: center; border-radius: 8px; color: var(--green); background: var(--green-soft); margin-bottom: 13px; }
.drop-zone strong { font-size: 14px; }.drop-zone p { color: var(--muted); margin: 6px 0; font-size: 11px; }.drop-zone small { color: #9aa2ad; font-size: 9px; }
.document-error { display: block; max-width: 320px; margin: 14px 0 0; padding: 10px 12px; color: #c55c5c; background: color-mix(in srgb, var(--surface) 88%, #ef9b9b); border: 1px solid #d98f8f; border-radius: 6px; font-size: 11px; line-height: 1.5; }
.index-state { display: grid; place-content: center; justify-items: center; gap: 11px; color: var(--green); }
.index-state strong { color: var(--ink); font-size: 13px; }.index-state > div { width: 220px; height: 6px; background: #e2e6e9; border-radius: 6px; overflow: hidden; }.index-state i { display: block; height: 100%; background: var(--green); }.index-state small { color: var(--muted); }
.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
.document-summary { min-height: 0; overflow: auto; padding: 24px; text-align: center; }
.document-summary > span { margin: 0 auto; width: 52px; height: 52px; display: grid; place-items: center; color: #b94848; background: #fbeaea; border-radius: 8px; }
.document-summary h3 { margin: 12px auto 4px; max-width: 320px; font-size: 13px; overflow-wrap: anywhere; }.document-summary > p { color: var(--muted); font-size: 10px; }
.embedding-status { display: block; color: #52705e; margin-top: 9px; font-size: 9px; line-height: 1.45; }
.page-preview { margin-top: 22px; display: grid; gap: 8px; text-align: left; }.page-preview > div { content-visibility: auto; contain-intrinsic-size: auto 88px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 11px; }.page-preview small { color: var(--green); font-size: 9px; font-weight: 700; }.page-preview p { margin: 5px 0 0; color: var(--muted); font-size: 9px; line-height: 1.5; }
.pdf-chat { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.pdf-messages { min-height: 0; overflow: auto; }.pdf-ready { min-height: 100%; display: grid; place-content: center; justify-items: center; text-align: center; color: var(--green); }.pdf-ready h3 { color: var(--ink); margin: 12px 0 6px; font-size: 17px; }.pdf-ready p { color: var(--muted); margin: 0; font-size: 11px; }
.pdf-composer { padding: 10px 16px 14px; }.pdf-composer > div { display: grid; grid-template-columns: 1fr 38px; border: 1px solid var(--line); border-radius: 7px; padding: 4px; }.pdf-composer textarea { border: 0; outline: 0; resize: none; padding: 8px; font-size: 11px; color: var(--ink); background: transparent; }.pdf-composer button { border: 0; border-radius: 5px; color: white; background: var(--green); }.pdf-composer button:disabled { background: #7e8792; }.sources, .pdf-error { display: block; margin-bottom: 6px; font-size: 9px; }.sources { color: var(--muted); }.pdf-error { color: #d66767; }
@media (max-width: 760px) { .pdf-page { display: block; overflow: auto; }.document-pane { height: min(52vh, 520px); min-height: 330px; border-right: 0; border-bottom: 1px solid var(--line); }.pdf-chat { min-height: 500px; }.drop-zone { min-height: 250px; } }
</style>
