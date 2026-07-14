<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Heart, LoaderCircle, RefreshCw, Send, Settings, Sparkles, Square } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { streamChat } from '@/services/model'
import type { ChatMessage, GameResult } from '@/types'
import MessageBubble from '@/components/MessageBubble.vue'

const router = useRouter()
const settings = useSettingsStore()
const stage = ref<'setup' | 'playing' | 'won' | 'lost'>('setup')
const reason = ref('')
const score = ref(50)
const turn = ref(0)
const input = ref('')
const loading = ref(false)
const error = ref('')
const messages = ref<ChatMessage[]>([])
let controller: AbortController | null = null

const scoreTone = computed(() => score.value >= 70 ? 'good' : score.value <= 30 ? 'bad' : 'normal')
const systemPrompt = computed(() => settings.promptFor('game', `你正在主持“哄哄模拟器”。生气原因：${reason.value || '自行设定一个生活化且不过分的原因'}。当前好感度：${score.value}/100。根据用户回复判断态度变化。请只输出一个 JSON 对象：{"reply":"自然的角色回复","scoreDelta":-15到15的整数,"reason":"一句评分原因"}。不要输出代码围栏。不要自行宣布胜负，胜负由本地分数决定。`))

function start() {
  if (!settings.isConfigured) { router.push('/settings'); return }
  score.value = 50
  turn.value = 0
  messages.value = []
  stage.value = 'playing'
  error.value = ''
  messages.value.push({ id: crypto.randomUUID(), role: 'assistant', content: reason.value ? `你还知道我为什么生气？那你说说，打算怎么办。` : '我现在不太想理你。你最好认真想想是哪里做错了。', createdAt: Date.now(), status: 'done' })
}

function reset() { controller?.abort(); stage.value = 'setup'; messages.value = []; input.value = ''; error.value = '' }

function stopGeneration() { controller?.abort() }

function fallbackResult(raw: string, userText: string): GameResult {
  const positive = /(对不起|抱歉|理解|在乎|改正|补偿|谢谢|爱你|陪你)/g
  const negative = /(随便|无所谓|你也|别闹|烦|闭嘴|都是你)/g
  const positiveCount = (userText.match(positive) || []).length
  const negativeCount = (userText.match(negative) || []).length
  const scoreDelta = Math.max(-12, Math.min(12, positiveCount * 4 - negativeCount * 6 + (userText.length >= 18 ? 2 : -1)))
  return {
    reply: raw.trim() || (scoreDelta >= 0 ? '我听到了，但我更想看到你接下来怎么做。' : '你这样说只会让我更难受。'),
    scoreDelta,
    reason: '模型未返回标准结构，已使用本地规则完成本回合结算。',
    gameOver: false,
    ending: 'continue'
  }
}

function parseResult(raw: string, userText: string): GameResult {
  const normalized = raw.replace(/```json|```/g, '').trim()
  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')
  if (start < 0 || end < 0) return fallbackResult(raw, userText)
  try {
    const parsed = JSON.parse(normalized.slice(start, end + 1))
    const reply = String(parsed.reply || parsed.response || parsed.message || '').trim()
    const scoreDelta = Number(parsed.scoreDelta ?? parsed.score_delta ?? parsed.delta)
    if (!reply || !Number.isFinite(scoreDelta)) return fallbackResult(raw, userText)
    return {
      reply,
      scoreDelta: Math.max(-15, Math.min(15, Math.round(scoreDelta))),
      reason: String(parsed.reason || parsed.explanation || '根据本回合表达进行调整。'),
      gameOver: false,
      ending: 'continue'
    }
  } catch { return fallbackResult(raw, userText) }
}

function completeTurn(result: GameResult) {
  const nextScore = Math.max(0, Math.min(100, score.value + result.scoreDelta))
  score.value = nextScore
  turn.value += 1
  messages.value.push({ id: crypto.randomUUID(), role: 'assistant', content: `${result.reply}\n\n> 本回合 ${result.scoreDelta >= 0 ? '+' : ''}${result.scoreDelta}：${result.reason}`, createdAt: Date.now(), status: 'done' })
  if (nextScore >= 100) stage.value = 'won'
  if (nextScore <= 0) stage.value = 'lost'
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return
  messages.value.push({ id: crypto.randomUUID(), role: 'user', content: text, createdAt: Date.now(), status: 'done' })
  input.value = ''
  loading.value = true
  error.value = ''
  controller = new AbortController()
  let raw = ''
  try {
    await streamChat(settings.config, [
      { role: 'system', content: systemPrompt.value },
      ...messages.value.slice(-8).map(item => ({ role: item.role, content: item.content }))
    ], token => raw += token, controller.signal, { purpose: 'game', model: settings.modelFor('game'), responseFormat: 'json', temperature: 0.8 })
    completeTurn(parseResult(raw, text))
  } catch (cause) {
    if (!controller.signal.aborted) {
      completeTurn(fallbackResult('', text))
      error.value = `AI 请求失败，本回合已使用本地规则：${cause instanceof Error ? cause.message : '未知错误'}`
    }
  } finally { loading.value = false; controller = null }
}

onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="game-page">
    <section v-if="stage === 'setup'" class="game-setup">
      <div class="game-art"><Heart :size="36" /><span class="pulse one" /><span class="pulse two" /></div>
      <h2>哄哄模拟器</h2><p>每句话都会改变好感度。认真回应，试着把关系从 50 分带回 100 分。</p>
      <div class="field"><label>她为什么生气？</label><textarea v-model="reason" rows="3" placeholder="可以留空，让 AI 随机生成一个生活化情境" /></div>
      <button class="primary-btn" @click="start"><Sparkles :size="16" />开始游戏</button>
    </section>

    <section v-else class="game-session">
      <header class="game-status">
        <div><small>当前回合</small><strong>{{ turn + 1 }}</strong></div>
        <div class="score-wrap"><span><Heart :size="15" fill="currentColor" />好感度</span><div class="score-track"><i :class="scoreTone" :style="{ width: `${score}%` }" /></div><strong>{{ score }}</strong></div>
        <button class="secondary-btn" @click="reset"><RefreshCw :size="14" />重新开始</button>
      </header>
      <div class="game-chat">
        <MessageBubble v-for="message in messages" :key="message.id" :message="message" />
        <div v-if="stage === 'won' || stage === 'lost'" :class="['ending', stage]"><Heart :size="24" /><strong>{{ stage === 'won' ? '和好成功' : '关系破裂' }}</strong><span>{{ stage === 'won' ? '你的认真回应打动了她。' : '这次没有挽回局面，再试一次吧。' }}</span><button class="secondary-btn" @click="reset">再玩一次</button></div>
      </div>
      <footer v-if="stage === 'playing'" class="game-composer">
        <span v-if="error" class="game-error">{{ error }}</span>
        <div><textarea v-model="input" rows="1" placeholder="认真想想该怎么回应…" @keydown.enter.exact.prevent="send" /><button v-if="loading" title="停止" @click="stopGeneration"><Square :size="14" /></button><button v-else :disabled="!input.trim()" title="发送" @click="send"><Send :size="16" /></button></div>
      </footer>
    </section>
    <button v-if="!settings.isConfigured && stage === 'setup'" class="config-hint" @click="router.push('/settings')"><Settings :size="14" />开始前请先配置模型</button>
  </div>
</template>

<style scoped>
.game-page { min-height: 100%; position: relative; display: grid; place-items: center; background: var(--canvas); color: var(--ink); }
.game-setup { width: min(440px, calc(100% - 30px)); text-align: center; }
.game-art { position: relative; width: 76px; height: 76px; margin: 0 auto 20px; display: grid; place-items: center; color: #d84d67; background: #fbe7eb; border-radius: 50%; }
.game-art .pulse { position: absolute; border: 1px solid #e9a1af; border-radius: 50%; inset: -9px; animation: pulse 2.5s ease-out infinite; }
.game-art .two { animation-delay: 1.25s; }
@keyframes pulse { 0% { opacity: .8; transform: scale(.9); } 100% { opacity: 0; transform: scale(1.35); } }
.game-setup h2 { margin: 0 0 8px; font-size: 24px; }
.game-setup > p { color: var(--muted); font-size: 13px; line-height: 1.65; margin: 0 0 22px; }
.game-setup .field { text-align: left; margin-bottom: 14px; }
.game-setup textarea { resize: vertical; }
.game-setup .primary-btn { width: 100%; }
.config-hint { position: absolute; bottom: 20px; border: 0; background: transparent; color: #a14c4c; display: flex; gap: 6px; align-items: center; font-size: 11px; }
.game-session { width: min(860px, 100%); height: 100%; min-height: 0; display: grid; grid-template-rows: 64px minmax(0, 1fr) auto; background: var(--surface); border-inline: 1px solid var(--line); }
.game-status { display: grid; grid-template-columns: 90px 1fr 130px; align-items: center; padding: 0 18px; border-bottom: 1px solid var(--line); }
.game-status > div:first-child small, .game-status > div:first-child strong { display: block; }
.game-status > div:first-child small { color: #939ba6; font-size: 9px; }
.game-status > div:first-child strong { margin-top: 2px; font-size: 15px; }
.game-status .secondary-btn { min-height: 32px; font-size: 10px; }
.score-wrap { display: grid; grid-template-columns: auto minmax(100px, 280px) 30px; gap: 10px; justify-content: center; align-items: center; color: #c4455d; font-size: 10px; }
.score-wrap > span { display: flex; align-items: center; gap: 5px; }
.score-track { height: 6px; border-radius: 6px; background: #eceef0; overflow: hidden; }
.score-track i { display: block; height: 100%; border-radius: inherit; background: #d28455; transition: width .45s ease; }
.score-track i.good { background: var(--green); }.score-track i.bad { background: #d94747; }
.game-chat { min-height: 0; overflow: auto; }
.game-composer { padding: 12px 18px 16px; border-top: 1px solid var(--line); }
.game-composer > div { display: grid; grid-template-columns: 1fr 38px; border: 1px solid #d9dde2; border-radius: 7px; padding: 4px; }
.game-composer textarea { resize: none; border: 0; outline: 0; padding: 8px; font-size: 12px; color: var(--ink); background: transparent; }
.game-composer button { border: 0; border-radius: 5px; color: white; background: #d34f68; }
.game-composer button:disabled { background: #ccd1d7; }
.game-error { display: block; margin-bottom: 7px; color: #b23d3d; font-size: 10px; }
.ending { margin: 20px; border: 1px solid var(--line); border-radius: 8px; padding: 22px; display: grid; justify-items: center; gap: 7px; text-align: center; }
.ending.won { color: var(--green-dark); background: #f1faf4; border-color: #c3e6d0; }.ending.lost { color: #a43939; background: #fff4f4; border-color: #efcaca; }
.ending strong { font-size: 16px; }.ending span { font-size: 11px; }.ending button { margin-top: 7px; }
@media (max-width: 600px) { .game-status { grid-template-columns: 55px 1fr 42px; padding-inline: 10px; }.game-status .secondary-btn { width: 34px; padding: 0; }.game-status .secondary-btn :deep(span) { display: none; }.score-wrap > span { display: none; }.score-wrap { grid-template-columns: 1fr 28px; }.game-status button { font-size: 0; } }
</style>
