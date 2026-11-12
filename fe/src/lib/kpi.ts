// Types for the report published by `go run ./cmd/kpi` (be/internal/kpi/report.go),
// plus the /kpi-<name> command used by managers to open a person's review.

export type PillarId = 'technical_leadership' | 'knowledge_sharing' | 'industry_intelligence' | 'ownership_initiative'
export type Impact = 'low' | 'medium' | 'high'

export type Pillar = { id: PillarId; name: string; description: string }

export type Evidence = {
  contributor: string
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
  pillars: Pillar[]
  team: { counts: Record<PillarId, number>; by_month: { month: string; counts: Record<PillarId, number> }[] }
  people: Person[]
}

// Categorical slots 1-4, validated for colour-blind separation on the light
// surface. Two are below 3:1 contrast, so counts are always shown as text too.
export const PILLAR_COLORS: Record<PillarId, string> = {
  technical_leadership: '#2a78d6',
  knowledge_sharing: '#eb6834',
  industry_intelligence: '#1baf7a',
  ownership_initiative: '#eda100',
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
    return Array.isArray(r.people) && Array.isArray(r.pillars) ? r : null
  } catch {
    return null
  }
}

/** People with no evidence in a pillar: shown as a prompt to ask, never as a judgment. */
export const pillarsWithoutEvidence = (report: KpiReport, person: Person) =>
  report.pillars.filter((p) => person.counts[p.id] === 0)

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
