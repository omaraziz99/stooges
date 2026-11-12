// The team dashboard: a page of its own (#/team, #/team/<name>) where managers
// read every person's KPI evidence. Anyone else sees only their own report
// here; the relay enforces that, not this page.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookOpen, CalendarCheck, ChevronDown, ChevronRight, Lock, MessagesSquare, Search, X } from 'lucide-react'
import {
  itemColor,
  itemsFor,
  levelTitle,
  pillarsWithoutEvidence,
  totalEvidence,
  type Evidence,
  type KpiReport,
  type Level,
  type Person,
  type PillarId,
} from '../lib/kpi'
import { useT } from '../lib/prefs'
import { reviewStatus, type Booking } from '../lib/reviews'
import { useChannels, useRelay, useReviewBookings } from '../state/relay'
import { Avatar } from './Avatar'
import { Logo } from './Logo'
import { Modal } from './Modal'
import { PillHeader } from './PillHeader'
import { dateFmt, EvidenceList, pillarName, shortDate, Swatch } from './KpiParts'
import { SettingsMenu } from './PrefsControls'
import { BookReviewDialog, bookingDay, CancelReviewDialog, ReviewPanel, SuggestedReviews } from './Reviews'
import { ClayLandscape } from './ui/clay-landscape'
import { cn } from '../lib/utils'

const heading = 'text-[32px] leading-[1.1] font-semibold tracking-[-0.02em] text-gray-900 sm:text-[40px]'
const secondary =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100'
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500'
const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n)
const latest = (p: Person) => p.evidence.reduce<string | null>((m, e) => (!m || e.at > m ? e.at : m), null)
const byName = (a: Person, b: Person) => a.name.localeCompare(b.name)

export function TeamDashboard({
  report,
  selected,
  onSelect,
  onOpenSource,
  onBackToChat,
}: {
  report: KpiReport | null | undefined
  selected: string | null
  onSelect: (name: string | null) => void
  onOpenSource: (e: Evidence) => void
  onBackToChat: () => void
}) {
  const t = useT()
  // Someone's own report holds only them, so open it straight away.
  const person = (report?.personal ? report.people[0] : report?.people.find((p) => p.name === selected)) ?? null
  const scroller = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const { pubkey: me } = useRelay()
  const bookings = useReviewBookings()
  const [booking, setBooking] = useState<{ person: Person; existing?: Booking } | null>(null)
  const [cancelling, setCancelling] = useState<{ person: Person; booking: Booking } | null>(null)
  const reviews = {
    bookings,
    me,
    onBook: (p: Person, existing?: Booking) => setBooking({ person: p, existing }),
    onCancel: (p: Person, b: Booking) => setCancelling({ person: p, booking: b }),
  }
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [person?.name])

  return (
    <div
      ref={scroller}
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
      className="h-dvh overflow-y-auto bg-white text-gray-900"
    >
      <PillHeader scrolled={scrolled}>
        <Logo className={scrolled ? 'h-7' : 'h-8'} />
        <span aria-hidden className="text-gray-400">
          /
        </span>
        <span className="truncate text-sm font-medium text-gray-600">
          {report?.personal ? t('Your KPI insights') : t('Team insights')}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <SettingsMenu />
          <button onClick={onBackToChat} aria-label={t('Back to chat')} className={cn(secondary, 'h-10 rounded-full', focusRing)}>
            <MessagesSquare aria-hidden className="size-4" />
            <span className="hidden sm:inline">{t('Back to chat')}</span>
          </button>
        </div>
      </PillHeader>

      <main className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        {report === undefined && <p className="py-24 text-center text-gray-600">{t('Loading report…')}</p>}
        {report === null && <NoReport />}
        {report && person && (
          <PersonPage report={report} person={person} onBack={() => onSelect(null)} onOpenSource={onOpenSource} reviews={reviews} />
        )}
        {report && !person && <Overview report={report} onSelect={onSelect} reviews={reviews} />}
      </main>
      {booking && <BookReviewDialog person={booking.person} existing={booking.existing} onClose={() => setBooking(null)} />}
      {cancelling && (
        <CancelReviewDialog person={cancelling.person} booking={cancelling.booking} onClose={() => setCancelling(null)} />
      )}
    </div>
  )
}

