// Performance review bookings, and which people to suggest reviewing next.
//
// A booking is a NIP-52 time-based calendar event (kind 31923) for one person
// (its p tag). Only managers may publish one, and only managers and the
// booked person can read it: the relay enforces both (be/internal/relay).
// Rescheduling republishes the same d tag; cancelling adds
// ["status", "cancelled"].
//
// No runtime imports, so `pnpm test` (src/lib/reviews.test.ts) runs it in Node.
import type { EventTemplate } from 'nostr-tools/pure'
import type { NostrEvent } from './relay'

export const REVIEW_KIND = 31923
/** ponytail: one review cadence for everyone; make it per level if teams need different rhythms. */
export const REVIEW_EVERY_DAYS = 90
const DAY = 24 * 60 * 60

export type Booking = {
  /** The d tag: the booking's identity across reschedules. */
  id: string
  /** The booked person's public key. */
  person: string
  /** The manager who booked it. */
  by: string
  /** Unix seconds. */
  start: number
  end: number
  note: string
  cancelled: boolean
  createdAt: number
}

const tag = (e: NostrEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1] ?? ''

/** The current version of every booking, newest per manager and d tag, cancelled ones left out. */
export function activeBookings(events: NostrEvent[]): Booking[] {
  const latest = new Map<string, NostrEvent>()
  for (const e of events) {
    const key = `${e.pubkey}:${tag(e, 'd')}`
    const seen = latest.get(key)
    if (!seen || e.created_at > seen.created_at) latest.set(key, e)
  }
  const out: Booking[] = []
  for (const e of latest.values()) {
    const start = Number(tag(e, 'start'))
    if (!tag(e, 'p') || !Number.isFinite(start) || tag(e, 'status') === 'cancelled') continue
    const end = Number(tag(e, 'end'))
    out.push({
      id: tag(e, 'd'),
      person: tag(e, 'p'),
      by: e.pubkey,
      start,
      end: Number.isFinite(end) && end > start ? end : start + 60 * 60,
      note: e.content,
      cancelled: false,
      createdAt: e.created_at,
    })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** A person's next booked review (if any) and their most recent past one. */
export function reviewStatus(bookings: Booking[], person: string, now: number) {
  const theirs = bookings.filter((b) => b.person === person)
  return {
    next: theirs.find((b) => b.end > now),
    last: theirs.filter((b) => b.end <= now).at(-1),
  }
}

export type Reason = { kind: 'never' } | { kind: 'overdue'; days: number } | { kind: 'no-evidence' }

/**
 * Why to suggest reviewing someone, or [] if not: no review on record, the
 * last one over REVIEW_EVERY_DAYS ago, or no chat evidence this period (their
 * work may be happening elsewhere). Anyone with a review booked is not
 * suggested. Never based on how much evidence someone has: that would rank people.
 */
export function suggestionReasons(bookings: Booking[], person: string, evidenceCount: number, now: number): Reason[] {
  const { next, last } = reviewStatus(bookings, person, now)
  if (next) return []
  const reasons: Reason[] = []
  if (!last) reasons.push({ kind: 'never' })
  else if (now - last.end > REVIEW_EVERY_DAYS * DAY) reasons.push({ kind: 'overdue', days: Math.floor((now - last.end) / DAY) })
  if (evidenceCount === 0) reasons.push({ kind: 'no-evidence' })
  return reasons
}

/** Most pressing first: never reviewed, then longest since a review, then no evidence only. */
export function byUrgency(a: Reason[], b: Reason[]) {
  const score = (r: Reason[]) => (r.some((x) => x.kind === 'never') ? 1e9 : 0) + (r.find((x) => x.kind === 'overdue')?.days ?? 0)
  return score(b) - score(a)
}

/** The event that books (or, with the same id, reschedules) a review. Dated after `after`, so it replaces the previous version. */
export function bookingEvent(
  b: { id: string; person: string; start: number; end: number; note: string; title: string },
  after = 0,
): EventTemplate {
  return {
    kind: REVIEW_KIND,
    created_at: Math.max(Math.floor(Date.now() / 1000), after + 1),
    content: b.note,
    tags: [
      ['d', b.id],
      ['p', b.person],
      ['title', b.title],
      ['start', String(b.start)],
      ['end', String(b.end)],
      ['start_tzid', Intl.DateTimeFormat().resolvedOptions().timeZone],
    ],
  }
}

/** The event that cancels a booking: its latest version, marked cancelled. */
export function cancellationEvent(b: Booking, title: string): EventTemplate {
  const ev = bookingEvent({ ...b, title }, b.createdAt)
  ev.tags.push(['status', 'cancelled'])
  return ev
}
