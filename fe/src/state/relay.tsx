import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getPublicKey } from 'nostr-tools/pure'
import { RELAY_URL } from '../lib/config'
import { RelayClient, type Filter, type NostrEvent, type Status } from '../lib/relay'
import { buildChannels, buildProfiles, CONSENT_TAG, Kind, type Profile } from '../lib/chat'
import { parseReport, REPORT_KIND, REPORT_TAG, type KpiReport } from '../lib/kpi'

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

const newest = (events: NostrEvent[]) =>
  events.reduce<NostrEvent | null>((a, e) => (!a || e.created_at > a.created_at ? e : a), null)

/**
 * The KPI report this account may see. The relay sends managers the team
 * report and everyone else only their own, which is marked `personal`.
 * Updates live when the agent re-runs. `undefined` while loading, `null` if none.
 */
export function useKpiReport(): KpiReport | null | undefined {
  const { pubkey } = useRelay()
  const mine = `${REPORT_TAG}:${pubkey}`
  const { events, loaded } = useSubscription([{ kinds: [REPORT_KIND], '#d': [REPORT_TAG, mine] }])
  return useMemo(() => {
    const latest = (tag: string) => newest(events.filter((e) => e.tags.some((t) => t[0] === 'd' && t[1] === tag)))
    const team = latest(REPORT_TAG)
    const event = team ?? latest(mine)
    if (!event) return loaded ? null : undefined
    const report = parseReport(event.content)
    return report && { ...report, personal: !team }
  }, [events, loaded, mine])
}

/** The signed-in person's opt-in to KPI insights, and when they last changed it. */
export function useMyConsent() {
  const { pubkey } = useRelay()
  const { events, loaded } = useSubscription([{ kinds: [Kind.AppData], authors: [pubkey], '#d': [CONSENT_TAG] }])
  const latest = newest(events)
  return {
    loaded,
    // The relay only stores valid JSON under this tag.
    consented: latest ? JSON.parse(latest.content)?.consent === true : false,
    lastChange: latest?.created_at ?? 0,
  }
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