/** What the overview and person pages need for performance reviews. */
type Reviews = {
  bookings: Booking[]
  me: string
  onBook: (p: Person, existing?: Booking) => void
  onCancel: (p: Person, b: Booking) => void
}

function NoReport() {
  const t = useT()
  return (
    <div className="mx-auto max-w-2xl py-20">
      <h1 className={heading}>{t('No report for you yet')}</h1>
      <p className="mt-4 text-gray-700">
        {t.rich(
          "You see your own report here, and nobody else's. It appears once you have opted in ({kpi} in your account menu: click your name in the sidebar), posted in a channel marked {on}, and the agent has run. Manager accounts see everyone's.",
          { kpi: <strong>{t('KPI insights')}</strong>, on: <strong>{t('KPI insights on')}</strong> },
        )}
      </p>
      <p className="mt-4 text-gray-700">
        {t(
          'The KPI agent reads those channels, asks an AI model what each opted-in person visibly contributed, and writes the reports. With the relay running, run:',
        )}
      </p>
      <pre className="mt-4 overflow-x-auto rounded-2xl bg-gray-900 p-4 text-sm text-white">{`cd be\ngo run ./cmd/kpi`}</pre>
      <p className="mt-4 text-gray-700">
        {t.rich("It needs {gemini} and {secret} in {env}. The report appears here as soon as it's published.", {
          gemini: <code>GEMINI_API_KEY</code>,
          secret: <code>KPI_AGENT_SECRET</code>,
          env: <code>be/.env</code>,
        })}
      </p>
    </div>
  )
}

