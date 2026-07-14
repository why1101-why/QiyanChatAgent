import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { InspirationNote, NoteFolder } from '@/types'

const STORAGE_KEY = 'qiyan:notes:v1'
const SAVE_DELAY = 350

type StoredNotes = {
  version: 1
  notes: InspirationNote[]
  folders: NoteFolder[]
}

function text(value: unknown, maxLength: number) {
  return String(value ?? '').slice(0, maxLength)
}

function normalizeFolder(value: Partial<NoteFolder>): NoteFolder | null {
  const id = text(value.id, 120).trim()
  const name = text(value.name, 60).trim()
  if (!id || !name) return null
  return { id, name, createdAt: Number(value.createdAt) || Date.now() }
}

function normalizeNote(value: Partial<InspirationNote>, folderIds: Set<string>): InspirationNote | null {
  const id = text(value.id, 120).trim()
  if (!id) return null
  const createdAt = Number(value.createdAt) || Date.now()
  return {
    id,
    title: text(value.title, 200).trim() || '无标题笔记',
    content: text(value.content, 1_000_000),
    folderId: folderIds.has(String(value.folderId || '')) ? String(value.folderId) : '',
    tags: Array.isArray(value.tags)
      ? [...new Set(value.tags.map(tag => text(tag, 40).trim()).filter(Boolean))].slice(0, 20)
      : [],
    pinned: Boolean(value.pinned),
    revision: Math.max(1, Number(value.revision) || 1),
    createdAt,
    updatedAt: Math.max(createdAt, Number(value.updatedAt) || createdAt)
  }
}

function normalizeData(notes: unknown, folders: unknown): StoredNotes {
  const normalizedFolders = Array.isArray(folders)
    ? folders.map(value => normalizeFolder(value || {})).filter((value): value is NoteFolder => Boolean(value))
    : []
  const uniqueFolders = [...new Map(normalizedFolders.map(folder => [folder.id, folder])).values()]
  const folderIds = new Set(uniqueFolders.map(folder => folder.id))
  const normalizedNotes = Array.isArray(notes)
    ? notes.map(value => normalizeNote(value || {}, folderIds)).filter((value): value is InspirationNote => Boolean(value))
    : []
  return {
    version: 1,
    notes: [...new Map(normalizedNotes.map(note => [note.id, note])).values()],
    folders: uniqueFolders
  }
}

function load(): StoredNotes {
  try {
    const payload = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return normalizeData(payload.notes, payload.folders)
  } catch {
    return { version: 1, notes: [], folders: [] }
  }
}

export const useNotesStore = defineStore('notes', () => {
  const initial = load()
  const items = ref<InspirationNote[]>(initial.notes)
  const folders = ref<NoteFolder[]>(initial.folders)
  const saving = ref(false)
  const lastSavedAt = ref<number | null>(initial.notes.length || initial.folders.length ? Date.now() : null)
  const storageError = ref('')
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function persistNow() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, notes: items.value, folders: folders.value }))
      saving.value = false
      storageError.value = ''
      lastSavedAt.value = Date.now()
    } catch (error) {
      saving.value = false
      storageError.value = error instanceof Error ? error.message : '本地存储空间不足，笔记未能保存。'
    }
  }

  function schedulePersist() {
    saving.value = true
    storageError.value = ''
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistNow, SAVE_DELAY)
  }

  watch([items, folders], schedulePersist, { deep: true })
  window.addEventListener('pagehide', persistNow)

  function create(folderId = '') {
    const now = Date.now()
    const note: InspirationNote = {
      id: crypto.randomUUID(),
      title: '无标题笔记',
      content: '',
      folderId: folders.value.some(folder => folder.id === folderId) ? folderId : '',
      tags: [],
      pinned: false,
      revision: 1,
      createdAt: now,
      updatedAt: now
    }
    items.value.unshift(note)
    return note
  }

  function get(id: string) {
    return items.value.find(note => note.id === id)
  }

  function update(id: string, patch: Partial<Omit<InspirationNote, 'id' | 'createdAt'>>, touch = true) {
    const note = get(id)
    if (!note) return
    if (patch.title !== undefined) note.title = text(patch.title, 200)
    if (patch.content !== undefined) note.content = text(patch.content, 1_000_000)
    if (patch.folderId !== undefined) note.folderId = folders.value.some(folder => folder.id === patch.folderId) ? patch.folderId : ''
    if (patch.tags !== undefined) note.tags = [...new Set(patch.tags.map(tag => text(tag, 40).trim()).filter(Boolean))].slice(0, 20)
    if (patch.pinned !== undefined) note.pinned = Boolean(patch.pinned)
    if (touch) {
      note.revision += 1
      note.updatedAt = Date.now()
    }
  }

  function remove(id: string) {
    const index = items.value.findIndex(note => note.id === id)
    if (index < 0) return null
    return items.value.splice(index, 1)[0]
  }

  function restore(note: InspirationNote) {
    if (get(note.id)) return
    const normalized = normalizeNote(note, new Set(folders.value.map(folder => folder.id)))
    if (normalized) items.value.unshift(normalized)
  }

  function createFolder(name: string) {
    const normalizedName = text(name, 60).trim()
    if (!normalizedName) throw new Error('请输入文件夹名称。')
    const existing = folders.value.find(folder => folder.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())
    if (existing) return existing
    const folder: NoteFolder = { id: crypto.randomUUID(), name: normalizedName, createdAt: Date.now() }
    folders.value.push(folder)
    return folder
  }

  function renameFolder(id: string, name: string) {
    const folder = folders.value.find(item => item.id === id)
    const normalizedName = text(name, 60).trim()
    if (!folder || !normalizedName) return
    folder.name = normalizedName
  }

  function removeFolder(id: string) {
    folders.value = folders.value.filter(folder => folder.id !== id)
    const now = Date.now()
    items.value.forEach(note => {
      if (note.folderId === id) {
        note.folderId = ''
        note.revision += 1
        note.updatedAt = now
      }
    })
  }

  function replaceAll(notes: unknown, nextFolders: unknown) {
    const normalized = normalizeData(notes, nextFolders)
    items.value = normalized.notes
    folders.value = normalized.folders
    persistNow()
  }

  function clear() {
    items.value = []
    folders.value = []
    persistNow()
  }

  return {
    items,
    folders,
    saving,
    lastSavedAt,
    storageError,
    create,
    get,
    update,
    remove,
    restore,
    createFolder,
    renameFolder,
    removeFolder,
    replaceAll,
    clear,
    persistNow
  }
})
