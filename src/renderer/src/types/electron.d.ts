interface Window {
  api: {
    saveSettings: (key: string, value: string) => Promise<void>
    getSettings: (key: string) => Promise<string | null>
    getContexts: (date: string) => Promise<unknown[]>
    getBacklog: () => Promise<unknown[]>
    updateBacklogStatus: (id: string, completed: boolean) => Promise<void>
    addManualTask: (title: string, description?: string) => Promise<void>
    updateTask: (id: string, title: string, description?: string) => Promise<void>
    reclassifyTask: (id: string, category: string, priority: number) => Promise<void>
    getProjects: () => Promise<unknown[]>
    getStatsSummary: (
      start: number,
      end: number
    ) => Promise<{
      total_count: number
      tagged_count: number
      top_intents: { intent_tags: string; count: number }[]
      flow_data: number[]
      context_switches: number
      active_minutes: number
      prev_active_minutes: number
      prev_context_switches: number
    }>
    getStatsInsight: (
      start: number,
      end: number,
      cycle?: string
    ) => Promise<{ insight_text: string; warning_text?: string; updated_at?: number }>
    getMonthlyTokens: () => Promise<number>
    checkScreenPermission: () => Promise<string>
    openSystemPreferences: () => Promise<void>
    toggleCapture: (shouldStart: boolean) => Promise<void>
    getAiSensingStatus: () => Promise<boolean>
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

    // OpenClaw APIs
    openclawInstall: () => Promise<{ success: boolean; error?: string }>
    openclawSetupChannel: (channel: 'weixin' | 'feishu') => Promise<{ success: boolean; error?: string }>
    openclawGatewayStatus: () => Promise<{ running: boolean; port: number }>
    openclawGetInstallStatus: () => Promise<{ installed: boolean; imConfigured: boolean; imSkipped: boolean; channels: string[] }>
    openclawReset: () => Promise<void>
    openclawSyncApiKey: () => Promise<{ success: boolean; error?: string }>
    openclawSkipIm: () => Promise<void>
    openclawGetDashboardUrl: () => Promise<string>

    // OpenClaw event listeners
    onOpenclawInstallProgress: (callback: (data: { step: string; message: string }) => void) => void
    onOpenclawInstallError: (callback: (data: { error: string; detail?: string }) => void) => void
    onOpenclawChannelQrcode: (callback: (data: { channel: string; qrData: string; type: string }) => void) => void
    onOpenclawChannelStatus: (callback: (data: { channel: string; status: string; error?: string }) => void) => void
  }
}
