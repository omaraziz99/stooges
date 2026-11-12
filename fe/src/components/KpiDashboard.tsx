import { useMemo, useState } from 'react'
import {
  commandFor,
  itemColor,
  itemsFor,
  levelTitle,
  totalEvidence,
  type Evidence,
  type KpiReport,
  type Person,
  type PillarId,
} from '../lib/kpi'
import { avatarColor, initials } from '../lib/format'
import { useT } from '../lib/prefs'
import { dateFmt, EvidenceList, ReviewCard, Swatch } from './KpiParts'

export function KpiDashboard({
  report,
  selected,
  onSelect,
  onOpenSource,
  onOpenSidebar,
}: {
  report: KpiReport | null | undefined
  selected: string | null
  onSelect: (name: string | null) => void
  onOpenSource: (e: Evidence) => void
  onOpenSidebar: () => void
}) {
  const t = useT()
  // Someone's own report holds only them, so open it straight away.
  const person =
    (report?.personal ? report.people[0] : report?.people.find((p) => p.name === selected)) ?? null

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <button
          onClick={onOpenSidebar}
          className="rounded p-1.5 text-stone-600 hover:bg-stone-100 md:hidden"
          aria-label={t('Open channel list')}
        >
          ☰
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-stone-900">
            {report?.personal ? t('Your KPI insights') : t('KPI insights')}
          </h1>
          {report && (
            <p className="truncate text-xs text-stone-500">
              {report.channels.map((c) => `#${c}`).join(', ')} · {dateFmt(report.from)} – {dateFmt(report.to)}
            </p>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {report?.personal && (
          <p className="border-b border-stone-200 bg-stone-50 px-6 py-2 text-xs text-stone-600">
            {t("This is your own report. Only you and your manager can see it; you cannot see anyone else's.")}
          </p>
        )}
        {report === undefined && <p className="p-6 text-sm text-stone-500">{t('Loading report…')}</p>}
        {report === null && <NoReport />}
        {report && !person && <Overview report={report} onSelect={onSelect} />}
        {report && person && (
          <PersonView report={report} person={person} onBack={() => onSelect(null)} onOpenSource={onOpenSource} />
        )}
      </div>
    </section>
  )
}

function NoReport() {
  const t = useT()
  return (
    <div className="mx-auto max-w-xl p-6">
      <h2 className="text-lg font-semibold text-stone-900">{t('No report for you yet')}</h2>
      <p className="mt-2 text-sm text-stone-600">
        {t.rich(
          "You see your own report here, and nobody else's. It appears once you have opted in ({kpi} in your account menu: click your name in the sidebar), posted in a channel marked {on}, and the agent has run. Manager accounts see everyone's.",
          { kpi: <strong>{t('KPI insights')}</strong>, on: <strong>{t('KPI insights on')}</strong> },
        )}
      </p>
      <p className="mt-3 text-sm text-stone-600">
        {t(
          'The KPI agent reads those channels, asks an AI model what each opted-in person visibly contributed, and writes the reports. With the relay running, run:',
        )}
      </p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-stone-900 p-3 text-xs text-stone-100">
        {`cd be\ngo run ./cmd/kpi`}
      </pre>
      <p className="mt-3 text-sm text-stone-600">
        {t.rich("It needs {gemini} and {secret} in {env}. The report appears here as soon as it's published.", {
          gemini: <code>GEMINI_API_KEY</code>,
          secret: <code>KPI_AGENT_SECRET</code>,
          env: <code>be/.env</code>,
        })}
      </p>
    </div>
  )
}

function Notice({ report }: { report: KpiReport }) {
  const t = useT()
  const pending = report.skipped?.filter((s) => s.includes('not reviewed yet')).length ?? 0
  return (
    <div className="space-y-3">
      {pending > 0 && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">{t('Partial report.')}</strong>{' '}
          {t.rich(
            "{n} conversations and the written reviews are still pending because the AI quota ran out. Run {cmd} again after it resets; finished conversations won't be sent again.",
            { n: pending, cmd: <code>go run ./cmd/kpi</code> },
          )}
        </div>
      )}
      {report.model.startsWith('sample') && (
        <div role="status" className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <strong className="font-semibold">{t('Sample report.')}</strong>{' '}
          {t('Built from simple keyword rules, not AI, so the dashboard can be shown without an API key. Do not use it for real reviews.')}
        </div>
      )}
      <NoticeBody report={report} />
    </div>
  )
}

