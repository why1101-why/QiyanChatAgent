import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ChatMessage, Conversation } from '@/types'

const STORAGE_KEY = 'chat-agent:conversations:v1'

function load(): Conversation[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}

function persistenceSnapshot(items: Conversation[]) {
  return items.map(conversation => ({
    ...conversation,
    messages: conversation.messages.map(message => ({
      ...message,
      attachments: message.attachments?.map(({ dataUrl: _dataUrl, ...attachment }) => attachment)
    }))
  }))
}

export const useConversationStore = defineStore('conversations', () => {
  const items = ref<Conversation[]>(load())
  watch(items, value => localStorage.setItem(STORAGE_KEY, JSON.stringify(persistenceSnapshot(value))), { deep: true })

  function create(feature: Conversation['feature'], title: string) {
    const item: Conversation = { id: crypto.randomUUID(), feature, title, messages: [], updatedAt: Date.now() }
    items.value.unshift(item)
    return item
  }

  function get(id: string) { return items.value.find(item => item.id === id) }
  function byFeature(feature: Conversation['feature']) { return items.value.filter(item => item.feature === feature) }
  function addMessage(id: string, message: ChatMessage) {
    const item = get(id)
    if (!item) return
    item.messages.push(message)
    item.updatedAt = Date.now()
  }
  function appendMessageContent(id: string, messageId: string, token: string) {
    const item = get(id)
    const message = item?.messages.find(entry => entry.id === messageId)
    if (!item || !message) return
    message.content += token
    item.updatedAt = Date.now()
  }
  function updateMessage(id: string, messageId: string, patch: Partial<ChatMessage>) {
    const item = get(id)
    const message = item?.messages.find(entry => entry.id === messageId)
    if (!item || !message) return
    Object.assign(message, patch)
    item.updatedAt = Date.now()
  }
  function remove(id: string) { items.value = items.value.filter(item => item.id !== id) }

  return { items, create, get, byFeature, addMessage, appendMessageContent, updateMessage, remove }
})
