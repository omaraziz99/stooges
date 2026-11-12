/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the Go relay, e.g. ws://localhost:7777 */
  readonly VITE_RELAY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
