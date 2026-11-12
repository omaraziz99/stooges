import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChartColumn, Copy, Ellipsis, Hash, LogOut, Pencil, Plus, Search } from 'lucide-react'
import { createChannel, errorText, setConsent, setProfileName, slugify, type Channel } from '../lib/chat'
import { displayName } from '../lib/format'
import type { Status } from '../lib/relay'
import { useMyConsent, useNotify, useProfiles, useRelay } from '../state/relay'
import { Avatar } from './Avatar'

const STATUS: Record<Status, { dot: string; label: string }> = {
  ready: { dot: 'bg-emerald-500', label: 'Connected' },
  authenticating: { dot: 'bg-amber-500', label: 'Signing in…' },
  connecting: { dot: 'bg-amber-500', label: 'Connecting…' },
  offline: { dot: 'bg-rose-500', label: 'Offline, retrying…' },
}

// A light frosted sidebar, like a macOS window sidebar. The colour behind it
// is the app background (.app-backdrop in index.css).
const row = (active: boolean) =>
  `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[15px] transition-colors ${
    active ? 'bg-black/[0.07] font-semibold text-stone-900' : 'text-stone-800 hover:bg-black/[0.04]'
  }`
const sectionLabel = 'px-2.5 pt-4 pb-1 text-[13px] font-medium text-stone-500'
const fieldClass =
  'w-full rounded-lg border border-black/[0.06] bg-white/60 px-2.5 py-1.5 text-sm text-stone-900 placeholder:text-stone-500 outline-none focus:border-black/15 focus:bg-white/85'

