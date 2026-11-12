import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getPublicKey } from 'nostr-tools/pure'
import { RelayClient, type Filter, type NostrEvent, type Status } from '../lib/relay'
import { buildChannels, buildProfiles, Kind, type Profile } from '../lib/chat'
import { parseReport, REPORT_KIND, REPORT_TAG, type KpiReport } from '../lib/kpi'

// In production set VITE_RELAY_URL (e.g. wss://your-relay.up.railway.app).
// Locally it falls back to port 7777 on the same host.
const RELAY_URL =
  import.meta.env.VITE_RELAY_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname || 'localhost'}:7777`

type RelayContextValue = {
  client: RelayClient
  pubkey: string
  secretKey: Uint8Array
  status: Status
  signOut: () => void
}

const RelayContext = createContext<RelayContextValue | null>(null)

export function RelayProvider({
  secretKey,
  onSignOut,
  children,
}: {
  secretKey: Uint8Array
  onSignOut: () => void
  children: ReactNode
}) {
  const client = useMemo(() => new RelayClient(RELAY_URL, secretKey), [secretKey])
  const pubkey = useMemo(() => getPublicKey(secretKey), [secretKey])
  const [status, setStatus] = useState<Status>('connecting')

  useEffect(() => {
    const off = client.onStatus(setStatus)
    client.connect()
    return () => {
      off()
      client.close()
    }
  }, [client])

  const value = useMemo(
    () => ({ client, pubkey, secretKey, status, signOut: onSignOut }),
    [client, pubkey, secretKey, status, onSignOut],
  )
  return <RelayContext.Provider value={value}>{children}</RelayContext.Provider>
}

export function useRelay() {
  const ctx = useContext(RelayContext)
  if (!ctx) throw new Error('useRelay must be used inside <RelayProvider>')
  return ctx
}

/**
 * Subscribe to the relay while mounted. Events are de-duplicated by ID and
 * batched into one render per animation frame, so loading 500 messages
 * doesn't cause 500 renders. `loaded` turns true at end of stored events.
 */
export function useSubscription(filters: Filter[] | null) {
  const { client } = useRelay()
  const key = filters ? JSON.stringify(filters) : null
  const [state, setState] = useState<{ key: string | null; events: NostrEvent[]; loaded: boolean }>({
    key: null,
    events: [],
    loaded: false,
  })

  useEffect(() => {
    if (!key) return
    const byId = new Map<string, NostrEvent>()
    let loaded = false
    let frame = 0
    const flush = () => {
      frame = 0
      setState({ key, events: [...byId.values()], loaded })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush)
    }
    const unsubscribe = client.subscribe(
      JSON.parse(key) as Filter[],
      (event) => {
        if (byId.has(event.id)) return
        byId.set(event.id, event)
        schedule()
      },
      () => {
        loaded = true
        schedule()
      },
    )
    return () => {
      unsubscribe()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [client, key])

  // Never hand back the previous subscription's events after filters change.
  return state.key === key ? state : { key, events: [] as NostrEvent[], loaded: false }
}

/**
 * The latest KPI report, published to the relay by the KPI agent. Updates
 * live when the agent re-runs. `undefined` while loading, `null` if none.
 */
export function useKpiReport(): KpiReport | null | undefined {
  const { events, loaded } = useSubscription([{ kinds: [REPORT_KIND], '#d': [REPORT_TAG] }])
  return useMemo(() => {
    const latest = events.reduce<NostrEvent | null>((a, e) => (!a || e.created_at > a.created_at ? e : a), null)
    if (latest) return parseReport(latest.content)
    return loaded ? null : undefined
  }, [events, loaded])
}

export function useChannels() {
  const { events, loaded } = useSubscription([{ kinds: [Kind.ChannelMetadata] }])
  const channels = useMemo(() => buildChannels(events), [events])
  return { channels, loaded }
}

const ProfilesContext = createContext<Map<string, Profile>>(new Map())

/** Loads every user's display name once, for the whole app. */
export function ProfilesProvider({ children }: { children: ReactNode }) {
  const { events } = useSubscription([{ kinds: [Kind.Profile] }])
  const profiles = useMemo(() => buildProfiles(events), [events])
  return <ProfilesContext.Provider value={profiles}>{children}</ProfilesContext.Provider>
}

export const useProfiles = () => useContext(ProfilesContext)

const NotifyContext = createContext<(message: string) => void>(() => {})

/** A small toast for errors from actions without their own error area. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 5000)
    return () => clearTimeout(timer)
  }, [message])

  return (
    <NotifyContext.Provider value={setMessage}>
      {children}
      {message && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg bg-stone-900 px-4 py-2.5 text-sm text-white shadow-lg"
        >
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-stone-400 hover:text-white" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </NotifyContext.Provider>
  )
}

export const useNotify = () => useContext(NotifyContext)
