import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChannelView } from './components/ChannelView'
import type { Suggestion } from './components/Composer'
import { KpiReviewPanel } from './components/KpiReviewPanel'
import { commandFor, findPeople, parseKpiCommand, type Evidence } from './lib/kpi'
import { Landing } from './components/Landing'
import { Login } from './components/Login'
import { Sidebar } from './components/Sidebar'
import { TeamDashboard } from './components/TeamDashboard'
import { ThreadPanel } from './components/ThreadPanel'
import { buildChannelState, errorText, Kind, setProfileName } from './lib/chat'
import { clearSecretKey, loadSecretKey, saveSecretKey } from './lib/keys'
import { useT } from './lib/prefs'
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
  const [hash, navigate] = useHashRoute()

  const signOut = useCallback(() => {
    clearSecretKey()
    setSecretKey(null)
  }, [])

  // Signed out: the landing page, or the login page at #/login and #/signup.
  if (!secretKey) {
    const auth = hash.match(/^#\/(login|signup)$/)
    if (!auth) return <Landing />
    return (
      <Login
        key={auth[1]}
        initialMode={auth[1] as 'login' | 'signup'}
        onLogin={(sk, name) => {
          saveSecretKey(sk)
          setNewName(name)
          setSecretKey(sk)
          navigate('') // into the chat, without #/login in the address
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
  const t = useT()
  const { channels, deleted } = useChannels()
  // Until someone picks a channel, show the first one; if the picked one is
  // deleted (by anyone), fall back to the first again.
  const [pickedId, setActiveId] = useState<string | null>(null)
  const activeId = (pickedId && !deleted.has(pickedId) ? pickedId : null) ?? channels[0]?.id ?? ''
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [hash, navigate] = useHashRoute()
  const team = hash.match(/^#\/team(?:\/(.+))?$/) // the team dashboard: #/team or #/team/<name>
  const openTeam = (name?: string | null) => navigate(name ? `#/team/${encodeURIComponent(name)}` : '#/team')

  // A brand-new account publishes its display name once (queued until login completes).
  const sentName = useRef(false)
  useEffect(() => {
    if (!newName || sentName.current) return
    sentName.current = true
    setProfileName(client, newName).catch((err) => notify(errorText(err)))
  }, [client, newName, notify])

  const { events, loaded } = useSubscription(
    activeId ? [{ kinds: [Kind.Message, Kind.Reaction, Kind.Deletion], '#h': [activeId], limit: 500 }] : null,
  )
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
  const reviewPerson = report?.people.find((p) => p.name === reviewName) ?? null

  const selectChannel = (id: string) => {
    setActiveId(id)
    setThreadRootId(null)
    setSidebarOpen(false)
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
    navigate('')
  }

  // "/kpi-maya", "/kpi maya chen", or bare "/kpi". Never posted to the channel.
  // The report is a live subscription, so it is already the latest.
  const runCommand = async (text: string) => {
    const cmd = parseKpiCommand(text)
    if (!cmd) throw new Error(t('Unknown command {cmd}. Try /kpi-<name>.', { cmd: text.split(/\s/)[0] }))
    if (report === undefined) throw new Error(t('The KPI report is still loading. Try again in a moment.'))
    if (!report) throw new Error(t('No KPI report for you yet. Opt in from the sidebar; it appears after the agent next runs.'))
    if (!cmd.query) {
      openTeam()
      return
    }
    const matches = findPeople(report.people, cmd.query)
    if (matches.length === 0) {
      if (report.personal) throw new Error(t('You can only open your own KPI review.'))
      throw new Error(
        t('No one called "{q}" in the report. Try {options}.', {
          q: cmd.query,
          options: report.people.map((p) => commandFor(p.name)).join(', '),
        }),
      )
    }
    if (matches.length > 1) {
      throw new Error(
        t('"{q}" matches {names}. Type more of the name.', { q: cmd.query, names: matches.map((p) => p.name).join(' & ') }),
      )
    }
    setThreadRootId(null)
    setReviewName(matches[0].name)
  }

  const suggest = (text: string): Suggestion[] => {
    const typed = text.trimStart().toLowerCase()
    if (!report || !typed.startsWith('/') || typed.includes('\n')) return []
    const cmd = parseKpiCommand(typed)
    if (!cmd && !'/kpi'.startsWith(typed)) return []
    const people = cmd?.query ? findPeople(report.people, cmd.query) : report.people
    return people
      .filter((p) => commandFor(p.name) !== typed.trim())
      .map((p) => ({
        value: commandFor(p.name),
        label: t('KPI review for {name}', { name: p.name }),
        hint: t(p.evidence.length === 1 ? '{n} item' : '{n} items', { n: p.evidence.length }),
      }))
  }

  if (team) {
    return (
      <TeamDashboard
        report={report}
        selected={team[1] ? decodeURIComponent(team[1]) : null}
        onSelect={openTeam}
        onOpenSource={openSource}
        onBackToChat={() => navigate('')}
      />
    )
  }

  return (
    <div className="app-backdrop flex h-dvh overflow-hidden">
      <Sidebar
        channels={channels}
        activeId={activeId}
        onSelect={selectChannel}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenKpi={() => {
          openTeam()
          setSidebarOpen(false)
        }}
      />
      <div className="flex min-w-0 flex-1 overflow-hidden bg-white md:my-2 md:mr-2 md:rounded-2xl md:shadow-[0_1px_2px_rgb(0_0_0/0.06),0_12px_32px_-12px_rgb(0_0_0/0.25)] md:ring-1 md:ring-black/5">
      {!activeId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-gray-500">
          <p>
            {t.rich('No channels yet. Create one with {add} in the sidebar.', {
              add: <strong className="text-gray-700">{t('Add channel')}</strong>,
            })}
          </p>
          <button onClick={() => setSidebarOpen(true)} className="text-sm font-medium text-brand-700 hover:underline md:hidden">
            {t('Open channel list')}
          </button>
        </div>
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
      {report && reviewPerson && (
        <KpiReviewPanel
          report={report}
          person={reviewPerson}
          onClose={() => setReviewName(null)}
          onOpenSource={openSource}
          onOpenProfile={() => {
            setReviewName(null)
            openTeam(reviewPerson.name)
          }}
        />
      )}
      {!reviewPerson && threadRootId && (
        <ThreadPanel
          channelId={activeId}
          rootId={threadRootId}
          state={state}
          onClose={() => setThreadRootId(null)}
        />
      )}
      </div>
    </div>
  )
}

/**
 * The URL hash, kept in sync with the back and forward buttons. It gives the
 * team dashboard its own address (#/team) with no router and no server
 * rewrites. navigate('') goes back to the chat without leaving a bare '#'.
 */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const sync = () => setHash(window.location.hash)
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])
  const navigate = useCallback((next: string) => {
    if (next === window.location.hash) return
    if (next) {
      window.location.hash = next
    } else {
      window.history.pushState(null, '', window.location.pathname + window.location.search)
      setHash('')
    }
  }, [])
  return [hash, navigate] as const
}
