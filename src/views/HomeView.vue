<script setup lang="ts">
import { ArrowRight, Bot, Check, FileText, HeartHandshake, MessageCircle, NotebookPen, Settings, ShieldCheck } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'

const router = useRouter()
const settings = useSettingsStore()

const features = [
  { title: 'AI 聊天', desc: '流式多轮对话，专注写作、分析与日常问答。', path: '/chat', icon: MessageCircle, tone: 'green', meta: '通用助手' },
  { title: '灵感笔记', desc: '随手记录想法，让 AI 帮你整理、续写与提炼重点。', path: '/notes', icon: NotebookPen, tone: 'blue', meta: '本地创作' },
  { title: '哄哄模拟器', desc: '进入情境对话，在每一次回应里改变好感度。', path: '/game', icon: HeartHandshake, tone: 'rose', meta: '互动游戏' },
  { title: 'ChatPDF', desc: '导入 PDF，在原文依据和页码引用中寻找答案。', path: '/pdf', icon: FileText, tone: 'amber', meta: '文档问答' }
]
</script>

<template>
  <div class="page home-page">
    <div class="page-limit">
      <section class="welcome-row">
        <div>
          <h2>今天想让 AI 帮你做什么？</h2>
          <p>选择一个工作区开始，所有会话都保存在这台设备上。</p>
        </div>
        <div :class="['setup-state', { ready: settings.isVerified }]">
          <span class="state-icon"><component :is="settings.isVerified ? Check : Settings" :size="18" /></span>
          <span><strong>{{ settings.isVerified ? '模型已就绪' : settings.isConfigured ? '模型等待测试' : '需要配置模型' }}</strong><small>{{ settings.isConfigured ? `${settings.config.providerName} · ${settings.config.chatModel}` : '首次使用前完成供应商连接' }}</small></span>
          <button class="secondary-btn" @click="router.push('/settings')">{{ settings.isConfigured ? '管理' : '去设置' }}</button>
        </div>
      </section>

      <div class="section-label">核心功能</div>
      <section class="feature-list">
        <button v-for="(feature, index) in features" :key="feature.path" class="feature-row" @click="router.push(feature.path)">
          <span class="feature-number">0{{ index + 1 }}</span>
          <span :class="['feature-icon', feature.tone]"><component :is="feature.icon" :size="22" /></span>
          <span class="feature-copy"><small>{{ feature.meta }}</small><strong>{{ feature.title }}</strong><span>{{ feature.desc }}</span></span>
          <ArrowRight class="feature-arrow" :size="20" />
        </button>
      </section>

      <section class="privacy-bar">
        <ShieldCheck :size="19" />
        <div><strong>本地优先</strong><span>配置和会话仅保存在当前设备；模型请求发送到你选择的供应商。</span></div>
        <Bot :size="20" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.home-page { display: grid; align-items: center; }
.welcome-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 34px; }
.welcome-row h2 { font-size: 27px; margin: 0 0 8px; }
.welcome-row p { color: var(--muted); margin: 0; font-size: 14px; }
.setup-state { min-width: 340px; display: grid; grid-template-columns: 36px 1fr auto; gap: 10px; align-items: center; padding: 11px 12px; border: 1px solid #d8b879; background: color-mix(in srgb, var(--surface) 88%, #ffd98a); border-radius: 8px; }
.setup-state.ready { border-color: #79bc94; background: color-mix(in srgb, var(--surface) 88%, #8ed8aa); }
.state-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 7px; color: #a66a00; background: #ffedc8; }
.ready .state-icon { color: var(--green); background: #dff4e7; }
.setup-state strong, .setup-state small { display: block; }
.setup-state strong { font-size: 12px; }
.setup-state small { color: var(--muted); margin-top: 3px; font-size: 10px; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.setup-state .secondary-btn { min-height: 32px; font-size: 11px; padding-inline: 11px; }
.feature-list { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.feature-row { position: relative; width: 100%; border: 0; border-bottom: 1px solid var(--line); background: var(--surface); color: var(--ink); display: grid; grid-template-columns: 40px 48px 1fr 30px; gap: 16px; align-items: center; padding: 20px 22px; text-align: left; transition: .18s ease; }
.feature-row:last-child { border-bottom: 0; }
.feature-row:hover { background: var(--subtle); }
.feature-number { color: #b6bcc5; font: 600 11px/1 ui-monospace, monospace; }
.feature-icon { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 7px; }
.feature-icon.green { color: #078d49; background: #e5f6ec; }
.feature-icon.rose { color: #c54762; background: #fbeaec; }
.feature-icon.blue { color: #3477ad; background: #e9f2f9; }
.feature-icon.amber { color: #a66a00; background: #fcf1d9; }
.feature-copy { display: grid; grid-template-columns: 110px 150px 1fr; align-items: baseline; gap: 14px; min-width: 0; }
.feature-copy small { color: #8c95a2; font-size: 10px; text-transform: uppercase; font-weight: 700; }
.feature-copy strong { font-size: 15px; }
.feature-copy > span { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.feature-arrow { color: #aeb5bf; transition: .18s ease; }
.feature-row:hover .feature-arrow { color: var(--green); transform: translateX(3px); }
.privacy-bar { display: flex; align-items: center; gap: 12px; margin-top: 24px; color: #6c7582; padding: 0 4px; }
.privacy-bar > svg:first-child { color: var(--green); }
.privacy-bar > svg:last-child { margin-left: auto; color: #c1c6cd; }
.privacy-bar strong { font-size: 11px; margin-right: 10px; color: #343c48; }
.privacy-bar span { font-size: 11px; }
@media (max-width: 900px) {
  .welcome-row { align-items: stretch; flex-direction: column; }
  .setup-state { min-width: 0; }
  .feature-copy { grid-template-columns: 90px 130px 1fr; }
}
@media (max-width: 680px) {
  .welcome-row { margin-bottom: 25px; }
  .feature-row { grid-template-columns: 36px 1fr 24px; gap: 12px; padding: 16px; }
  .feature-number { display: none; }
  .feature-copy { display: flex; flex-direction: column; gap: 3px; }
  .feature-copy small { order: 2; }
  .feature-copy strong { order: 1; }
  .feature-copy > span { display: none; }
  .privacy-bar span { display: none; }
}
</style>
