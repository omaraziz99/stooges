// Types for the report published by `go run ./cmd/kpi` (be/internal/kpi/report.go),
// plus the /kpi-<name> command used by managers to open a person's review.

/** A KPI item's ID, such as "se_delivery". Items belong to one level. */
export type PillarId = string
export type Impact = 'low' | 'medium' | 'high'

/** One weighted KPI item of a level (be/internal/kpi/framework.go). */
export type Pillar = {
  id: PillarId
  level: string
  name: string
  /** Percent of the level's KPI. */
  weight: number
  kpi: string
  /** What counts as evidence. */
  description: string
}

export type Level = { id: string; title: string }

export type Evidence = {
  contributor: string
  pubkey?: string
  pillar: PillarId
  summary: string
  impact: Impact
  rationale: string
  channel: string
  unit_id: string
  unit_kind: 'thread' | 'conversation'
  message_ids: string[]
  at: string
  quote: string
  endorsements: number
}

export type Highlight = {
  pillar: PillarId
  text: string
  /** 0-based indexes into Person.evidence */
  evidence: number[]
}

export type Review = {
  headline: string
  summary: string
  highlights: Highlight[]
  discussion_points: string[]
}

export type Person = {
  name: string
  pubkey?: string
  level: string
  messages: number
  counts: Record<PillarId, number>
  impact: Record<Impact, number>
  evidence: Evidence[]
  review?: Review
}

export type KpiReport = {
  generated_at: string
  model: string
  channels: string[]
  from: string
  to: string
  conversations: number
  skipped?: string[]
  framework: string
  levels: Level[]
  /** Every KPI item of every level. */
  pillars: Pillar[]
  team: { counts: Record<PillarId, number>; by_month: { month: string; counts: Record<PillarId, number> }[] }
  people: Person[]
  /** Set by the app: this is the viewer's own report, not the team's. */
  personal?: boolean
}

/** A level's KPI items, in display order (heaviest first). */
export const itemsFor = (report: KpiReport, level: string) => report.pillars.filter((p) => p.level === level)

export const levelTitle = (report: KpiReport, level: string) => report.levels.find((l) => l.id === level)?.title ?? level

/**
 * An item's colour: its position within its level picks categorical slot
 * 1-7 (--series-N in index.css, validated for colour-blind separation in
 * both themes). Three light-mode slots are below 3:1 contrast, so items and
 * counts are always labelled in text too.
 */
export function itemColor(report: KpiReport, id: PillarId) {
  const item = report.pillars.find((p) => p.id === id)
  const slot = item ? itemsFor(report, item.level).indexOf(item) : -1
  return slot >= 0 ? `var(--series-${(slot % 7) + 1})` : 'var(--color-stone-400)'
}

export const IMPACT_LABEL: Record<Impact, string> = { low: 'Low impact', medium: 'Medium impact', high: 'High impact' }

export const totalEvidence = (p: Person) => p.evidence.length

/** Event kind and d tag the KPI agent publishes its report under (NIP-78 app data). */
export const REPORT_KIND = 30078
export const REPORT_TAG = 'kpi-report'

/** Parses a report event's content; null if it isn't a usable report. */
export function parseReport(content: string): KpiReport | null {
  try {
    const r = JSON.parse(content) as KpiReport
    // Reports from before the KPI framework had no levels; they can't be shown.
    return Array.isArray(r.people) && Array.isArray(r.pillars) && Array.isArray(r.levels) ? r : null
  } catch {
    return null
  }
}

/** A person's KPI items with no evidence: shown as a prompt to ask, never as a judgment. */
export const pillarsWithoutEvidence = (report: KpiReport, person: Person) =>
  itemsFor(report, person.level).filter((p) => !person.counts[p.id])

// ---- /kpi-<name> command ----

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** "Maya Chen" -> "/kpi-maya-chen" */
export const commandFor = (name: string) => `/kpi-${name.trim().toLowerCase().split(/\s+/).join('-')}`

/** Parses "/kpi-maya", "/kpi maya chen" or bare "/kpi". Returns null for anything else. */
export function parseKpiCommand(text: string): { query: string } | null {
  const m = text.trim().match(/^\/kpi(?:[-\s]+(.*))?$/i)
  return m ? { query: (m[1] ?? '').trim() } : null
}

/** Matches a typed name: full name first, then first name, then any name part by prefix. */
export function findPeople(people: Person[], query: string): Person[] {
  const q = slug(query)
  if (!q) return []
  const full = people.filter((p) => slug(p.name) === q)
  if (full.length) return full
  const first = people.filter((p) => slug(p.name.split(/\s+/)[0]) === q)
  if (first.length) return first
  return people.filter((p) => slug(p.name).startsWith(q) || p.name.split(/\s+/).some((part) => slug(part).startsWith(q)))
}
