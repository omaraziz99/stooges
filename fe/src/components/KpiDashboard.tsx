import { useMemo, useState } from 'react'
import { commandFor, PILLAR_COLORS, totalEvidence, type Evidence, type KpiReport, type Person, type PillarId } from '../lib/kpi'
import { avatarColor, initials } from '../lib/format'
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
  const person = report?.people.find((p) => p.name === selected) ?? null

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <button
          onClick={onOpenSidebar}
          className="rounded p-1.5 text-stone-600 hover:bg-stone-100 md:hidden"
          aria-label="Open channel list"
        >
          ☰
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-stone-900">KPI insights</h1>
          {report && (
            <p className="truncate text-xs text-stone-500">
              {report.channels.map((c) => `#${c}`).join(', ')} · {dateFmt(report.from)} to {dateFmt(report.to)}
            </p>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {report === undefined && <p className="p-6 text-sm text-stone-500">Loading report…</p>}
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
  return (
    <div className="mx-auto max-w-xl p-6">
      <h2 className="text-lg font-semibold text-stone-900">No report yet</h2>
      <p className="mt-2 text-sm text-stone-600">
        The KPI agent reads team channels, asks Claude what each person visibly contributed, and writes a report here.
        With the relay running, run:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-stone-900 p-3 text-xs text-stone-100">
        {`cd be\ngo run ./cmd/kpi`}
      </pre>
      <p className="mt-3 text-sm text-stone-600">
        It needs <code>GEMINI_API_KEY</code> and <code>KPI_AGENT_SECRET</code> in <code>be/.env</code>. The report
        appears here as soon as it's published.
      </p>
    </div>
  )
}

function Notice({ report }: { report: KpiReport }) {
  const pending = report.skipped?.filter((s) => s.includes('not reviewed yet')).length ?? 0
  return (
    <div className="space-y-3">
      {pending > 0 && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Partial report.</strong> {pending} conversations and the written reviews are
          still pending because the AI quota ran out. Run <code>go run ./cmd/kpi</code> again after it resets; finished
          conversations won't be sent again.
        </div>
      )}
      <NoticeBody report={report} />
    </div>
  )
}

function NoticeBody({ report }: { report: KpiReport }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
      <strong className="font-semibold">AI-drafted evidence, for conversations, not rankings.</strong> Each item links to
      the messages it comes from. Check them before using any item in a review. Chat shows only part of anyone's work.
      <span className="mt-1 block text-xs text-stone-500">
        {report.conversations} conversations reviewed by {report.model} on {dateFmt(report.generated_at)}
        {report.skipped?.length ? ` · ${report.skipped.length} skipped` : ''} · Tip: type{' '}
        <code>/kpi-&lt;name&gt;</code> in any channel to open a review
      </span>
    </div>
  )
}

function Legend({ report }: { report: KpiReport }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
      {report.pillars.map((p) => (
        <li key={p.id} className="flex items-center gap-1.5">
          <Swatch pillar={p.id} />
          {p.name}
        </li>
      ))}
    </ul>
  )
}

function Overview({ report, onSelect }: { report: KpiReport; onSelect: (name: string) => void }) {
  const maxTotal = Math.max(1, ...report.people.map(totalEvidence))

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <Notice report={report} />

      <section aria-labelledby="team-heading">
        <h2 id="team-heading" className="mb-3 text-sm font-semibold text-stone-900">
          Team evidence by pillar
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {report.pillars.map((p) => (
            <div key={p.id} className="rounded-lg border border-stone-200 p-3" title={p.description}>
              <div className="flex items-center gap-1.5 text-xs font-medium text-stone-600">
                <Swatch pillar={p.id} />
                {p.name}
              </div>
              <div className="mt-1 text-2xl font-semibold text-stone-900 tabular-nums">{report.team.counts[p.id]}</div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="people-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="people-heading" className="text-sm font-semibold text-stone-900">
            People <span className="font-normal text-stone-500">(alphabetical)</span>
          </h2>
          <Legend report={report} />
        </div>
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {report.people.map((person) => (
            <li key={person.name}>
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
                      {totalEvidence(person)} {totalEvidence(person) === 1 ? 'item' : 'items'} · {person.messages} messages
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
      </section>
    </div>
  )
}

/** One thin stacked bar per person: segment length = evidence count per pillar. */
function PillarBar({ report, person, maxTotal }: { report: KpiReport; person: Person; maxTotal: number }) {
  const total = totalEvidence(person)
  if (total === 0) return <p className="mt-1.5 text-xs text-stone-400">No evidence found in these channels yet</p>
  const summary = report.pillars
    .filter((p) => person.counts[p.id] > 0)
    .map((p) => `${p.name}: ${person.counts[p.id]}`)
    .join(', ')
  return (
    <div className="mt-1.5">
      <div className="flex h-2.5 gap-0.5" style={{ width: `${(total / maxTotal) * 100}%` }} role="img" aria-label={summary}>
        {report.pillars.map((p) =>
          person.counts[p.id] > 0 ? (
            <span
              key={p.id}
              title={`${p.name}: ${person.counts[p.id]}`}
              className="h-full first:rounded-l last:rounded-r"
              style={{ flexGrow: person.counts[p.id], background: PILLAR_COLORS[p.id] }}
            />
          ) : null,
        )}
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
  const [filter, setFilter] = useState<PillarId | 'all'>('all')
  const items = useMemo(
    () => person.evidence.filter((e) => filter === 'all' || e.pillar === filter),
    [person, filter],
  )
  const chip = (active: boolean) =>
    `flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
      active ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-200 text-stone-700 hover:border-stone-400'
    }`

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <button onClick={onBack} className="text-sm font-medium text-sky-700 hover:underline">
        ← All people
      </button>
      <div>
        <h2 className="text-xl font-bold text-stone-900">{person.name}</h2>
        <p className="text-sm text-stone-500">
          {totalEvidence(person)} pieces of evidence from {person.messages} messages ·{' '}
          {(['high', 'medium', 'low'] as const).map((i) => `${person.impact[i]} ${i}`).join(', ')} impact · in chat:{' '}
          <code>{commandFor(person.name)}</code>
        </p>
      </div>

      <ReviewCard report={report} person={person} onOpenSource={onOpenSource} />

      {person.evidence.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by pillar">
            <button className={chip(filter === 'all')} onClick={() => setFilter('all')}>
              All ({totalEvidence(person)})
            </button>
            {report.pillars.map((p) => (
              <button key={p.id} className={chip(filter === p.id)} onClick={() => setFilter(p.id)}>
                <Swatch pillar={p.id} />
                {p.name} ({person.counts[p.id]})
              </button>
            ))}
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-stone-500">No evidence in this pillar yet.</p>
          ) : (
            <EvidenceList report={report} items={items} onOpenSource={onOpenSource} />
          )}
        </>
      )}
    </div>
  )
}
