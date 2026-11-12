// A small WebSocket client for the Go relay. It handles the NIP-42 login
// challenge, re-subscribes after reconnecting, and holds publishes until the
// relay confirms the login.
import { finalizeEvent, type Event as NostrEvent, type EventTemplate } from 'nostr-tools/pure'

export type { NostrEvent }

export type Filter = {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  [tag: `#${string}`]: string[] | undefined
}

export type Status = 'connecting' | 'authenticating' | 'ready' | 'offline'

type Subscription = {
  filters: Filter[]
  onEvent: (event: NostrEvent) => void
  onEose?: () => void
}

type PendingPublish = {
  event: NostrEvent
  resolve: (event: NostrEvent) => void
  reject: (err: Error) => void
  timer: number
}

const PUBLISH_TIMEOUT_MS = 10_000
const MAX_RETRY_DELAY_MS = 10_000

export const nowSeconds = () => Math.floor(Date.now() / 1000)

export class RelayClient {
  private ws: WebSocket | null = null
  private subs = new Map<string, Subscription>()
  private sent = new Map<string, PendingPublish>() // sent, waiting for OK
  private queue: PendingPublish[] = [] // waiting for login
  private authEventId: string | null = null
  private status: Status = 'offline'
  private listeners = new Set<(status: Status) => void>()
  private retries = 0
  private retryTimer: number | undefined
  private closedByUs = false
  private nextSubId = 0

  constructor(
    readonly url: string,
    private readonly secretKey: Uint8Array,
  ) {}

  connect() {
    this.closedByUs = false
    this.setStatus('connecting')
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onopen = () => {
      this.retries = 0
      this.setStatus('authenticating')
      for (const [id, sub] of this.subs) this.sendRaw(['REQ', id, ...sub.filters])
    }
    ws.onmessage = (msg) => this.handleMessage(String(msg.data))
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.authEventId = null
      this.setStatus('offline')
      for (const p of this.sent.values()) {
        clearTimeout(p.timer)
        p.reject(new Error('Connection lost before the relay confirmed'))
      }
      this.sent.clear()
      if (!this.closedByUs) {
        const delay = Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** this.retries++)
        this.retryTimer = window.setTimeout(() => this.connect(), delay)
      }
    }
  }

  close() {
    this.closedByUs = true
    clearTimeout(this.retryTimer)
    const ws = this.ws
    this.ws = null
    if (ws?.readyState === WebSocket.CONNECTING) {
      // Closing mid-handshake logs a browser error (React StrictMode does this
      // in development); close quietly once it opens instead.
      ws.onopen = () => ws.close()
      ws.onmessage = null
    } else {
      ws?.close()
    }
    this.setStatus('offline')
  }

  getStatus() {
    return this.status
  }

  onStatus(listener: (status: Status) => void) {
    this.listeners.add(listener)
    listener(this.status)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Subscribe to events matching the filters. Returns an unsubscribe function. */
  subscribe(filters: Filter[], onEvent: (event: NostrEvent) => void, onEose?: () => void) {
    const id = `s${++this.nextSubId}`
    this.subs.set(id, { filters, onEvent, onEose })
    if (this.ws?.readyState === WebSocket.OPEN) this.sendRaw(['REQ', id, ...filters])
    return () => {
      this.subs.delete(id)
      if (this.ws?.readyState === WebSocket.OPEN) this.sendRaw(['CLOSE', id])
    }
  }

  /** Sign and publish an event. Resolves once the relay accepts it. */
  publish(template: EventTemplate): Promise<NostrEvent> {
    const event = finalizeEvent(template, this.secretKey)
    return new Promise((resolve, reject) => {
      const pending: PendingPublish = {
        event,
        resolve,
        reject,
        timer: window.setTimeout(() => {
          this.sent.delete(event.id)
          this.queue = this.queue.filter((q) => q !== pending)
          reject(new Error('Timed out waiting for the server. Is the relay running?'))
        }, PUBLISH_TIMEOUT_MS),
      }
      if (this.status === 'ready') this.sendPublish(pending)
      else this.queue.push(pending)
    })
  }

  private sendPublish(pending: PendingPublish) {
    this.sent.set(pending.event.id, pending)
    this.sendRaw(['EVENT', pending.event])
  }

  private handleMessage(data: string) {
    let msg: unknown
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (!Array.isArray(msg)) return
    const [type, a, b, c] = msg as [string, unknown, unknown, unknown]
    switch (type) {
      case 'AUTH':
        this.login(String(a))
        break
      case 'EVENT':
        this.subs.get(String(a))?.onEvent(b as NostrEvent)
        break
      case 'EOSE':
        this.subs.get(String(a))?.onEose?.()
        break
      case 'OK':
        this.handleOk(String(a), Boolean(b), String(c ?? ''))
        break
      case 'CLOSED':
        console.warn('relay closed subscription', a, b)
        break
      case 'NOTICE':
        console.warn('relay notice:', a)
        break
    }
  }

  // NIP-42: prove we own the key by signing the relay's challenge.
  private login(challenge: string) {
    const auth = finalizeEvent(
      {
        kind: 22242,
        created_at: nowSeconds(),
        tags: [
          ['relay', this.url],
          ['challenge', challenge],
        ],
        content: '',
      },
      this.secretKey,
    )
    this.authEventId = auth.id
    this.sendRaw(['AUTH', auth])
  }

  private handleOk(id: string, ok: boolean, message: string) {
    if (id === this.authEventId) {
      this.authEventId = null
      const queued = this.queue
      this.queue = []
      if (ok) {
        this.setStatus('ready')
        for (const p of queued) this.sendPublish(p)
      } else {
        for (const p of queued) {
          clearTimeout(p.timer)
          p.reject(new Error(`Login rejected: ${message}`))
        }
      }
      return
    }
    const pending = this.sent.get(id)
    if (!pending) return
    this.sent.delete(id)
    clearTimeout(pending.timer)
    if (ok) pending.resolve(pending.event)
    else pending.reject(new Error(message || 'Rejected by the server'))
  }

  private sendRaw(msg: unknown[]) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private setStatus(status: Status) {
    this.status = status
    for (const l of this.listeners) l(status)
  }
}