export function Sidebar({
  channels,
  activeId,
  onSelect,
  open,
  onClose,
  kpiActive,
  onOpenKpi,
}: {
  channels: Channel[]
  activeId: string
  onSelect: (id: string) => void
  open: boolean
  onClose: () => void
  kpiActive: boolean
  onOpenKpi: () => void
}) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl+K focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const q = query.trim().toLowerCase()
  const shown = q ? channels.filter((c) => c.name.toLowerCase().includes(q) || c.about.toLowerCase().includes(q)) : channels

  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-black/20 backdrop-blur-[2px] md:hidden" onClick={onClose} aria-hidden />}
      <nav
        aria-label="Workspace"
        className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-30 w-72 flex-col bg-[#ecebd8]/85 text-stone-800 backdrop-blur-2xl backdrop-saturate-150 reduce-transparency:bg-[#ecebd8] md:static md:flex md:w-64 md:shrink-0 md:bg-white/10`}
      >
        <div className="shrink-0 px-2.5 pt-3 pb-1">
          <label className="relative block">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-stone-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Search channels"
              aria-label="Search channels"
              className={`${fieldClass} py-2 pr-10 pl-8`}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-sans text-xs text-stone-400">
              ⌘K
            </kbd>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-3">
          <button onClick={onOpenKpi} className={`mt-2 ${row(kpiActive)}`}>
            <ChartColumn aria-hidden className="size-4 text-stone-600" />
            KPI insights
          </button>

          <p className={sectionLabel}>Channels</p>
          <ul>
            {shown.map((c) => (
              <li key={c.id}>
                <button onClick={() => onSelect(c.id)} className={row(c.id === activeId && !kpiActive)} title={c.about || undefined}>
                  <Hash aria-hidden className="size-4 shrink-0 text-stone-500" />
                  <span className="truncate">{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {q && shown.length === 0 && <p className="px-2.5 py-1.5 text-sm text-stone-500">No channels match “{query}”.</p>}
          <AddChannel onCreated={onSelect} />
        </div>

        <Me />
      </nav>
    </>
  )
}

function AddChannel({ onCreated }: { onCreated: (id: string) => void }) {
  const { client } = useRelay()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [kpiReview, setKpiReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const id = slugify(name)
    if (!id) {
      setError('Use letters or numbers in the name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createChannel(client, id, name.trim(), about.trim(), kpiReview)
      setOpen(false)
      setName('')
      setAbout('')
      setKpiReview(false)
      onCreated(id)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={`${row(false)} text-stone-600`}>
        <Plus aria-hidden className="size-4 text-stone-500" />
        Add channel
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-1 space-y-2 rounded-xl bg-white/50 p-2 ring-1 ring-black/5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Channel name"
        aria-label="Channel name"
        maxLength={64}
        className={fieldClass}
      />
      <input
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        placeholder="What's it about? (optional)"
        aria-label="Channel description"
        maxLength={280}
        className={fieldClass}
      />
      <label className="flex items-start gap-2 text-xs text-stone-700">
        <input
          type="checkbox"
          checked={kpiReview}
          onChange={(e) => setKpiReview(e.target.checked)}
          className="mt-0.5 accent-stone-900"
        />
        <span>
          Work channel: include in KPI insights
          <span className="block text-stone-500">Off by default. Everyone sees a badge when it is on.</span>
        </span>
      </label>
      {name && slugify(name) && <p className="text-xs text-stone-500">ID: {slugify(name)}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-lg bg-stone-900 px-3 py-1 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          className="rounded-lg px-3 py-1 text-sm text-stone-600 hover:text-stone-900"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function Me() {
  const { client, pubkey, signOut, status } = useRelay()
  const profiles = useProfiles()
  const notify = useNotify()
  const name = displayName(profiles, pubkey)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const consent = useMyConsent()
  const [savingConsent, setSavingConsent] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const toggleConsent = async () => {
    const next = !consent.consented
    const question = next
      ? 'Opt in to KPI insights?\n\nAn AI agent will read your messages in channels marked "KPI insights on" and note positive contributions for you and your manager. It never reads other channels and records no scores.\n\nYou can opt out at any time.'
      : 'Opt out of KPI insights?\n\nThe agent will stop reading your messages and leave you out of the next report.'
    setMenuOpen(false)
    if (!window.confirm(question)) return
    setSavingConsent(true)
    try {
      await setConsent(client, next, consent.lastChange)
    } catch (err) {
      notify(errorText(err))
    } finally {
      setSavingConsent(false)
    }
  }

  const saveName = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    try {
      await setProfileName(client, draft.trim())
      setEditing(false)
    } catch (err) {
      notify(errorText(err))
    }
  }

  // The public key is what an admin adds to the relay's MANAGER_PUBKEYS.
  const copyPublicKey = async () => {
    try {
      await navigator.clipboard.writeText(pubkey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      notify('Could not copy to the clipboard.')
    }
  }

  const menuItem = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-stone-800 hover:bg-black/5'

  return (
    <div ref={menuRef} className="relative shrink-0 px-2.5 pt-2 pb-3">
      {menuOpen && (
        <div role="menu" className="absolute right-2.5 bottom-full left-2.5 mb-1 rounded-xl bg-white/95 p-1 shadow-lg ring-1 ring-black/10 backdrop-blur">
          <button
            role="menuitem"
            className={menuItem}
            onClick={() => {
              setDraft(profiles.get(pubkey)?.name ?? '')
              setEditing(true)
              setMenuOpen(false)
            }}
          >
            <Pencil aria-hidden className="size-4 text-stone-500" />
            Edit name
          </button>
          <button
            role="menuitemcheckbox"
            aria-checked={consent.consented}
            className={menuItem}
            onClick={toggleConsent}
            disabled={!consent.loaded || savingConsent}
            title="Whether the KPI agent may read your messages in work channels. Off until you turn it on."
          >
            <ChartColumn aria-hidden className="size-4 text-stone-500" />
            <span className="flex-1">KPI insights</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                consent.consented ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-500'
              }`}
            >
              {!consent.loaded ? '…' : consent.consented ? 'Opted in' : 'Not opted in'}
            </span>
          </button>
          <button
            role="menuitem"
            className={menuItem}
            onClick={copyPublicKey}
            title="Safe to share. An admin uses it to make you a manager."
          >
            <Copy aria-hidden className="size-4 text-stone-500" />
            {copied ? 'Copied!' : 'Copy public key'}
          </button>
          <button role="menuitem" className={`${menuItem} text-rose-700`} onClick={signOut}>
            <LogOut aria-hidden className="size-4" />
            Sign out
          </button>
        </div>
      )}

      {editing ? (
        <form onSubmit={saveName} className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            maxLength={64}
            aria-label="Display name"
            className={fieldClass}
          />
          <button type="submit" className="text-sm font-semibold text-stone-900 hover:text-stone-600">
            Save
          </button>
        </form>
      ) : (
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-black/[0.04]"
        >
          <span className="relative">
            <Avatar pubkey={pubkey} name={name} />
            <span
              className={`absolute right-0 bottom-0 size-2 rounded-full ring-[1.5px] ring-[#e3e6e0] ${STATUS[status].dot}`}
              title={STATUS[status].label}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-stone-900">{name}</span>
            {/* Only problems get a line of text; "Connected" is just the green dot. */}
            <span className="sr-only" role="status">
              {STATUS[status].label}
            </span>
            {status !== 'ready' && (
              <span aria-hidden className="block truncate text-xs text-stone-500">
                {STATUS[status].label}
              </span>
            )}
          </span>
          <Ellipsis aria-hidden className="size-4 text-stone-500" />
        </button>
      )}
    </div>
  )
}
