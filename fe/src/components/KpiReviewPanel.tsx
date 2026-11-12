import type { Evidence, KpiReport, Person } from '../lib/kpi'
import { dateFmt, EvidenceList, ReviewCard } from './KpiParts'

/** Opened by /kpi-<name>: a private review panel next to the channel. */
export function KpiReviewPanel({
  report,
  person,
  onClose,
  onOpenSource,
  onOpenProfile,
}: {
  report: KpiReport
  person: Person
  onClose: () => void
  onOpenSource: (e: Evidence) => void
  onOpenProfile: () => void
}) {
  return (
    <aside
      aria-label={`KPI review for ${person.name}`}
      className="fixed inset-0 z-20 flex flex-col bg-white md:static md:z-auto md:w-[420px] md:shrink-0 md:border-l md:border-stone-200"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-stone-200 px-4">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-stone-900">KPI review · {person.name}</h2>
          <p className="text-xs text-stone-500">Only visible to you</p>
        </div>
        <button onClick={onClose} className="rounded p-1.5 text-stone-500 hover:bg-stone-100" aria-label="Close review">
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs text-stone-500">
          AI-drafted from {report.channels.map((c) => `#${c}`).join(', ')}, {dateFmt(report.from)} to {dateFmt(report.to)}.
          Check the linked messages before using this in a review.
        </p>

        <ReviewCard report={report} person={person} onOpenSource={onOpenSource} />

        {person.evidence.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-stone-900">Evidence ({person.evidence.length})</h3>
            <EvidenceList report={report} items={person.evidence} onOpenSource={onOpenSource} compact />
          </section>
        )}

        <button onClick={onOpenProfile} className="text-sm font-medium text-sky-700 hover:underline">
          Open full profile in KPI insights →
        </button>
      </div>
    </aside>
  )
}
