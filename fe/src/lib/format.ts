import { shortNpub } from './keys'
import type { Profile } from './chat'

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-600',
  'bg-emerald-600',
  'bg-teal-600',
  'bg-sky-600',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-600',
  'bg-slate-600',
]

export function avatarColor(pubkey: string) {
  let hash = 0
  for (const ch of pubkey.slice(0, 12)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

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
