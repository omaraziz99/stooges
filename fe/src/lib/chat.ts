// Chat model: event kinds, how raw events become messages/threads/reactions,
// and the actions that publish new events.
import { nowSeconds, type NostrEvent, type RelayClient } from './relay'

export const Kind = {
  Profile: 0,
  Deletion: 5,
  Reaction: 7,
  Message: 9,
  EditChannel: 9002,
  CreateChannel: 9007,
  AppData: 30078,
  ChannelMetadata: 39000,
} as const

export type Channel = {
  id: string
  name: string
  about: string
  /** Pubkey of the creator, the only one who can change KPI review. */
  creator: string
  /** A work channel the KPI agent may read. */
  kpiReview: boolean
}

/** d tag of a person's own opt-in to KPI insights (kind 30078). */
export const CONSENT_TAG = 'kpi-consent'

export type Profile = { name: string; createdAt: number }

export type ReactionGroup = {
  emoji: string
  pubkeys: string[]
  /** My reaction events for this emoji (deleted together to un-react). */
  mine: NostrEvent[]
}

export type ChannelState = {
  /** Top-level messages, oldest first. */
  messages: NostrEvent[]
  /** Thread replies keyed by root message ID, oldest first. */
  replies: Map<string, NostrEvent[]>
  /** Reactions keyed by the message they react to. */
  reactions: Map<string, ReactionGroup[]>
  /** Every live message (top-level and replies) by ID. */
  byId: Map<string, NostrEvent>
}

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅']

const chronological = (a: NostrEvent, b: NostrEvent) =>
  a.created_at - b.created_at || (a.id < b.id ? -1 : 1)

/** The thread root a reply points at, or null for a top-level message. */
export function threadRootOf(event: NostrEvent): string | null {
  return event.tags.find((t) => t[0] === 'e' && t[3] === 'root')?.[1] ?? null
}

const normalizeEmoji = (content: string) => (content === '+' || content === '' ? '👍' : content)

/** Turn the raw events of one channel into what the UI shows. */
export function buildChannelState(events: NostrEvent[], me: string): ChannelState {
  // A deletion only counts when its author also wrote the target.
  const deletedBy = new Map<string, Set<string>>()
  for (const e of events) {
    if (e.kind !== Kind.Deletion) continue
    for (const t of e.tags) {
      if (t[0] !== 'e' || !t[1]) continue
      let who = deletedBy.get(t[1])
      if (!who) deletedBy.set(t[1], (who = new Set()))
      who.add(e.pubkey)
    }
  }
  const alive = (e: NostrEvent) => !deletedBy.get(e.id)?.has(e.pubkey)

  const state: ChannelState = { messages: [], replies: new Map(), reactions: new Map(), byId: new Map() }
  for (const e of [...events].sort(chronological)) {
    if (!alive(e)) continue
    if (e.kind === Kind.Message) {
      state.byId.set(e.id, e)
      const root = threadRootOf(e)
      if (root) {
        const list = state.replies.get(root)
        if (list) list.push(e)
        else state.replies.set(root, [e])
      } else {
        state.messages.push(e)
      }
    } else if (e.kind === Kind.Reaction) {
      const target = e.tags.find((t) => t[0] === 'e')?.[1]
      if (!target) continue
      const emoji = normalizeEmoji(e.content)
      let groups = state.reactions.get(target)
      if (!groups) state.reactions.set(target, (groups = []))
      let group = groups.find((g) => g.emoji === emoji)
      if (!group) groups.push((group = { emoji, pubkeys: [], mine: [] }))
      if (!group.pubkeys.includes(e.pubkey)) group.pubkeys.push(e.pubkey)
      if (e.pubkey === me) group.mine.push(e)
    }
  }
  return state
}

