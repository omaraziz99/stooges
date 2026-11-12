import { shortNpub } from './keys'
import type { Profile } from './chat'

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function displayName(profiles: Map<string, Profile>, pubkey: string) {
  return profiles.get(pubkey)?.name || shortNpub(pubkey)
}

export function formatTime(seconds: number) {
  const date = new Date(seconds * 1000)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export const fullTimestamp = (seconds: number) => new Date(seconds * 1000).toLocaleString()
