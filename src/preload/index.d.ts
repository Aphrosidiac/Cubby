export {}

declare global {
  interface Window {
    cubby: {
      platform: string
      invoke: (name: string, input?: unknown) => Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string; code: string; rule?: string } }>
      onEvent: (fn: (name: string, payload: unknown) => void) => () => void
      pathForFile: (file: File) => string
      setTitleBarSymbolColor: (color: string) => void
      closeSwitcher: () => void
    }
  }
}
