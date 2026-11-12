// Performance reviews on the team dashboard: who to review next, booking,
// rescheduling and cancelling (managers only; the relay enforces it), and the
// booked person's own view of their next review. Data and rules: lib/reviews.ts.
import { useId, useState, type FormEvent } from 'react'
import { CalendarCheck, CalendarClock, CalendarPlus, CalendarX, MessageSquareOff } from 'lucide-react'
import { errorText } from '../lib/chat'
import { displayName } from '../lib/format'
import { levelTitle, totalEvidence, type KpiReport, type Person } from '../lib/kpi'
import { useT } from '../lib/prefs'
import {
  bookingEvent,
  byUrgency,
  cancellationEvent,
  reviewStatus,
  suggestionReasons,
  type Booking,
  type Reason,
} from '../lib/reviews'
import { useNotify, useProfiles, useRelay } from '../state/relay'
import { Avatar } from './Avatar'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'

const button =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500'
const primary = `${button} bg-brand-600 text-on-brand hover:opacity-90`
const secondary = `${button} border border-gray-200 bg-white text-gray-900 hover:bg-gray-50`
const field =
  'mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-gray-900 outline-none focus:border-brand-500'

const nowSeconds = () => Math.floor(Date.now() / 1000)
const firstName = (p: Person) => p.name.split(/\s+/)[0]
/** The event title stored with a booking; data, so not translated. */
const titleFor = (p: Person) => `Performance review: ${p.name}`

