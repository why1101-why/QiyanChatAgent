<script setup lang="ts">
import { computed } from 'vue'
import ChatWorkspace from '@/components/ChatWorkspace.vue'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const systemPrompt = computed(() => settings.promptFor('chat', '你是栖言，一个专业、友善、准确的中文 AI 助手。先给结论，再给必要解释；不确定时明确说明，不编造事实。'))
</script>

<template>
  <ChatWorkspace
    feature="chat"
    title="AI 聊天"
    description="从一个问题开始，我会保持上下文并流式回复。"
    :system-prompt="systemPrompt"
    :suggestions="['帮我整理今天的工作计划', '解释一个技术概念', '润色一段中文文案']"
  />
</template>