function NoticeBody({ report }: { report: KpiReport }) {
  const t = useT()
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
      <strong className="font-semibold">{t('AI-drafted evidence, for conversations, not rankings.')}</strong>{' '}
      {t("Each item links to the messages it comes from. Check them before using any item in a review. Chat shows only part of anyone's work.")}
      <span className="mt-1 block text-xs text-stone-500">
        {t('{n} conversations reviewed by {model} on {date}', {
          n: report.conversations,
          model: report.model,
          date: dateFmt(report.generated_at),
        })}
        {report.skipped?.length ? ` · ${t('{n} skipped', { n: report.skipped.length })}` : ''} ·{' '}
        {t.rich('Tip: type {cmd} in any channel to open a review', { cmd: <code>/kpi-&lt;name&gt;</code> })}
      </span>
    </div>
  )
}

/** One level's KPI items as labelled rows: weight, a bar, and the evidence count. */
function ItemRows({
  report,
  level,
  counts,
  active,
  onPick,
}: {
  report: KpiReport
  level: string
  counts: Record<PillarId, number>
  /** With onPick, rows are filter buttons and `active` is the picked one. */
  active?: PillarId | 'all'
  onPick?: (id: PillarId) => void
}) {
  const t = useT()
  const items = itemsFor(report, level)
  const max = Math.max(1, ...items.map((p) => counts[p.id] ?? 0))
  return (
    <ul className="divide-y divide-stone-100">
      {items.map((p) => {
        const n = counts[p.id] ?? 0
        const body = (
          <>
            <span className="min-w-0">
              <span className="flex items-baseline gap-1.5 text-sm font-medium text-stone-900">
                <Swatch report={report} pillar={p.id} />
                <span>{t(p.name)}</span>
              </span>
              <span className="mt-0.5 line-clamp-1 text-xs text-stone-500">{p.kpi}</span>
            </span>
            <span className="text-right text-xs font-medium text-stone-500 tabular-nums">{p.weight}%</span>
            <span className="h-2 overflow-hidden rounded-full bg-stone-100" aria-hidden>
              <span
                className="block h-full rounded-full"
                style={{ width: n ? `max(4px, ${(n / max) * 100}%)` : 0, background: itemColor(report, p.id) }}
              />
            </span>
            <span className="text-right text-sm font-semibold text-stone-900 tabular-nums">{n}</span>
          </>
        )
        const grid = 'grid w-full grid-cols-[minmax(0,1fr)_2.5rem_minmax(2.5rem,22%)_4rem] items-center gap-3 px-3 py-2.5 text-left'
        return (
          <li key={p.id} title={`${p.kpi}\n\n${p.description}`}>
            {onPick ? (
              <button
                onClick={() => onPick(p.id)}
                aria-pressed={active === p.id}
                className={`${grid} hover:bg-stone-50 ${active === p.id ? 'bg-stone-100' : ''}`}
              >
                {body}
              </button>
            ) : (
              <div className={grid}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A level's KPI items for reference: name, weight, and a description of what the item covers. */
function ItemList({ report, level }: { report: KpiReport; level: string }) {
  const t = useT()
  return (
    <ul className="divide-y divide-stone-100">
      {itemsFor(report, level).map((p) => (
        <li key={p.id} className="px-3 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-baseline gap-1.5 text-sm font-semibold text-stone-900">
              <Swatch report={report} pillar={p.id} />
              {t(p.name)}
            </span>
            <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700 tabular-nums">
              {p.weight}%
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-stone-600">
            {p.kpi} {p.description}
          </p>
        </li>
      ))}
    </ul>
  )
}

/** Column labels for ItemRows. */
function ItemRowsHeader() {
  const t = useT()
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(2.5rem,22%)_4rem] gap-3 border-b border-stone-200 px-3 py-1.5 text-[11px] font-medium tracking-wide text-stone-500 uppercase">
      <span>{t('KPI item')}</span>
      <span className="text-right">{t('Weight')}</span>
      <span />
      <span className="text-right">{t('Evidence')}</span>
    </div>
  )
}

function Overview({ report, onSelect }: { report: KpiReport; onSelect: (name: string) => void }) {
  const t = useT()
  const levels = report.levels.filter((l) => itemsFor(report, l.id).length > 0)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Notice report={report} />

      <section aria-labelledby="team-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="team-heading" className="text-sm font-semibold text-stone-900">
            {t('KPI items by level')}
          </h2>
          <span className="text-xs text-stone-500">{report.framework}</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {levels.map((l) => (
            <div key={l.id} className="overflow-hidden rounded-xl border border-stone-200">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2.5">
                <h3 className="font-semibold text-stone-900">{l.title}</h3>
                <span className="text-xs text-stone-500">{t('Weight')}</span>
              </div>
              <ItemList report={report} level={l.id} />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="people-heading" className="space-y-4">
        <h2 id="people-heading" className="text-sm font-semibold text-stone-900">
          {t('People')} <span className="font-normal text-stone-500">{t('(by level, alphabetical)')}</span>
        </h2>
        {levels.map((l) => {
          const members = report.people.filter((p) => p.level === l.id)
          if (members.length === 0) return null
          const maxTotal = Math.max(1, ...members.map(totalEvidence))
          return (
            <div key={l.id}>
              <h3 className="mb-1.5 text-xs font-medium tracking-wide text-stone-500 uppercase">{l.title}</h3>
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                {members.map((person) => (
                  <li key={person.pubkey ?? person.name}>
                    <button
                      onClick={() => onSelect(person.name)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-stone-50"
                    >
                      <div
                        aria-hidden
                        className={`${avatarColor(person.name.padEnd(12, 'x'))} flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white`}
                      >
                        {initials(person.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium text-stone-900">{person.name}</span>
                          <span className="shrink-0 text-xs text-stone-500 tabular-nums">
                            {t(totalEvidence(person) === 1 ? '{n} item' : '{n} items', { n: totalEvidence(person) })} ·{' '}
                            {t('{n} messages', { n: person.messages })}
                          </span>
                        </div>
                        <PillarBar report={report} person={person} maxTotal={maxTotal} />
                      </div>
                      <span aria-hidden className="text-stone-400">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </section>
    </div>
  )
}

/** One thin stacked bar per person: segment length = evidence count per KPI item of their level. */
function PillarBar({ report, person, maxTotal }: { report: KpiReport; person: Person; maxTotal: number }) {
  const t = useT()
  const total = totalEvidence(person)
  if (total === 0) return <p className="mt-1.5 text-xs text-stone-400">{t('No evidence found in these channels yet')}</p>
  const items = itemsFor(report, person.level).filter((p) => (person.counts[p.id] ?? 0) > 0)
  const summary = items.map((p) => `${t(p.name)}: ${person.counts[p.id]}`).join(', ')
  return (
    <div className="mt-1.5">
      <div className="flex h-2.5 gap-0.5" style={{ width: `${(total / maxTotal) * 100}%` }} role="img" aria-label={summary}>
        {items.map((p) => (
          <span
            key={p.id}
            title={`${t(p.name)}: ${person.counts[p.id]}`}
            className="h-full first:rounded-l last:rounded-r"
            style={{ flexGrow: person.counts[p.id], background: itemColor(report, p.id) }}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-stone-500">{summary}</p>
    </div>
  )
}

function PersonView({
  report,
  person,
  onBack,
  onOpenSource,
}: {
  report: KpiReport
  person: Person
  onBack: () => void
  onOpenSource: (e: Evidence) => void
}) {
  const t = useT()
  const [filter, setFilter] = useState<PillarId | 'all'>('all')
  const items = useMemo(
    () => person.evidence.filter((e) => filter === 'all' || e.pillar === filter),
    [person, filter],
  )

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      {!report.personal && (
        <button onClick={onBack} className="text-sm font-medium text-sky-700 hover:underline">
          {t('← All people')}
        </button>
      )}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-stone-900">{person.name}</h2>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 text-xs font-medium text-stone-600">
            {levelTitle(report, person.level)}
          </span>
        </div>
        <p className="mt-1 text-sm text-stone-500">
          {t('{n} pieces of evidence from {m} messages', { n: totalEvidence(person), m: person.messages })} ·{' '}
          {(['high', 'medium', 'low'] as const).map((i) => t(`{n} ${i}`, { n: person.impact[i] })).join(', ')}{' '}
          {t('impact · in chat:')}{' '}
          <code>{commandFor(person.name)}</code>
        </p>
      </div>

      <ReviewCard report={report} person={person} onOpenSource={onOpenSource} />

      <section aria-labelledby="items-heading" className="overflow-hidden rounded-xl border border-stone-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2.5">
          <h3 id="items-heading" className="font-semibold text-stone-900">
            {t('KPI items')}
          </h3>
          <button
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
            className={`text-xs font-medium ${filter === 'all' ? 'text-stone-900' : 'text-sky-700 hover:underline'}`}
          >
            {t('All ({n})', { n: totalEvidence(person) })}
          </button>
        </div>
        <ItemRowsHeader />
        <ItemRows
          report={report}
          level={person.level}
          counts={person.counts}
          active={filter}
          onPick={(id) => setFilter((f) => (f === id ? 'all' : id))}
        />
      </section>

      {person.evidence.length > 0 &&
        (items.length === 0 ? (
          <p className="text-sm text-stone-500">{t('No evidence for this KPI item yet.')}</p>
        ) : (
          <EvidenceList report={report} items={items} onOpenSource={onOpenSource} />
        ))}
    </div>
  )
}
