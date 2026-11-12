// Building blocks shared by the KPI dashboard and the /kpi-<name> review panel.
import {
  IMPACT_LABEL,
  PILLAR_COLORS,
  pillarsWithoutEvidence,
  type Evidence,
  type KpiReport,
  type Person,
  type PillarId,
} from '../lib/kpi'
import { useT } from '../lib/prefs'

export const dateFmt = (iso: string) =>
  new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })

const shortDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })

export function Swatch({ pillar }: { pillar: PillarId }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: PILLAR_COLORS[pillar] }} />
}

export const pillarName = (report: KpiReport, id: PillarId) => report.pillars.find((p) => p.id === id)?.name ?? id

/** The AI-drafted review: headline, summary, highlights linked to evidence, 1-on-1 questions. */
export function ReviewCard({
  report,
  person,
  onOpenSource,
}: {
  report: KpiReport
  person: Person
  onOpenSource: (e: Evidence) => void
}) {
  const t = useT()
  const review = person.review
  const gaps = pillarsWithoutEvidence(report, person)

  if (person.evidence.length === 0) {
    return (
      <p className="rounded-lg border border-stone-200 p-4 text-sm text-stone-600">
        {t(
          'No evidence found for {name} in {channels} for this period. Their work may happen in other channels or tools, so ask about it directly.',
          { name: person.name, channels: report.channels.map((c) => `#${c}`).join(', ') },
        )}
      </p>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border border-stone-200 p-4">
      {review ? (
        <>
          <div>
            <p className="font-semibold text-stone-900">{review.headline}</p>
            <p className="mt-1 text-sm leading-relaxed text-stone-700">{review.summary}</p>
          </div>

          {review.highlights.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{t('Highlights')}</h4>
              <ul className="mt-2 space-y-2">
                {review.highlights.map((h, i) => (
                  <li key={i} className="text-sm text-stone-800">
                    <span className="mr-1.5 inline-flex items-center gap-1.5 font-medium">
                      <Swatch pillar={h.pillar} />
                      {t(pillarName(report, h.pillar))}:
                    </span>
                    {h.text}
                    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                      {h.evidence
                        .filter((idx) => person.evidence[idx])
                        .map((idx) => (
                          <button
                            key={idx}
                            onClick={() => onOpenSource(person.evidence[idx])}
                            className="rounded border border-stone-200 px-1.5 text-xs text-sky-700 hover:border-sky-300"
                            title={person.evidence[idx].summary}
                          >
                            {shortDate(person.evidence[idx].at)}
                          </button>
                        ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.discussion_points.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{t('For your 1-on-1')}</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-800">
                {review.discussion_points.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-stone-600">
          {t('No written review was generated for this person. The evidence below is still available.')}
        </p>
      )}

      {gaps.length > 0 && (
        <p className="border-t border-stone-100 pt-3 text-xs text-stone-500">
          {t("No chat evidence yet for {pillars}. This work may happen outside these channels, so it's worth asking about.", {
            pillars: gaps.map((g) => t(g.name).toLowerCase()).join(', '),
          })}
        </p>
      )}
    </div>
  )
}

/** Chronological evidence items with quotes and a link back to the conversation. */
export function EvidenceList({
  report,
  items,
  onOpenSource,
  compact = false,
}: {
  report: KpiReport
  items: Evidence[]
  onOpenSource: (e: Evidence) => void
  compact?: boolean
}) {
  const t = useT()
  return (
    <ol className="space-y-3">
      {items.map((e, i) => (
        <li key={`${e.unit_id}-${i}`} className={`rounded-lg border border-stone-200 ${compact ? 'p-3' : 'p-4'}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
            <span className="flex items-center gap-1.5 font-medium text-stone-800">
              <Swatch pillar={e.pillar} />
              {t(pillarName(report, e.pillar))}
            </span>
            <span>{t(IMPACT_LABEL[e.impact])}</span>
            <time dateTime={e.at}>{dateFmt(e.at)}</time>
            {e.endorsements > 0 && (
              <span>
                {t(e.endorsements === 1 ? '{n} teammate reaction' : '{n} teammate reactions', { n: e.endorsements })}
              </span>
            )}
          </div>
          <p className={`mt-2 font-medium text-stone-900 ${compact ? 'text-sm' : ''}`}>{e.summary}</p>
          {!compact && (
            <blockquote className="mt-2 border-l-2 border-stone-200 pl-3 text-sm whitespace-pre-wrap text-stone-600">
              {e.quote}
            </blockquote>
          )}
          {!compact && <p className="mt-2 text-xs text-stone-500">{t('Why: {reason}', { reason: e.rationale })}</p>}
          <button onClick={() => onOpenSource(e)} className="mt-2 text-sm font-medium text-sky-700 hover:underline">
            {t('Open in #{channel} →', { channel: e.channel })}
          </button>
        </li>
      ))}
    </ol>
  )
}
