import type { Evidence, KpiReport, Person } from '../lib/kpi'
import { useT } from '../lib/prefs'
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
  const t = useT()
  return (
    <aside
      aria-label={t('KPI review for {name}', { name: person.name })}
      className="fixed inset-0 z-20 flex flex-col bg-white md:static md:z-auto md:w-[420px] md:shrink-0 md:border-l md:border-gray-200"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-gray-900">{t('KPI review · {name}', { name: person.name })}</h2>
          <p className="text-xs text-gray-500">{t('Only visible to you')}</p>
        </div>
        <button onClick={onClose} className="rounded p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Close review">
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs text-gray-500">
          {t(
            'AI-drafted from {channels}, {from} to {to}. Check the linked messages before using this in a review.',
            { channels: report.channels.map((c) => `#${c}`).join(', '), from: dateFmt(report.from), to: dateFmt(report.to) },
          )}
        </p>

        <ReviewCard report={report} person={person} onOpenSource={onOpenSource} />

        {person.evidence.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">{t('Evidence ({n})', { n: person.evidence.length })}</h3>
            <EvidenceList report={report} items={person.evidence} onOpenSource={onOpenSource} compact />
          </section>
        )}

        <button onClick={onOpenProfile} className="text-sm font-medium text-brand-700 hover:underline">
          {t('Open full profile in KPI insights →')}
        </button>
      </div>
    </aside>
  )
}