/** "Thu, 20 Nov 2026 · 10:00 – 11:00", in the viewer's time zone. */
export const bookingTime = (b: Booking) => {
  const time = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const day = new Date(b.start * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  return `${day} · ${time(b.start)} – ${time(b.end)}`
}
export const bookingDay = (b: Booking) => new Date(b.start * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' })

function ReasonLine({ reason }: { reason: Reason }) {
  const t = useT()
  const [Icon, text] =
    reason.kind === 'never'
      ? [CalendarX, t('No review on record')]
      : reason.kind === 'overdue'
        ? [CalendarClock, t('Last review {n} months ago', { n: Math.floor(reason.days / 30) })]
        : [MessageSquareOff, t('No chat evidence this period')]
  return (
    <li className="flex items-center gap-2 text-sm text-gray-700">
      <Icon aria-hidden className="size-4 shrink-0 text-gray-500" />
      {text}
    </li>
  )
}

/** People to review soon: no review on record, the last one long ago, or no chat evidence. A prompt, not a ranking. */
export function SuggestedReviews({
  report,
  bookings,
  me,
  onBook,
  onOpen,
}: {
  report: KpiReport
  bookings: Booking[]
  /** The viewer, who is never suggested to themselves. */
  me: string
  onBook: (p: Person) => void
  onOpen: (p: Person) => void
}) {
  const t = useT()
  const [showAll, setShowAll] = useState(false)
  const now = nowSeconds()
  const suggestions = report.people
    .filter((p) => p.pubkey && p.pubkey !== me)
    .map((person) => ({ person, reasons: suggestionReasons(bookings, person.pubkey!, totalEvidence(person), now) }))
    .filter((s) => s.reasons.length > 0)
    .sort((a, b) => byUrgency(a.reasons, b.reasons) || a.person.name.localeCompare(b.person.name))
  const shown = showAll ? suggestions : suggestions.slice(0, 6)

  return (
    <section aria-labelledby="suggested-heading" className="pt-12">
      <h2 id="suggested-heading" className="flex items-baseline gap-2 text-2xl font-semibold tracking-[-0.02em]">
        {t('Suggested reviews')}
        <span className="text-base font-normal text-gray-500 tabular-nums">{suggestions.length}</span>
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        {t('People with no recent review, or no chat evidence this period. A prompt to check in, not a judgement.')}
      </p>
      {suggestions.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-gray-50 p-5 text-sm text-gray-600 ring-1 ring-gray-200">
          {t('Everyone has a recent or upcoming review.')}
        </p>
      ) : (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(({ person, reasons }) => (
            <li key={person.pubkey} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <Avatar name={person.name} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900">{person.name}</p>
                  <p className="truncate text-sm text-gray-600">{levelTitle(report, person.level)}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {reasons.map((r) => (
                  <ReasonLine key={r.kind} reason={r} />
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <button onClick={() => onBook(person)} className={`${primary} h-9`}>
                  <CalendarPlus aria-hidden className="size-4" />
                  {t('Book review')}
                </button>
                <button onClick={() => onOpen(person)} className={`${secondary} h-9`}>
                  {t('View profile')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {suggestions.length > 6 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-4 text-sm font-medium text-brand-700 hover:underline">
          {showAll ? t('Show fewer') : t('Show all {n}', { n: suggestions.length })}
        </button>
      )}
    </section>
  )
}

/**
 * The review row on a person's page. Managers book, reschedule or cancel;
 * the person sees their own next review (with whom, and the note).
 */
export function ReviewPanel({
  person,
  bookings,
  me,
  manager,
  onBook,
  onCancel,
}: {
  person: Person
  bookings: Booking[]
  me: string
  manager: boolean
  onBook: (p: Person, existing?: Booking) => void
  onCancel: (p: Person, b: Booking) => void
}) {
  const t = useT()
  const profiles = useProfiles()
  if (!person.pubkey) return null
  const { next, last } = reviewStatus(bookings, person.pubkey, nowSeconds())
  const box = 'mt-6 flex flex-wrap items-center gap-4 rounded-2xl p-5 ring-1'

  if (!manager) {
    if (!next) return null
    return (
      <section className={`${box} bg-brand-50 ring-brand-200`}>
        <CalendarCheck aria-hidden className="size-6 shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900">{t('Your performance review')}</p>
          <p className="text-sm text-gray-700">
            {bookingTime(next)} · {t('with {name}', { name: displayName(profiles, next.by) })}
          </p>
          {next.note && <p className="mt-2 text-sm text-gray-700">{next.note}</p>}
        </div>
      </section>
    )
  }
  if (person.pubkey === me) return null

  return next ? (
    <section className={`${box} bg-brand-50 ring-brand-200`}>
      <CalendarCheck aria-hidden className="size-6 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gray-900">{t('Performance review booked')}</p>
        <p className="text-sm text-gray-700">{bookingTime(next)}</p>
        {next.note && <p className="mt-2 text-sm text-gray-600">{next.note}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onBook(person, next)} className={secondary}>
          {t('Reschedule')}
        </button>
        <button onClick={() => onCancel(person, next)} className={`${button} text-rose-700 hover:bg-rose-50`}>
          {t('Cancel review')}
        </button>
      </div>
    </section>
  ) : (
    <section className={`${box} bg-gray-50 ring-gray-200`}>
      <CalendarPlus aria-hidden className="size-6 shrink-0 text-gray-500" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gray-900">{t('No performance review booked')}</p>
        <p className="text-sm text-gray-600">
          {last ? t('Last review: {date}', { date: bookingDay(last) }) : t('No review on record')}
        </p>
      </div>
      <button onClick={() => onBook(person)} className={primary}>
        <CalendarPlus aria-hidden className="size-4" />
        {t('Book performance review')}
      </button>
    </section>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** A week from today at 10:00, moved off the weekend. */
const defaultStart = () => {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0)
  return d
}

/** Book a performance review with someone, or reschedule an existing booking. */
export function BookReviewDialog({ person, existing, onClose }: { person: Person; existing?: Booking; onClose: () => void }) {
  const t = useT()
  const { client } = useRelay()
  const titleId = useId()
  const first = existing ? new Date(existing.start * 1000) : defaultStart()
  const [date, setDate] = useState(dateValue(first))
  const [time, setTime] = useState(`${pad(first.getHours())}:${pad(first.getMinutes())}`)
  const [minutes, setMinutes] = useState(existing ? Math.round((existing.end - existing.start) / 60) : 60)
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent, close: () => void) => {
    e.preventDefault()
    const start = Math.floor(new Date(`${date}T${time}`).getTime() / 1000)
    if (!Number.isFinite(start) || start <= nowSeconds()) {
      setError(t('Pick a time in the future.'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const id = existing?.id ?? `review-${Date.now().toString(36)}`
      await client.publish(
        bookingEvent({ id, person: person.pubkey!, start, end: start + minutes * 60, note: note.trim(), title: titleFor(person) }, existing?.createdAt),
      )
      close()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal labelledBy={titleId} onClose={onClose}>
      {(close) => (
        <form onSubmit={(e) => submit(e, close)} className="p-6 sm:p-7">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <CalendarPlus aria-hidden className="size-5" />
          </div>
          <h2 id={titleId} className="mt-4 text-xl font-semibold tracking-[-0.01em]">
            {existing ? t('Reschedule the review') : t('Book a performance review')}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {t('With {name}. They and managers can see this booking.', { name: person.name })}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-gray-800">
              {t('Date')}
              <input type="date" required min={dateValue(new Date())} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <label className="text-sm font-medium text-gray-800">
              {t('Time')}
              <input type="time" required step={900} value={time} onChange={(e) => setTime(e.target.value)} className={field} />
            </label>
          </div>
          <label className="mt-3 block text-sm font-medium text-gray-800">
            {t('Length')}
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={field}>
              {[30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {t('{n} minutes', { n: m })}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-gray-800">
            {t('Note for {name} (optional)', { name: firstName(person) })}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={t('Agenda, or anything to prepare')}
              className={`${field} h-auto py-2.5`}
            />
          </label>
          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-600">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} className={secondary}>
              {t('Cancel')}
            </button>
            <button type="submit" disabled={busy} className={`${primary} disabled:opacity-60`}>
              {existing ? t('Save changes') : t('Book review')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

/** Asks before cancelling a booked review. */
export function CancelReviewDialog({ person, booking, onClose }: { person: Person; booking: Booking; onClose: () => void }) {
  const t = useT()
  const { client } = useRelay()
  const notify = useNotify()
  return (
    <ConfirmDialog
      danger
      icon={CalendarX}
      title={t('Cancel the review with {name}?', { name: person.name })}
      description={t('{when}. It is removed for {name} and for managers.', { when: bookingTime(booking), name: firstName(person) })}
      cancelLabel={t('Keep it')}
      confirmLabel={t('Cancel review')}
      onConfirm={() => client.publish(cancellationEvent(booking, titleFor(person))).catch((err) => notify(errorText(err)))}
      onClose={onClose}
    />
  )
}