/** Pill-shaped single-choice tabs. One row; on narrow screens it scrolls sideways rather than wrapping. */
function Pills({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-gray-100 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${focusRing} ${
            o.id === value ? 'bg-white text-gray-900 shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------------------------- Overview ---------------------------------- */

function Overview({ report, onSelect, reviews }: { report: KpiReport; onSelect: (name: string) => void; reviews: Reviews }) {
  const t = useT()
  const [showFramework, setShowFramework] = useState(false)
  const [showChannels, setShowChannels] = useState(false)
  const levels = report.levels.filter((l) => itemsFor(report, l.id).length > 0)
  const pending = report.skipped?.filter((s) => s.includes('not reviewed yet')).length ?? 0

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{t('Team insights')}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {dateFmt(report.from)} – {dateFmt(report.to)} · {t('updated {date}', { date: dateFmt(report.generated_at) })}
          </p>
        </div>
        <button onClick={() => setShowFramework(true)} className={`${secondary} h-10 ${focusRing}`}>
          <BookOpen aria-hidden className="size-4" />
          {t('How the framework works')}
        </button>
      </div>

      {pending > 0 && (
        <p role="status" className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-300">
          <strong className="font-semibold">{t('Partial report.')}</strong>{' '}
          {t.rich(
            "{n} conversations and the written reviews are still pending because the AI quota ran out. Run {cmd} again after it resets; finished conversations won't be sent again.",
            { n: pending, cmd: <code>go run ./cmd/kpi</code> },
          )}
        </p>
      )}

      <Landscape report={report} levels={levels} />
      <StatTiles report={report} onShowChannels={() => setShowChannels(true)} />
      <SuggestedReviews
        report={report}
        bookings={reviews.bookings}
        me={reviews.me}
        onBook={(p) => reviews.onBook(p)}
        onOpen={(p) => onSelect(p.name)}
      />
      <People report={report} levels={levels} onSelect={onSelect} bookings={reviews.bookings} />
      {showFramework && <FrameworkDialog report={report} levels={levels} onClose={() => setShowFramework(false)} />}
      {showChannels && <WorkChannelsDialog report={report} onClose={() => setShowChannels(false)} />}
    </>
  )
}

/** The clay hills, full width: one per KPI item of a level, height = team evidence. The legend holds the numbers. */
function Landscape({ report, levels }: { report: KpiReport; levels: Level[] }) {
  const t = useT()
  const [level, setLevel] = useState(levels[0]?.id ?? '')
  const items = itemsFor(report, level)
  const count = (id: PillarId) => report.team.counts[id] ?? 0
  const max = Math.max(1, ...items.map((p) => count(p.id)))

  return (
    <figure className="overflow-hidden rounded-3xl bg-gray-50 ring-1 ring-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        {levels.length > 1 ? (
          <Pills label={t('Level')} options={levels.map((l) => ({ id: l.id, label: l.title }))} value={level} onChange={setLevel} />
        ) : (
          <span />
        )}
        <figcaption className="text-sm text-gray-600">
          {t('Team evidence per KPI item, left to right. A taller hill means more evidence was found in chat.')}
        </figcaption>
      </div>
      <ClayLandscape
        hills={items.map((p) => ({ color: itemColor(report, p.id), value: count(p.id) / max }))}
        ground="var(--color-gray-200)"
        className="h-72 sm:h-[26rem]"
      />
      <ul className="flex flex-wrap gap-x-6 gap-y-2 border-t border-gray-200 px-5 py-4">
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <Swatch report={report} pillar={p.id} />
            <span className="text-gray-800">{t(p.name)}</span>
            <span className="font-semibold text-gray-900 tabular-nums">{count(p.id)}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

function StatTiles({ report, onShowChannels }: { report: KpiReport; onShowChannels: () => void }) {
  const t = useT()
  const evidence = report.people.reduce((n, p) => n + totalEvidence(p), 0)
  const tiles = [
    { label: t('People'), value: report.people.length, tone: 'bg-brand-600 text-on-brand' },
    { label: t('Conversations reviewed'), value: report.conversations, tone: 'bg-gray-100 text-gray-900' },
    { label: t('Pieces of evidence'), value: evidence, tone: 'bg-gray-100 text-gray-900' },
    { label: t('Work channels'), value: report.channels.length, tone: 'bg-gray-100 text-gray-900', channels: report.channels },
  ]
  return (
    <section aria-label={t('Report in numbers')} className="grid grid-cols-2 gap-3 pt-6 lg:grid-cols-4">
      {tiles.map((tile) => {
        const body = (
          <>
            <span className="flex items-center justify-between gap-2 text-sm font-medium">
              {tile.label}
              {tile.channels && <ChevronRight aria-hidden className="size-4 text-gray-500" />}
            </span>
            <span className="mt-2 block text-3xl font-semibold tracking-[-0.02em] tabular-nums sm:text-4xl">
              {compact(tile.value)}
            </span>
            {tile.channels && (
              <span className="mt-2 flex flex-wrap gap-1.5">
                {tile.channels.map((c) => (
                  <span key={c} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-800 ring-1 ring-gray-200">
                    #{c}
                  </span>
                ))}
              </span>
            )}
          </>
        )
        return tile.channels ? (
          <button
            key={tile.label}
            onClick={onShowChannels}
            aria-haspopup="dialog"
            className={`rounded-2xl p-5 text-left transition-colors hover:bg-gray-200 ${tile.tone} ${focusRing}`}
          >
            {body}
          </button>
        ) : (
          <div key={tile.label} className={`rounded-2xl p-5 ${tile.tone}`}>
            {body}
          </div>
        )
      })}
    </section>
  )
}

function People({
  report,
  levels,
  onSelect,
  bookings,
}: {
  report: KpiReport
  levels: Level[]
  onSelect: (name: string) => void
  bookings: Booking[]
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('all')
  const q = query.trim().toLowerCase()
  const shown = report.people.filter((p) => (level === 'all' || p.level === level) && (!q || p.name.toLowerCase().includes(q)))

  const now = Date.now() / 1000

  return (
    <section aria-labelledby="people-heading" className="pt-12">
      {/* Collapsible: a native <details>, open to start with. */}
      <details open className="group/people">
        <summary
          className={`-mx-2 flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-2 py-1 hover:bg-gray-50 [&::-webkit-details-marker]:hidden ${focusRing}`}
        >
          <div>
            <h2 id="people-heading" className="flex items-baseline gap-2 text-2xl font-semibold tracking-[-0.02em]">
              {t('People')}
              <span className="text-base font-normal text-gray-500 tabular-nums">{report.people.length}</span>
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {t('Grouped by level, alphabetical. Open anyone for their evidence and review notes.')}
            </p>
          </div>
          <ChevronDown aria-hidden className="size-5 shrink-0 text-gray-500 transition-transform group-open/people:rotate-180" />
        </summary>
        <div className="mt-5 flex w-full flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-64">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder={t('Search people')}
              aria-label={t('Search people')}
              className="h-11 w-full rounded-xl border border-gray-200 bg-white pr-4 pl-10 text-gray-900 outline-none placeholder:text-gray-500 focus:border-brand-500"
            />
          </label>
          {levels.length > 1 && (
            <Pills
              label={t('Level')}
              options={[{ id: 'all', label: t('All levels') }, ...levels.map((l) => ({ id: l.id, label: l.title }))]}
              value={level}
              onChange={setLevel}
            />
          )}
        </div>

      {levels.map((l) => {
        const members = shown.filter((p) => p.level === l.id).sort(byName)
        if (members.length === 0) return null
        return (
          <div key={l.id} className="mt-10">
            <h3 className="mb-4 flex items-baseline gap-2 font-semibold text-gray-900">
              {l.title}
              <span className="text-sm font-normal text-gray-500">{members.length}</span>
            </h3>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((p) => (
                <li key={p.pubkey ?? p.name}>
                  <PersonCard
                    report={report}
                    person={p}
                    onOpen={() => onSelect(p.name)}
                    next={p.pubkey ? reviewStatus(bookings, p.pubkey, now).next : undefined}
                  />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {shown.length === 0 && <p className="mt-10 text-gray-600">{t('No one matches "{q}".', { q: query.trim() })}</p>}
      </details>
    </section>
  )
}

function PersonCard({ report, person, onOpen, next }: { report: KpiReport; person: Person; onOpen: () => void; next?: Booking }) {
  const t = useT()
  const n = totalEvidence(person)
  const last = latest(person)
  const found = itemsFor(report, person.level).filter((p) => person.counts[p.id])
  const top = [...found].sort((a, b) => person.counts[b.id] - person.counts[a.id]).slice(0, 2)

  return (
    <button
      onClick={onOpen}
      className={`group flex h-full w-full flex-col rounded-2xl border border-gray-200 bg-white p-6 text-left transition hover:shadow-[0_16px_40px_-20px_rgb(0_0_0/0.3)] motion-safe:hover:-translate-y-0.5 ${focusRing}`}
    >
      <span className="flex items-center gap-3">
        <Avatar name={person.name} size="lg" />
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold text-gray-900">{person.name}</span>
          <span className="block truncate text-sm text-gray-600">{levelTitle(report, person.level)}</span>
        </span>
      </span>
      {next && (
        <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800">
          <CalendarCheck aria-hidden className="size-3.5" />
          {t('Review booked: {date}', { date: bookingDay(next) })}
        </span>
      )}
      <span className="mt-4 line-clamp-2 text-sm leading-relaxed text-gray-700">
        {person.review?.headline ??
          (n ? t('No written review yet. The evidence is ready.') : t('No evidence found in these channels yet'))}
      </span>
      <span className="mt-auto block pt-5">
        {/* The mix of their own evidence, as shares: it compares items, never people. */}
        <span aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-gray-200">
          {found.map((p) => (
            <span key={p.id} className="h-full" style={{ flexGrow: person.counts[p.id], background: itemColor(report, p.id) }} />
          ))}
        </span>
        {top.length > 0 && (
          <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
            {top.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5">
                <Swatch report={report} pillar={p.id} />
                {t(p.name)}
              </span>
            ))}
          </span>
        )}
        <span className="mt-4 flex items-center justify-between gap-2 text-xs text-gray-600">
          <span>
            {t(n === 1 ? '{n} item' : '{n} items', { n })}
            {last && ` · ${t('latest {date}', { date: shortDate(last) })}`}
          </span>
          <span aria-hidden className="text-base text-gray-900 transition-transform motion-safe:group-hover:translate-x-0.5">
            →
          </span>
        </span>
      </span>
    </button>
  )
}

/**
 * Which channels the KPI agent reads right now (live, from each channel's
 * setting), and how that compares with this report: a channel turned on since
 * is read on the next run, one turned off is left out from then on.
 */
function WorkChannelsDialog({ report, onClose }: { report: KpiReport; onClose: () => void }) {
  const t = useT()
  const titleId = useId()
  const { channels } = useChannels()
  const active = channels.filter((c) => c.kpiReview).sort((a, b) => a.name.localeCompare(b.name))
  const inReport = new Set(report.channels)
  const turnedOff = report.channels.filter((id) => !active.some((c) => c.id === id))
  const badge = 'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium'

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="max-w-lg">
      {(close) => (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 pt-6 pb-4">
            <div>
              <h2 id={titleId} className="text-xl font-semibold tracking-[-0.01em]">
                {t('Work channels')}
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                {t('The KPI agent reads only these channels, and only messages from people who opted in.')}
              </p>
            </div>
            <button onClick={close} aria-label={t('Close')} className={`-mr-2 rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 ${focusRing}`}>
              <X aria-hidden className="size-5" />
            </button>
          </div>

          <div className="overflow-y-auto px-6 py-4">
            {active.length === 0 ? (
              <p className="py-2 text-sm text-gray-600">{t('No channel is marked for KPI insights.')}</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {active.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 py-3">
                    <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-gray-500" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900">#{c.name}</p>
                      {c.about && <p className="mt-0.5 text-sm text-gray-600">{c.about}</p>}
                    </div>
                    {inReport.has(c.id) ? (
                      <span className={`${badge} bg-brand-50 text-brand-800 ring-1 ring-brand-200`}>{t('In this report')}</span>
                    ) : (
                      <span className={`${badge} bg-gray-100 text-gray-700`}>{t('From the next run')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {turnedOff.length > 0 && (
              <div className="mt-4 rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-200">
                <p className="text-sm font-medium text-gray-800">{t('Turned off since this report')}</p>
                <p className="mt-1 text-sm text-gray-600">{turnedOff.map((id) => `#${id}`).join(', ')}</p>
              </div>
            )}
            <p className="mt-4 text-xs text-gray-500">
              {t("A channel's creator turns KPI insights on or off from the channel header.")}
            </p>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** "How the framework works": the weighted KPI items of each level. */
function FrameworkDialog({ report, levels, onClose }: { report: KpiReport; levels: Level[]; onClose: () => void }) {
  const t = useT()
  const titleId = useId()
  const [level, setLevel] = useState(levels[0]?.id ?? '')

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="max-w-2xl">
      {(close) => (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 pt-6 pb-4">
            <h2 id={titleId} className="pt-1 text-xl font-semibold tracking-[-0.01em]">
              {t('How the framework works')}
            </h2>
            <button onClick={close} aria-label={t('Close')} className={`-mr-2 rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 ${focusRing}`}>
              <X aria-hidden className="size-5" />
            </button>
          </div>

          <div className="overflow-y-auto px-6 py-5">
            <p className="text-sm leading-relaxed text-gray-700">
              {t(
                "Each level has its own weighted KPI items. Every piece of evidence is filed under one item of the person's own level. Weights show what matters most; they are never added up into a score.",
              )}
            </p>
            {levels.length > 1 && (
              <div className="mt-5">
                <Pills label={t('Level')} options={levels.map((l) => ({ id: l.id, label: l.title }))} value={level} onChange={setLevel} />
              </div>
            )}
            <ul className="mt-3 divide-y divide-gray-200">
              {itemsFor(report, level).map((p) => (
                <li key={p.id} className="py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-baseline gap-2 font-semibold">
                      <Swatch report={report} pillar={p.id} />
                      {t(p.name)}
                    </span>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums">{p.weight}%</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{p.kpi}</p>
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer font-medium text-gray-800 underline-offset-2 hover:underline">
                      {t('What counts as evidence')}
                    </summary>
                    <p className="mt-1 leading-relaxed text-gray-600">{p.description}</p>
                  </details>
                </li>
              ))}
            </ul>

          </div>
        </div>
      )}
    </Modal>
  )
}

/* --------------------------------- One person --------------------------------- */

function PersonPage({
  report,
  person,
  onBack,
  onOpenSource,
  reviews,
}: {
  report: KpiReport
  person: Person
  onBack: () => void
  onOpenSource: (e: Evidence) => void
  reviews: Reviews
}) {
  const t = useT()
  const [filter, setFilter] = useState<PillarId | 'all'>('all')
  const shown = person.evidence.filter((e) => filter === 'all' || e.pillar === filter)
  const n = totalEvidence(person)
  const last = latest(person)
  const firstName = person.name.split(/\s+/)[0]
  const pill = 'rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700'

  return (
    <div className="py-8 lg:py-12">
      {!report.personal && (
        <button onClick={onBack} className={`text-sm font-medium text-gray-600 hover:text-gray-900 ${focusRing}`}>
          {t('← All people')}
        </button>
      )}
      <header className="mt-6 flex flex-wrap items-center gap-5">
        <Avatar name={person.name} size="xl" />
        <div className="min-w-0">
          <h1 className="text-[40px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[52px]">{person.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={pill}>{levelTitle(report, person.level)}</span>
            <span className="text-sm text-gray-600">
              {report.personal
                ? t("This is your own report. Only you and your manager can see it; you cannot see anyone else's.")
                : t('Visible only to {name} and managers.', { name: firstName })}
            </span>
          </div>
        </div>
      </header>

      <ReviewPanel person={person} manager={!report.personal} {...reviews} />

      <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [t('Pieces of evidence'), compact(n)],
          [t('Messages in work channels'), compact(person.messages)],
          [t('High impact'), compact(person.impact.high ?? 0)],
          [t('Latest evidence'), last ? dateFmt(last) : '–'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-gray-100 p-4 sm:p-5">
            <dt className="text-sm text-gray-600">{label}</dt>
            <dd className="mt-2 text-3xl font-semibold tracking-[-0.02em] tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {n === 0 ? (
            <p className="rounded-3xl bg-gray-100 p-6 text-gray-700">
              {t(
                'No evidence found for {name} in {channels} for this period. Their work may happen in other channels or tools, so ask about it directly.',
                { name: person.name, channels: report.channels.map((c) => `#${c}`).join(', ') },
              )}
            </p>
          ) : (
            <Review report={report} person={person} onOpenSource={onOpenSource} />
          )}
        </div>
        <div className="space-y-6 lg:col-span-5">
          <ItemsCard report={report} person={person} filter={filter} onFilter={setFilter} />
          {n > 0 && <Timeline report={report} person={person} />}
        </div>
      </div>

      {n > 0 && (
        <section aria-labelledby="evidence-heading" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="evidence-heading" className={heading}>
              {t('Evidence ({n})', { n: shown.length })}
            </h2>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} className={`${secondary} h-9 ${focusRing}`}>
                <Swatch report={report} pillar={filter} />
                {t(pillarName(report, filter))} ✕
              </button>
            )}
          </div>
          <p className="mt-2 max-w-3xl text-gray-700">
            {t("Each item links to the messages it comes from. Check them before using any item in a review. Chat shows only part of anyone's work.")}
          </p>
          <div className="mt-6">
            {shown.length ? (
              <EvidenceList report={report} items={shown} onOpenSource={onOpenSource} />
            ) : (
              <p className="text-gray-600">{t('No evidence for this KPI item yet.')}</p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

/** The AI-drafted review as a run of cards: summary, highlights, discussion points, and gaps to ask about. */
function Review({ report, person, onOpenSource }: { report: KpiReport; person: Person; onOpenSource: (e: Evidence) => void }) {
  const t = useT()
  const review = person.review
  const gaps = pillarsWithoutEvidence(report, person)
  const cardTitle = 'text-xs font-semibold tracking-[0.12em] uppercase'

  return (
    <>
      {review ? (
        <article className="rounded-3xl bg-brand-600 p-6 text-on-brand sm:p-8">
          <p className={`${cardTitle} text-on-brand/75`}>{t('AI-drafted summary')}</p>
          <h2 className="mt-4 text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[32px]">
            {review.headline}
          </h2>
          <p className="mt-4 leading-relaxed text-on-brand/90">{review.summary}</p>
        </article>
      ) : (
        <p className="rounded-3xl bg-gray-100 p-6 text-gray-700">
          {t('No written review was generated for this person. The evidence below is still available.')}
        </p>
      )}

      {review && review.highlights.length > 0 && (
        <Card title={t('Highlights')}>
          <ul className="space-y-4">
            {review.highlights.map((h, i) => (
              <li key={i}>
                <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Swatch report={report} pillar={h.pillar} />
                  {t(pillarName(report, h.pillar))}
                </p>
                <p className="mt-1 leading-relaxed text-gray-800">{h.text}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {h.evidence
                    .filter((idx) => person.evidence[idx])
                    .map((idx) => (
                      <button
                        key={idx}
                        onClick={() => onOpenSource(person.evidence[idx])}
                        title={person.evidence[idx].summary}
                        className={`rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs font-medium text-gray-700 hover:border-brand-500 ${focusRing}`}
                      >
                        {shortDate(person.evidence[idx].at)} · #{person.evidence[idx].channel}
                      </button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {review && review.discussion_points.length > 0 && (
        <Card title={t('Discussion points')}>
          <ol className="space-y-3">
            {review.discussion_points.map((q, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                  {i + 1}
                </span>
                <span className="leading-relaxed text-gray-800">{q}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {gaps.length > 0 && (
        <article className="rounded-3xl bg-gray-100 p-6 text-gray-900 sm:p-8">
          <h3 className={`${cardTitle} text-gray-600`}>{t('Worth asking about')}</h3>
          <p className="mt-3 leading-relaxed">
            {t('No chat evidence yet for these items. This work may happen outside these channels, so ask about it.')}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {gaps.map((g) => (
              <li key={g.id} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-medium ring-1 ring-gray-200">
                <Swatch report={report} pillar={g.id} />
                {t(g.name)}
              </li>
            ))}
          </ul>
        </article>
      )}
    </>
  )
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 sm:p-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-[0.12em] text-gray-600 uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** The person's level's KPI items: weight, a bar of their evidence, the count. Rows filter the evidence list. */
function ItemsCard({
  report,
  person,
  filter,
  onFilter,
}: {
  report: KpiReport
  person: Person
  filter: PillarId | 'all'
  onFilter: (f: PillarId | 'all') => void
}) {
  const t = useT()
  const items = itemsFor(report, person.level)
  const max = Math.max(1, ...items.map((p) => person.counts[p.id] ?? 0))
  const grid = 'grid grid-cols-[minmax(0,1fr)_2.25rem_minmax(2.5rem,22%)_1.75rem] items-center gap-3'

  return (
    <Card title={t('KPI items')} aside={<span className="text-sm text-gray-600">{levelTitle(report, person.level)}</span>}>
      <div className={`${grid} border-b border-gray-200 pb-2 text-[11px] font-medium tracking-wide text-gray-500 uppercase`}>
        <span>{t('KPI item')}</span>
        <span className="text-right">{t('Weight')}</span>
        <span />
        <span className="justify-self-end whitespace-nowrap">{t('Evidence')}</span>
      </div>
      <ul>
        {items.map((p) => {
          const n = person.counts[p.id] ?? 0
          const active = filter === p.id
          return (
            <li key={p.id}>
              <button
                onClick={() => onFilter(active ? 'all' : p.id)}
                aria-pressed={active}
                title={`${p.kpi}\n\n${p.description}`}
                className={`${grid} -mx-2 w-[calc(100%+1rem)] rounded-xl px-2 py-2.5 text-left transition-colors ${focusRing} ${
                  active ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-900">
                  <Swatch report={report} pillar={p.id} />
                  <span className="leading-snug">{t(p.name)}</span>
                </span>
                <span className="text-right text-xs text-gray-600 tabular-nums">{p.weight}%</span>
                <span aria-hidden className="h-2">
                  {n > 0 && (
                    <span
                      className="block h-full rounded-r"
                      style={{ width: `max(6px, ${(n / max) * 100}%)`, background: itemColor(report, p.id) }}
                    />
                  )}
                </span>
                <span className="text-right text-sm font-semibold text-gray-900 tabular-nums">{n}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

const WEEK = 7 * 24 * 60 * 60 * 1000
const mondayOf = (d: Date) => {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

/** Weekly columns over the report period, stacked by KPI item (colours match the items card). */
function Timeline({ report, person }: { report: KpiReport; person: Person }) {
  const t = useT()
  const [hover, setHover] = useState<number | null>(null)
  const items = itemsFor(report, person.level)

  // ponytail: weekly buckets only; group by month once review periods run past ~6 months.
  const weeks = useMemo(() => {
    const start = mondayOf(new Date(report.from)).getTime()
    const count = Math.max(1, Math.ceil((new Date(report.to).getTime() - start + 1) / WEEK))
    const out = Array.from({ length: count }, (_, i) => ({ start: start + i * WEEK, total: 0, counts: {} as Record<PillarId, number> }))
    for (const e of person.evidence) {
      const w = out[Math.min(count - 1, Math.max(0, Math.floor((new Date(e.at).getTime() - start) / WEEK)))]
      w.total++
      w.counts[e.pillar] = (w.counts[e.pillar] ?? 0) + 1
    }
    return out
  }, [report.from, report.to, person.evidence])

  const max = Math.max(1, ...weeks.map((w) => w.total))
  const peak = weeks.findIndex((w) => w.total === max)
  const weekLabel = (ms: number) => t('Week of {date}', { date: shortDate(new Date(ms).toISOString()) })
  // A week belongs to the month of its Thursday (as in ISO weeks), so 31 Aug–6 Sep is September.
  const month = (ms: number) => new Date(ms + 3 * 24 * 60 * 60 * 1000).toLocaleDateString([], { month: 'short' })

  return (
    <Card title={t('Evidence over time')} aside={<span className="text-sm text-gray-600">{t('Per week. Colours match the KPI items.')}</span>}>
      <div className="relative h-40 border-b border-gray-200">
        <div className="flex h-full items-end gap-0.5">
          {weeks.map((w, i) => {
            const parts = items.filter((p) => w.counts[p.id])
            const where = i < weeks.length / 3 ? 'left-0' : i > (weeks.length * 2) / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
            return (
              <div
                key={w.start}
                tabIndex={0}
                role="img"
                aria-label={`${weekLabel(w.start)}: ${t('{n} pieces of evidence', { n: w.total })}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="relative flex h-full flex-1 items-end justify-center outline-none focus-visible:bg-gray-50"
              >
                {w.total > 0 && (
                  <div className="relative flex w-full max-w-6 flex-col-reverse gap-0.5" style={{ height: `${(w.total / max) * 100}%` }}>
                    {parts.map((p) => (
                      <span
                        key={p.id}
                        className="w-full last:rounded-t"
                        style={{ flexGrow: w.counts[p.id], background: itemColor(report, p.id) }}
                      />
                    ))}
                    {i === peak && (
                      <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-xs font-semibold text-gray-900 tabular-nums">
                        {w.total}
                      </span>
                    )}
                  </div>
                )}
                {hover === i && (
                  <div
                    role="tooltip"
                    style={{ bottom: `calc(${(w.total / max) * 100}% + ${i === peak ? 24 : 8}px)` }}
                    className={`pointer-events-none absolute z-10 w-max max-w-56 rounded-xl bg-gray-900 p-3 text-xs text-white shadow-lg ${where}`}
                  >
                    <p className="font-semibold">{weekLabel(w.start)}</p>
                    <p className="mt-0.5 opacity-80">{t('{n} pieces of evidence', { n: w.total })}</p>
                    {parts.map((p) => (
                      <p key={p.id} className="mt-1 flex items-center gap-1.5">
                        <Swatch report={report} pillar={p.id} />
                        <span className="flex-1">{t(p.name)}</span>
                        <span className="font-semibold tabular-nums">{w.counts[p.id]}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div aria-hidden className="mt-2 flex gap-0.5 text-[11px] text-gray-500">
        {weeks.map((w, i) => (
          <span key={w.start} className="flex-1 whitespace-nowrap">
            {i === 0 || month(w.start) !== month(weeks[i - 1].start) ? month(w.start) : ''}
          </span>
        ))}
      </div>
    </Card>
  )
}
