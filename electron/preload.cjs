const { contextBridge, ipcRenderer } = require('electron')

const streamCallbacks = new Map()
ipcRenderer.on('model:stream-event', (_event, payload) => {
  streamCallbacks.get(payload.requestId)?.(payload)
})

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  loadModelConfig: () => ipcRenderer.invoke('config:load'),
  saveModelConfig: config => ipcRenderer.invoke('config:save', config),
  activateModelProfile: profileId => ipcRenderer.invoke('config:activate', profileId),
  deleteModelProfile: profileId => ipcRenderer.invoke('config:delete', profileId),
  importModelProfiles: payload => ipcRenderer.invoke('config:import', payload),
  listModels: config => ipcRenderer.invoke('model:list', config),
  testModel: config => ipcRenderer.invoke('model:test', config),
  embedTexts: (config, texts, requestId) => ipcRenderer.invoke('model:embed', config, texts, requestId),
  startStream: payload => ipcRenderer.invoke('model:stream', payload),
  abortStream: requestId => ipcRenderer.invoke('model:abort', requestId),
  onStreamEvent: (requestId, callback) => {
    streamCallbacks.set(requestId, callback)
    return true
  },
  clearStreamListener: requestId => streamCallbacks.delete(requestId)
})
