<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Bot, CheckCircle2, FileText, HeartHandshake, MessageCircle, NotebookPen, Paperclip,
  Settings2, ShieldCheck, Sparkles, X
} from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import { APP_INFO } from '@/appInfo'

const props = defineProps<{
  open: boolean
  isConfigured: boolean
  isDesktop: boolean
}>()

const emit = defineEmits<{
  dismiss: []
  primary: []
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const primaryLabel = computed(() => props.isConfigured ? '开始使用' : '配置模型')

const updates = [
  { title: '图片与音频识别', text: 'AI 聊天支持点击、粘贴或拖拽添加附件，并可在发送前预览和移除。', icon: Paperclip },
  { title: '灵感笔记', text: '支持本地自动保存、Markdown 预览，以及 AI 整理、摘要、润色与续写。', icon: NotebookPen },
  { title: '模型配置列表', text: '可以保存多套供应商与模型参数，并随时切换当前使用的模型。', icon: Settings2 },
  { title: '完整 PDF 阅读', text: 'ChatPDF 现在会展示全部页面，并可依据文档原文连续问答。', icon: FileText }
]

const steps = [
  { title: '配置模型', text: '在设置中填写供应商、API Key 和模型名称。' },
  { title: '测试并保存', text: '确认连接可用，再将它设为当前模型。' },
  { title: '选择工作区', text: '返回首页，打开一项功能开始使用。' }
]

const features = [
  { title: 'AI 聊天', text: '自由问答、写作与分析', icon: MessageCircle },
  { title: '灵感笔记', text: '记录、整理与继续创作', icon: NotebookPen },
  { title: '哄哄模拟器', text: '在情境对话中练习表达', icon: HeartHandshake },
  { title: 'ChatPDF', text: '浏览完整文档并依据原文问答', icon: Bot }
]

function syncDialogState(open = props.open) {
  const element = dialog.value
  if (!element) return
  if (open && !element.open) {
    element.showModal()
    void nextTick(() => element.focus({ preventScroll: true }))
  } else if (!open && element.open) {
    element.close()
  }
}

function handleBackdrop(event: MouseEvent) {
  if (event.target === dialog.value) emit('dismiss')
}

watch(() => props.open, value => {
  void nextTick(() => syncDialogState(value))
})

onMounted(() => syncDialogState())
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog
    id="release-notice-dialog"
    ref="dialog"
    class="release-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="release-notice-title"
    aria-describedby="release-notice-intro"
    tabindex="-1"
    data-testid="release-notice"
    @click="handleBackdrop"
    @cancel.prevent="emit('dismiss')"
  >
    <header class="release-header">
      <BrandMark :size="44" />
      <div>
        <h2 id="release-notice-title">欢迎使用栖言</h2>
        <p>{{ APP_INFO.englishName }} {{ APP_INFO.version }}</p>
      </div>
      <button type="button" class="release-close" aria-label="关闭欢迎通知" @click="emit('dismiss')">
        <X :size="19" />
      </button>
    </header>

    <div class="release-content">
      <p id="release-notice-intro" class="release-intro">
        感谢你的使用。希望栖言能安静地陪你聊天、记录想法，也帮你更轻松地阅读和整理内容。
      </p>

      <section class="release-section" aria-labelledby="release-updates-title">
        <div class="release-section-title">
          <Sparkles :size="18" />
          <div><h3 id="release-updates-title">本次更新</h3><p>最近完成的主要改进</p></div>
        </div>
        <ul class="release-update-list">
          <li v-for="item in updates" :key="item.title">
            <span><component :is="item.icon" :size="17" /></span>
            <div><strong>{{ item.title }}</strong><p>{{ item.text }}</p></div>
          </li>
        </ul>
      </section>

      <section class="release-section" aria-labelledby="release-steps-title">
        <div class="release-section-title">
          <CheckCircle2 :size="18" />
          <div><h3 id="release-steps-title">三步开始使用</h3><p>先连接自己的模型服务</p></div>
        </div>
        <ol class="release-steps">
          <li v-for="(step, index) in steps" :key="step.title">
            <span>{{ index + 1 }}</span>
            <div><strong>{{ step.title }}</strong><p>{{ step.text }}</p></div>
          </li>
        </ol>
        <p class="release-security"><ShieldCheck :size="15" />{{ isDesktop ? 'API Key 使用 Windows 加密存储，不会写入导出备份。' : '浏览器预览不会持久保存 API Key。' }}</p>
      </section>

      <section class="release-section" aria-labelledby="release-features-title">
        <div class="release-section-title">
          <Bot :size="18" />
          <div><h3 id="release-features-title">四个工作区</h3><p>按当前任务选择合适的入口</p></div>
        </div>
        <div class="release-feature-grid">
          <div v-for="feature in features" :key="feature.title" class="release-feature">
            <span><component :is="feature.icon" :size="18" /></span>
            <div><strong>{{ feature.title }}</strong><p>{{ feature.text }}</p></div>
          </div>
        </div>
      </section>
    </div>

    <footer class="release-footer">
      <p>以后可从“通知”按钮再次查看</p>
      <div>
        <button type="button" class="secondary-btn" @click="emit('dismiss')">稍后查看</button>
        <button type="button" class="primary-btn" @click="emit('primary')">{{ primaryLabel }}</button>
      </div>
    </footer>
  </dialog>
</template>

<style scoped>
.release-dialog { width: min(700px, calc(100vw - 32px)); max-width: 700px; max-height: calc(100dvh - 32px); margin: auto; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); box-shadow: 0 24px 70px rgba(18, 25, 34, .22); overflow: hidden; }
.release-dialog[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; animation: release-in .18s ease-out; }
.release-dialog:focus { outline: none; }
.release-dialog::backdrop { background: rgba(20, 27, 38, .42); }
.release-header { min-height: 76px; display: grid; grid-template-columns: 44px minmax(0, 1fr) 34px; gap: 13px; align-items: center; padding: 15px 20px; border-bottom: 1px solid var(--line); }
.release-header h2 { margin: 0; font-size: 19px; line-height: 1.3; }
.release-header p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.release-close { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--muted); }
.release-close:hover { color: var(--ink); background: var(--hover); }
.release-content { min-height: 0; overflow-y: auto; padding: 22px 26px 4px; }
.release-intro { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.75; }
.release-section { padding: 21px 0; border-top: 1px solid var(--line); }
.release-intro + .release-section { margin-top: 18px; }
.release-section-title { display: flex; gap: 9px; align-items: flex-start; margin-bottom: 15px; color: var(--green); }
.release-section-title h3 { margin: 0; color: var(--ink); font-size: 15px; line-height: 1.35; }
.release-section-title p { margin: 3px 0 0; color: var(--muted); font-size: 11px; }
.release-update-list { list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px 22px; margin: 0; padding: 0; }
.release-update-list li, .release-feature { min-width: 0; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 10px; align-items: flex-start; }
.release-update-list li > span, .release-feature > span { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 7px; background: var(--green-soft); color: var(--green-dark); }
.release-update-list strong, .release-feature strong, .release-steps strong { display: block; font-size: 13px; line-height: 1.4; }
.release-update-list p, .release-feature p, .release-steps p { margin: 3px 0 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
.release-steps { list-style: none; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 0; padding: 0; }
.release-steps li { min-width: 0; display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 9px; align-items: flex-start; }
.release-steps li > span { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid #9ed3b4; border-radius: 50%; color: var(--green-dark); font-size: 11px; font-weight: 750; }
.release-security { display: flex; align-items: center; gap: 7px; margin: 15px 0 0; color: var(--muted); font-size: 11px; }
.release-security svg { flex: 0 0 auto; color: var(--green); }
.release-feature-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px 24px; }
.release-footer { min-height: 68px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 14px 20px; border-top: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 96%, var(--canvas)); }
.release-footer p { margin: 0; color: var(--muted); font-size: 11px; }
.release-footer > div { display: flex; gap: 9px; }
.release-footer button { min-height: 38px; }
.release-dialog button:focus-visible { outline: 3px solid color-mix(in srgb, var(--green) 30%, transparent); outline-offset: 2px; }
@keyframes release-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 620px) {
  .release-dialog { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); }
  .release-content { padding: 18px 18px 2px; }
  .release-update-list, .release-feature-grid, .release-steps { grid-template-columns: 1fr; }
  .release-footer { grid-template-columns: 1fr; gap: 10px; padding: 12px 18px; }
  .release-footer > div { display: grid; grid-template-columns: 1fr 1fr; }
  .release-footer button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .release-dialog[open] { animation: none; } }
</style>
