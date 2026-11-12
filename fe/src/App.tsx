import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChannelView } from './components/ChannelView'
import type { Suggestion } from './components/Composer'
import { KpiDashboard } from './components/KpiDashboard'
import { KpiReviewPanel } from './components/KpiReviewPanel'
import { commandFor, findPeople, parseKpiCommand, type Evidence } from './lib/kpi'
import { Login } from './components/Login'
import { Sidebar } from './components/Sidebar'
import { ThreadPanel } from './components/ThreadPanel'
import { buildChannelState, errorText, Kind, setProfileName } from './lib/chat'
import { clearSecretKey, loadSecretKey, saveSecretKey } from './lib/keys'
import {
  NotifyProvider,
  ProfilesProvider,
  RelayProvider,
  useChannels,
  useNotify,
  useRelay,
  useKpiReport,
  useSubscription,
} from './state/relay'

export default function App() {
  const [secretKey, setSecretKey] = useState(() => loadSecretKey())
  const [newName, setNewName] = useState<string | null>(null)

  const signOut = useCallback(() => {
    clearSecretKey()
    setSecretKey(null)
  }, [])

  if (!secretKey) {
    return (
      <Login
        onLogin={(sk, name) => {
          saveSecretKey(sk)
          setNewName(name)
          setSecretKey(sk)
        }}
      />
    )
  }

  return (
    <RelayProvider secretKey={secretKey} onSignOut={signOut}>
      <ProfilesProvider>
        <NotifyProvider>
          <Workspace newName={newName} />
        </NotifyProvider>
      </ProfilesProvider>
    </RelayProvider>
  )
}

function Workspace({ newName }: { newName: string | null }) {
  const { client, pubkey } = useRelay()
  const notify = useNotify()
  const { channels } = useChannels()
  const [activeId, setActiveId] = useState('general')
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [view, setView] = useState<'chat' | 'kpi'>('chat')

  // A brand-new account publishes its display name once (queued until login completes).
  const sentName = useRef(false)
  useEffect(() => {
    if (!newName || sentName.current) return
    sentName.current = true
    setProfileName(client, newName).catch((err) => notify(errorText(err)))
  }, [client, newName, notify])

  const { events, loaded } = useSubscription([
    { kinds: [Kind.Message, Kind.Reaction, Kind.Deletion], '#h': [activeId], limit: 500 },
  ])
  const state = useMemo(() => buildChannelState(events, pubkey), [events, pubkey])

  // A just-created channel may not be in the list yet; show it by ID meanwhile.
  const channel = channels.find((c) => c.id === activeId) ?? {
    id: activeId,
    name: activeId,
    about: '',
    creator: '',
    kpiReview: false,
  }

  const report = useKpiReport()
  const [reviewName, setReviewName] = useState<string | null>(null) // open /kpi-<name> panel
  const [kpiSelected, setKpiSelected] = useState<string | null>(null) // person open in the dashboard
  const reviewPerson = report?.people.find((p) => p.name === reviewName) ?? null

  const selectChannel = (id: string) => {
    setActiveId(id)
    setThreadRootId(null)
    setSidebarOpen(false)
    setView('chat')
  }

  const openThread = (id: string) => {
    setReviewName(null)
    setThreadRootId(id)
  }

  // Jump from a piece of KPI evidence to the conversation it came from.
  const openSource = (e: Evidence) => {
    setActiveId(e.channel)
    setReviewName(null)
    setThreadRootId(e.unit_kind === 'thread' ? e.unit_id : null)
    setView('chat')
  }

  // "/kpi-maya", "/kpi maya chen", or bare "/kpi". Never posted to the channel.
  // The report is a live subscription, so it is already the latest.
  const runCommand = async (text: string) => {
    const cmd = parseKpiCommand(text)
    if (!cmd) throw new Error(`Unknown command ${text.split(/\s/)[0]}. Try /kpi-<name>.`)
    if (report === undefined) throw new Error('The KPI report is still loading. Try again in a moment.')
    if (!report) throw new Error('No KPI report for you yet. Opt in from the sidebar; it appears after the agent next runs.')
    if (!cmd.query) {
      setKpiSelected(null)
      setView('kpi')
      return
    }
    const matches = findPeople(report.people, cmd.query)
    if (matches.length === 0) {
      if (report.personal) throw new Error('You can only open your own KPI review.')
      throw new Error(`No one called "${cmd.query}" in the report. Try ${report.people.map((p) => commandFor(p.name)).join(', ')}.`)
    }
    if (matches.length > 1) {
      throw new Error(`"${cmd.query}" matches ${matches.map((p) => p.name).join(' and ')}. Type more of the name.`)
    }
    setThreadRootId(null)
    setReviewName(matches[0].name)
  }

  const suggest = (text: string): Suggestion[] => {
    const t = text.trimStart().toLowerCase()
    if (!report || !t.startsWith('/') || t.includes('\n')) return []
    const cmd = parseKpiCommand(t)
    if (!cmd && !'/kpi'.startsWith(t)) return []
    const people = cmd?.query ? findPeople(report.people, cmd.query) : report.people
    return people
      .filter((p) => commandFor(p.name) !== t.trim())
      .map((p) => ({
        value: commandFor(p.name),
        label: `KPI review for ${p.name}`,
        hint: `${p.evidence.length} ${p.evidence.length === 1 ? 'item' : 'items'}`,
      }))
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        channels={channels}
        activeId={activeId}
        onSelect={selectChannel}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        kpiActive={view === 'kpi'}
        onOpenKpi={() => {
          setView('kpi')
          setSidebarOpen(false)
        }}
      />
      {view === 'kpi' ? (
        <KpiDashboard
          report={report}
          selected={kpiSelected}
          onSelect={setKpiSelected}
          onOpenSource={openSource}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
      ) : (
        <ChannelView
          channel={channel}
          state={state}
          loaded={loaded}
          onOpenThread={openThread}
          onOpenSidebar={() => setSidebarOpen(true)}
          onCommand={runCommand}
          suggest={suggest}
        />
      )}
      {view === 'chat' && report && reviewPerson && (
        <KpiReviewPanel
          report={report}
          person={reviewPerson}
          onClose={() => setReviewName(null)}
          onOpenSource={openSource}
          onOpenProfile={() => {
            setKpiSelected(reviewPerson.name)
            setReviewName(null)
            setView('kpi')
          }}
        />
      )}
      {view === 'chat' && !reviewPerson && threadRootId && (
        <ThreadPanel
          channelId={activeId}
          rootId={threadRootId}
          state={state}
          onClose={() => setThreadRootId(null)}
        />
      )}
    </div>
  )
}
