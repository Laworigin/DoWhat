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
    ipcRenderer.invoke('get-model-pricing', modelName)
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
