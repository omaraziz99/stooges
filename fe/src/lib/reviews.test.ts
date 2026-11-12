// Checks the review-suggestion rules. Run: pnpm test (Node runs TypeScript directly).
import { activeBookings, byUrgency, cancellationEvent, reviewStatus, suggestionReasons, type Booking } from './reviews.ts'
import type { NostrEvent } from './relay.ts'

// Tiny asserts, so the file needs no Node type definitions to typecheck.
const assert = {
  ok(value: unknown, message = 'expected a truthy value') {
    if (!value) throw new Error(message)
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  },
}
const DAY = 24 * 60 * 60
const now = 1_800_000_000
const boss = 'b'.repeat(64)
let n = 0
const event = (person: string, start: number, extra: string[][] = [], createdAt = ++n): NostrEvent => ({
  id: String(n),
  pubkey: boss,
  sig: '',
  kind: 31923,
  created_at: createdAt,
  content: '',
  tags: [['d', `r-${person}`], ['p', person], ['start', String(start)], ['end', String(start + 3600)], ...extra],
})
const reasons = (bookings: Booking[], person: string, evidence = 3) => suggestionReasons(bookings, person, evidence, now).map((r) => r.kind)

// Recent review: nothing to suggest. Booked ahead: nothing, even with no evidence.
const recent = activeBookings([event('maya', now - 40 * DAY)])
assert.deepEqual(reasons(recent, 'maya'), [])
assert.deepEqual(reasons(activeBookings([event('sara', now + 6 * DAY)]), 'sara', 0), [])

// Never reviewed; overdue (over 90 days); no evidence; both.
assert.deepEqual(reasons([], 'ben'), ['never'])
const old = activeBookings([event('leo', now - 150 * DAY)])
assert.deepEqual(reasons(old, 'leo'), ['overdue'])
assert.deepEqual((suggestionReasons(old, 'leo', 3, now)[0] as { days: number }).days, 149)
assert.deepEqual(reasons([], 'hana', 0), ['never', 'no-evidence'])
assert.deepEqual(reasons(activeBookings([event('dan', now - 30 * DAY)]), 'dan', 0), ['no-evidence'])

// Rescheduling keeps the newest version; cancelling removes the booking.
const moved = activeBookings([event('ravi', now - 100 * DAY, [], 1), event('ravi', now + 3 * DAY, [], 2)])
assert.deepEqual(moved.length, 1)
assert.deepEqual(reviewStatus(moved, 'ravi', now).next?.start, now + 3 * DAY)
const booked = activeBookings([event('nora', now + DAY, [], 5)])
const cancel = cancellationEvent(booked[0], 'Performance review')
assert.ok(cancel.created_at > 5, 'a cancellation must be newer than the booking it replaces')
assert.deepEqual(activeBookings([event('nora', now + DAY, [], 5), event('nora', now + DAY, [['status', 'cancelled']], 6)]), [])

// Never reviewed first, then the longest overdue, then no evidence only.
const order = [
  { kind: 'no-evidence' as const },
  { kind: 'overdue' as const, days: 100 },
  { kind: 'never' as const },
  { kind: 'overdue' as const, days: 150 },
].map((r) => [r]).sort(byUrgency).map((r) => r[0].kind + ('days' in r[0] ? r[0].days : ''))
assert.deepEqual(order, ['never', 'overdue150', 'overdue100', 'no-evidence'])

console.log('reviews: all checks passed')
