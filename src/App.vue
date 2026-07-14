<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, FileText, HeartHandshake, Home, MessageCircle, NotebookPen, Settings, X } from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import ReleaseNotice from '@/components/ReleaseNotice.vue'
import { useSettingsStore } from '@/stores/settings'
import { APP_INFO, RELEASE_NOTICE_STORAGE_KEY } from '@/appInfo'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const noticeOpen = ref(false)
const noticeSeen = ref(true)
const isDesktop = Boolean(window.desktopAPI)
let noticeTrigger: HTMLElement | null = null

const nav = [
  { label: '首页', path: '/', icon: Home },
  { label: 'AI 聊天', path: '/chat', icon: MessageCircle },
  { label: '灵感笔记', path: '/notes', icon: NotebookPen },
  { label: '哄哄模拟器', path: '/game', icon: HeartHandshake },
  { label: 'ChatPDF', path: '/pdf', icon: FileText }
]

const pageTitle = computed(() => nav.find(item => item.path === route.path)?.label || (route.path === '/settings' ? '设置' : '栖言'))
const isSettings = computed(() => route.path === '/settings')

function hasSeenCurrentRelease() {
  try {
    return localStorage.getItem(RELEASE_NOTICE_STORAGE_KEY) === APP_INFO.version
  } catch {
    return false
  }
}

function markCurrentReleaseSeen() {
  noticeSeen.value = true
  try {
    localStorage.setItem(RELEASE_NOTICE_STORAGE_KEY, APP_INFO.version)
  } catch {
    // The notice remains usable when storage is unavailable.
  }
}

function openNotice(event?: MouseEvent) {
  noticeTrigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  noticeOpen.value = true
}

function dismissNotice() {
  const trigger = noticeTrigger
  noticeTrigger = null
  markCurrentReleaseSeen()
  noticeOpen.value = false
  void nextTick(() => trigger?.focus())
}

function completeNotice() {
  markCurrentReleaseSeen()
  noticeOpen.value = false
  noticeTrigger = null
  void router.push(settings.isConfigured ? '/' : '/settings')
}

async function initializeApp() {
  try {
    await settings.initialize()
  } finally {
    noticeSeen.value = hasSeenCurrentRelease()
    if (!noticeSeen.value) {
      await nextTick()
      noticeOpen.value = true
    }
  }
}

void initializeApp().catch(error => console.error('设置初始化失败', error))
</script>

<template>
  <div :class="['app-shell', { 'settings-mode': isSettings }]">
    <aside v-if="!isSettings" class="app-sidebar">
      <button class="brand" aria-label="返回首页" @click="router.push('/')">
        <BrandMark class="brand-mark" :size="36" />
        <span><strong>栖言</strong><small>Qiyan AI 工作台</small></span>
      </button>

      <nav class="main-nav" aria-label="主导航">
        <button v-for="item in nav" :key="item.path" :class="['nav-item', { active: route.path === item.path }]" @click="router.push(item.path)">
          <component :is="item.icon" :size="19" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <button
          class="nav-item notice-nav"
          title="通知"
          :aria-label="noticeSeen ? '查看通知' : '通知，有新内容'"
          aria-haspopup="dialog"
          aria-controls="release-notice-dialog"
          :aria-expanded="noticeOpen"
          data-testid="sidebar-notice-button"
          @click="openNotice"
        >
          <span class="notice-icon"><Bell :size="19" /><i v-if="!noticeSeen" aria-hidden="true" /></span><span>通知</span>
        </button>
        <button :class="['nav-item', { active: route.path === '/settings' }]" @click="router.push('/settings')">
          <Settings :size="19" /><span>设置</span>
        </button>
      </div>
    </aside>

    <main class="app-main">
      <header class="topbar">
        <div class="topbar-title"><span class="mobile-brand"><BrandMark :size="20" /></span><h1>{{ pageTitle }}</h1></div>
        <div class="topbar-actions">
          <button
            v-if="!isSettings"
            class="topbar-notice"
            title="通知"
            :aria-label="noticeSeen ? '查看通知' : '通知，有新内容'"
            aria-haspopup="dialog"
            aria-controls="release-notice-dialog"
            :aria-expanded="noticeOpen"
            data-testid="mobile-notice-button"
            @click="openNotice"
          >
            <Bell :size="18" /><i v-if="!noticeSeen" aria-hidden="true" />
          </button>
          <button v-if="!isSettings" class="model-chip" @click="router.push('/settings')">
            <span :class="['status-dot', { ready: settings.isVerified }]" />
            <span class="model-chip-label">{{ settings.isConfigured ? `${settings.config.chatModel}${settings.isVerified ? '' : ' · 待测试'}` : '配置模型' }}</span>
          </button>
          <button v-else class="topbar-close" title="关闭设置" aria-label="关闭设置" @click="router.push('/')"><X :size="19" /></button>
        </div>
      </header>
      <div class="route-stage"><RouterView /></div>
    </main>
  </div>
  <ReleaseNotice
    :open="noticeOpen"
    :is-configured="settings.isConfigured"
    :is-desktop="isDesktop"
    @dismiss="dismissNotice"
    @primary="completeNotice"
  />
</template>
