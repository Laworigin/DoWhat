interface Window {
  api: {
    saveSettings: (key: string, value: string) => Promise<void>
    getSettings: (key: string) => Promise<string | null>
    getContexts: (date: string) => Promise<unknown[]>
    getBacklog: () => Promise<unknown[]>
    updateBacklogStatus: (id: string, completed: boolean) => Promise<void>
    getProjects: () => Promise<unknown[]>
    getStatsSummary: (
      start: number,
      end: number
    ) => Promise<{
      total_count: number
      top_intents: any[]
      flow_data: number[]
      context_switches: number
    }>
    getStatsInsight: (
      start: number,
      end: number
    ) => Promise<{ insight_text: string; warning_text?: string }>
    getMonthlyTokens: () => Promise<number>
    checkScreenPermission: () => Promise<string>
    openSystemPreferences: () => Promise<void>
    toggleCapture: (shouldStart: boolean) => Promise<void>
    testLLMConnection: (
      apiKey: string,
      endpoint: string,
      modelName: string
    ) => Promise<{ success: boolean; answer?: string; error?: string }>
    aiSmartGrouping: (
      apiKey: string,
      endpoint: string,
      modelName: string,
      contexts: any[]
    ) => Promise<{ groups: number[][] }>
    getLatestSummary: (level: number) => Promise<{ content: string; timestamp: number } | null>
    getSummariesForDate: (date: string, level: number) => Promise<any[]>
    aiSummarizeSlot: (
      apiKey: string,
      endpoint: string,
      modelName: string,
      summaries: string[]
    ) => Promise<{ summary: string }>
    getSlotSummaries: (date: string) => Promise<{ slot_start_ms: number; summary: string; updated_at: number }[]>
  }
}
