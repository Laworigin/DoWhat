import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  saveSettings: (key: string, value: string) => ipcRenderer.invoke('save-settings', key, value),
  getSettings: (key: string) => ipcRenderer.invoke('get-settings', key),
  getContexts: (date: string) => ipcRenderer.invoke('get-contexts', date),
  getBacklog: () => ipcRenderer.invoke('get-backlog'),
  updateBacklogStatus: (id: string, completed: boolean) =>
    ipcRenderer.invoke('update-backlog-status', id, completed),
  getVisibleBacklog: () => ipcRenderer.invoke('get-visible-backlog'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getStatsSummary: (start: number, end: number) => ipcRenderer.invoke('get-stats-summary', start, end),
  getStatsInsight: (start: number, end: number) => ipcRenderer.invoke('get-stats-insight', start, end),
  getMonthlyTokens: () => ipcRenderer.invoke('get-monthly-tokens'),
  checkScreenPermission: () => ipcRenderer.invoke('check-screen-permission'),
  openSystemPreferences: () => ipcRenderer.invoke('open-system-preferences'),
  toggleCapture: (shouldStart: boolean) => ipcRenderer.invoke('toggle-capture', shouldStart),
  testLLMConnection: (apiKey: string, endpoint: string, modelName: string) =>
    ipcRenderer.invoke('test-llm-connection', apiKey, endpoint, modelName),
  aiSmartGrouping: (apiKey: string, endpoint: string, modelName: string, contexts: any[]) =>
    ipcRenderer.invoke('ai-smart-grouping', apiKey, endpoint, modelName, contexts),
  getLatestSummary: (level: number) => ipcRenderer.invoke('get-latest-summary', level),
  getSummariesForDate: (date: string, level: number) => ipcRenderer.invoke('get-summaries-for-date', date, level),
  aiOptimizeBacklog: (apiKey: string, endpoint: string, modelName: string, backlogItems: any[]) =>
    ipcRenderer.invoke('ai-optimize-backlog', apiKey, endpoint, modelName, backlogItems),
  aiSummarizeSlot: (apiKey: string, endpoint: string, modelName: string, summaries: string[]) =>
    ipcRenderer.invoke('ai-summarize-slot', apiKey, endpoint, modelName, summaries),
  getSlotSummaries: (date: string) =>
    ipcRenderer.invoke('get-slot-summaries', date),
  getModelPricing: (modelName: string) =>
    ipcRenderer.invoke('get-model-pricing', modelName),

  // OpenClaw APIs
  openclawInstall: () => ipcRenderer.invoke('openclaw-install'),
  openclawSetupChannel: (channel: 'weixin' | 'feishu') => ipcRenderer.invoke('openclaw-setup-channel', channel),
  openclawGatewayStatus: () => ipcRenderer.invoke('openclaw-gateway-status'),
  openclawGetInstallStatus: () => ipcRenderer.invoke('openclaw-get-install-status'),
  openclawReset: () => ipcRenderer.invoke('openclaw-reset'),
  openclawSyncApiKey: () => ipcRenderer.invoke('openclaw-sync-apikey'),
  openclawSkipIm: () => ipcRenderer.invoke('openclaw-skip-im'),
  openclawGetDashboardUrl: () => ipcRenderer.invoke('openclaw-get-dashboard-url'),

  // OpenClaw event listeners
  onOpenclawInstallProgress: (callback: (data: { step: string; message: string }) => void) => {
    ipcRenderer.on('openclaw-install-progress', (_event, data) => callback(data))
  },
  onOpenclawInstallError: (callback: (data: { error: string; detail?: string }) => void) => {
    ipcRenderer.on('openclaw-install-error', (_event, data) => callback(data))
  },
  onOpenclawChannelQrcode: (callback: (data: { channel: string; qrData: string; type: string }) => void) => {
    ipcRenderer.on('openclaw-channel-qrcode', (_event, data) => callback(data))
  },
  onOpenclawChannelStatus: (callback: (data: { channel: string; status: string; error?: string }) => void) => {
    ipcRenderer.on('openclaw-channel-status', (_event, data) => callback(data))
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
