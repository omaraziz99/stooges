// Starred (favourite) channels, per account, kept in this browser. The sidebar
// and the channel header share it, so starring in one updates the other.
import { useCallback, useSyncExternalStore } from 'react'

const key = (pubkey: string) => `stooges-stars:${pubkey}`
const listeners = new Set<() => void>()
const cache = new Map<string, ReadonlySet<string>>()

function read(pubkey: string): ReadonlySet<string> {
  let stars = cache.get(pubkey)
  if (!stars) {
    let ids: unknown = []
    try {
      ids = JSON.parse(localStorage.getItem(key(pubkey)) ?? '[]')
    } catch {
      // Unreadable or blocked storage: start empty.
    }
    stars = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
    cache.set(pubkey, stars)
  }
  return stars
}

function write(pubkey: string, stars: Set<string>) {
  cache.set(pubkey, stars)
  try {
    localStorage.setItem(key(pubkey), JSON.stringify([...stars]))
  } catch {
    // Kept for this session only.
  }
  listeners.forEach((l) => l())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** This account's starred channel IDs, and a toggle. */
export function useStars(pubkey: string) {
  const stars = useSyncExternalStore(subscribe, () => read(pubkey))
  const toggle = useCallback(
    (channelId: string) => {
      const next = new Set(read(pubkey))
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      write(pubkey, next)
    },
    [pubkey],
  )
  return { stars, toggle }
}