/** Latest channel metadata per channel ID, #general first, then by name. */
export function buildChannels(events: NostrEvent[]): Channel[] {
  const latest = new Map<string, NostrEvent>()
  for (const e of events) {
    const id = e.tags.find((t) => t[0] === 'd')?.[1]
    if (!id) continue
    const prev = latest.get(id)
    if (!prev || prev.created_at < e.created_at) latest.set(id, e)
  }
  const tag = (e: NostrEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1] ?? ''
  return [...latest.entries()]
    .map(([id, e]) => ({
      id,
      name: tag(e, 'name') || id,
      about: tag(e, 'about'),
      creator: tag(e, 'creator'),
      kpiReview: tag(e, 'kpi') === 'on',
    }))
    .sort((a, b) => (a.id === 'general' ? -1 : b.id === 'general' ? 1 : a.name.localeCompare(b.name)))
}

/** Latest display name per pubkey. */
export function buildProfiles(events: NostrEvent[]): Map<string, Profile> {
  const out = new Map<string, Profile>()
  for (const e of events) {
    let name = ''
    try {
      const parsed = JSON.parse(e.content)
      name = String(parsed.display_name || parsed.name || '').trim().slice(0, 64)
    } catch {
      continue
    }
    const prev = out.get(e.pubkey)
    if (!prev || prev.createdAt < e.created_at) out.set(e.pubkey, { name, createdAt: e.created_at })
  }
  return out
}

/** "Team Lunch!" -> "team-lunch" (the relay accepts a-z, 0-9, - and _). */
export function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

// ---- Actions: each publishes one signed event ----

export const sendMessage = (client: RelayClient, channelId: string, content: string, rootId?: string) =>
  client.publish({
    kind: Kind.Message,
    created_at: nowSeconds(),
    content,
    tags: [['h', channelId], ...(rootId ? [['e', rootId, '', 'root']] : [])],
  })

export const react = (client: RelayClient, channelId: string, target: NostrEvent, emoji: string) =>
  client.publish({
    kind: Kind.Reaction,
    created_at: nowSeconds(),
    content: emoji,
    tags: [
      ['e', target.id],
      ['p', target.pubkey],
      ['h', channelId],
    ],
  })

export const deleteEvents = (client: RelayClient, channelId: string, ids: string[]) =>
  client.publish({
    kind: Kind.Deletion,
    created_at: nowSeconds(),
    content: '',
    tags: [...ids.map((id) => ['e', id]), ['h', channelId]],
  })

export const createChannel = (client: RelayClient, id: string, name: string, about: string, kpiReview: boolean) =>
  client.publish({
    kind: Kind.CreateChannel,
    created_at: nowSeconds(),
    content: '',
    tags: [
      ['h', id],
      ['name', name],
      ['about', about],
      ['kpi', kpiReview ? 'on' : 'off'],
    ],
  })

/** Turn KPI review of a channel on or off. The relay accepts this only from its creator. */
export const setChannelKpiReview = (client: RelayClient, channelId: string, on: boolean) =>
  client.publish({
    kind: Kind.EditChannel,
    created_at: nowSeconds(),
    content: '',
    tags: [
      ['h', channelId],
      ['kpi', on ? 'on' : 'off'],
    ],
  })

/**
 * Opt in to, or out of, KPI insights. The relay keeps only the newest choice,
 * so it must be dated after the previous one (`after`).
 */
export const setConsent = (client: RelayClient, consent: boolean, after: number) =>
  client.publish({
    kind: Kind.AppData,
    created_at: Math.max(nowSeconds(), after + 1),
    content: JSON.stringify({ consent }),
    tags: [['d', CONSENT_TAG]],
  })

export const setProfileName = (client: RelayClient, name: string) =>
  client.publish({ kind: Kind.Profile, created_at: nowSeconds(), content: JSON.stringify({ name }), tags: [] })

/** Relay errors look like "invalid: message is empty"; show just the reason. */
export function errorText(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  const reason = msg.replace(/^[a-z-]+: /, '')
  return reason.charAt(0).toUpperCase() + reason.slice(1)
}
