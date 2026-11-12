import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChartColumn, Ellipsis, EyeOff, Hash, Lock, LogOut, Pencil, Plus, Search, Sparkles, Star, Trash2, Undo2, Users } from 'lucide-react'
import { createChannel, errorText, setConsent, setProfileName, slugify, type Channel } from '../lib/chat'
import { displayName } from '../lib/format'
import type { Status } from '../lib/relay'
import { useT } from '../lib/prefs'
import { useStars } from '../lib/stars'
import { useMyConsent, useNotify, useProfiles, useRelay } from '../state/relay'
import { Avatar } from './Avatar'
import { ConfirmDialog } from './ConfirmDialog'
import { ManglishSwitch, ThemeSwitch } from './PrefsControls'

const STATUS: Record<Status, { dot: string; label: string }> = {
  ready: { dot: 'bg-emerald-500', label: 'Connected' },
  authenticating: { dot: 'bg-amber-500', label: 'Signing in…' },
  connecting: { dot: 'bg-amber-500', label: 'Connecting…' },
  offline: { dot: 'bg-rose-500', label: 'Offline, retrying…' },
}

// Like Buzz, the sidebar has no panel of its own: it sits on the window
// background (.app-backdrop in index.css). On phones it slides over the chat.
const row = (active: boolean) =>
  `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[15px] transition-colors ${
    active ? 'bg-black/[0.07] font-semibold text-gray-900' : 'text-gray-800 hover:bg-black/[0.04]'
  }`
const sectionLabel = 'px-2.5 pt-4 pb-1 text-[13px] font-medium text-gray-500'
const fieldClass =
  'w-full rounded-lg border border-black/[0.06] bg-black/[0.03] px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-500 outline-none focus:border-black/15 focus:bg-white'

export function Sidebar({
  channels,
  activeId,
  onSelect,
  open,
  onClose,
  onOpenKpi,
}: {
  channels: Channel[]
  activeId: string
  onSelect: (id: string) => void
  open: boolean
  onClose: () => void
  onOpenKpi: () => void
}) {
  const t = useT()
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
  // Starred channels get their own section at the top, as in Buzz.
  const { pubkey } = useRelay()
  const { stars } = useStars(pubkey)
  const starredShown = shown.filter((c) => stars.has(c.id))
  const otherShown = shown.filter((c) => !stars.has(c.id))
  const channelRows = (list: Channel[]) => (
    <ul>
      {list.map((c) => (
        <li key={c.id}>
          <button onClick={() => onSelect(c.id)} className={row(c.id === activeId)} title={c.about || undefined}>
            {/* Work channels (KPI insights on) get a lock, like a private channel in Buzz. */}
            {c.kpiReview ? (
              <Lock aria-label={t('Work channel')} className="size-4 shrink-0 text-gray-500" />
            ) : (
              <Hash aria-hidden className="size-4 shrink-0 text-gray-500" />
            )}
            <span className="truncate">{c.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-black/20 backdrop-blur-[2px] md:hidden" onClick={onClose} aria-hidden />}
      <nav
        aria-label="Workspace"
        className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-30 w-72 flex-col bg-white text-gray-800 shadow-xl md:static md:flex md:w-64 md:shrink-0 md:bg-transparent md:shadow-none`}
      >
        <div className="shrink-0 px-2.5 pt-3 pb-1">
          <label className="relative block">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-gray-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder={t('Search channels')}
              aria-label={t('Search channels')}
              className={`${fieldClass} py-2 pr-10 pl-8`}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-sans text-xs text-gray-400">
              ⌘K
            </kbd>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-3">
          <button onClick={onOpenKpi} className={`mt-2 ${row(false)}`}>
            <ChartColumn aria-hidden className="size-4 text-gray-600" />
            {t('KPI insights')}
          </button>

          {starredShown.length > 0 && (
            <>
              <p className={`${sectionLabel} flex items-center gap-1.5`}>
                <Star aria-hidden className="size-3.5 fill-brand-500 text-brand-500" />
                {t('Starred')}
              </p>
              {channelRows(starredShown)}
            </>
          )}
          <p className={sectionLabel}>{t('Channels')}</p>
          {channelRows(otherShown)}
          {q && shown.length === 0 && <p className="px-2.5 py-1.5 text-sm text-gray-500">{t('No channels match “{q}”.', { q: query })}</p>}
          <AddChannel onCreated={onSelect} />
        </div>

        <Me />
      </nav>
    </>
  )
}

function AddChannel({ onCreated }: { onCreated: (id: string) => void }) {
  const { client } = useRelay()
  const t = useT()
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
      setError(t('Use letters or numbers in the name.'))
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
      <button onClick={() => setOpen(true)} className={`${row(false)} text-gray-600`}>
        <Plus aria-hidden className="size-4 text-gray-500" />
        {t('Add channel')}
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-1 space-y-2 rounded-xl bg-white/50 p-2 ring-1 ring-black/5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('Channel name')}
        aria-label={t('Channel name')}
        maxLength={64}
        className={fieldClass}
      />
      <input
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        placeholder={t("What's it about? (optional)")}
        aria-label="Channel description"
        maxLength={280}
        className={fieldClass}
      />
      <label className="flex items-start gap-2 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={kpiReview}
          onChange={(e) => setKpiReview(e.target.checked)}
          className="mt-0.5 accent-brand-600"
        />
        <span>
          {t('Work channel: include in KPI insights')}
          <span className="block text-gray-500">{t('Off by default. Everyone sees a badge when it is on.')}</span>
        </span>
      </label>
      {name && slugify(name) && <p className="text-xs text-gray-500">ID: {slugify(name)}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-lg bg-brand-600 px-3 py-1 text-sm font-medium text-on-brand hover:opacity-90 disabled:opacity-40"
        >
          {busy ? t('Creating…') : t('Create')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          className="rounded-lg px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
        >
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}

function Me() {
  const { client, pubkey, signOut, status } = useRelay()
  const profiles = useProfiles()
  const notify = useNotify()
  const t = useT()
  const name = displayName(profiles, pubkey)
  const statusLabel = t(STATUS[status].label)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
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

  const [askingConsent, setAskingConsent] = useState(false)
  const saveConsent = async () => {
    setSavingConsent(true)
    try {
      await setConsent(client, !consent.consented, consent.lastChange)
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

  const menuItem = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-gray-800 hover:bg-black/5'

  return (
    <div ref={menuRef} className="relative shrink-0 px-2.5 pt-2 pb-3">
      {askingConsent &&
        (consent.consented ? (
          <ConfirmDialog
            icon={ChartColumn}
            title={t('Turn off KPI insights?')}
            points={[
              [EyeOff, t('The agent stops reading your messages from now on')],
              [Trash2, t('Your report is removed the next time the agent runs')],
              [Undo2, t('You can turn it back on at any time')],
            ]}
            cancelLabel={t('Keep it on')}
            confirmLabel={t('Turn off')}
            onConfirm={saveConsent}
            onClose={() => setAskingConsent(false)}
          />
        ) : (
          <ConfirmDialog
            icon={ChartColumn}
            title={t('Turn on KPI insights?')}
            description={t(
              'An AI agent looks for your positive contributions in work channels, so they are easy to bring up in your 1-on-1s.',
            )}
            points={[
              [Lock, t('Reads only channels marked "KPI insights on"')],
              [Sparkles, t('Notes what you did well. No scores, no rankings, no mistakes')],
              [Users, t('Only you and managers can see your report')],
              [Undo2, t('You can turn it off at any time')],
            ]}
            cancelLabel={t('Not now')}
            confirmLabel={t('Turn on')}
            onConfirm={saveConsent}
            onClose={() => setAskingConsent(false)}
          />
        ))}
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
            <Pencil aria-hidden className="size-4 text-gray-500" />
            {t('Edit name')}
          </button>
          <button
            role="menuitemcheckbox"
            aria-checked={consent.consented}
            className={menuItem}
            onClick={() => {
              setMenuOpen(false)
              setAskingConsent(true)
            }}
            disabled={!consent.loaded || savingConsent}
            title={t('Whether the KPI agent may read your messages in work channels. Off until you turn it on.')}
          >
            <ChartColumn aria-hidden className="size-4 text-gray-500" />
            <span className="flex-1">{t('KPI insights')}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                consent.consented ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {!consent.loaded ? '…' : consent.consented ? t('Opted in') : t('Not opted in')}
            </span>
          </button>
          <div role="separator" className="my-1 border-t border-gray-200" />
          <div className="px-2.5 py-1.5">
            <ThemeSwitch inMenu />
          </div>
          <ManglishSwitch inMenu className={`${menuItem} gap-2`} />
          <div role="separator" className="my-1 border-t border-gray-200" />
          <button role="menuitem" className={`${menuItem} text-rose-700`} onClick={signOut}>
            <LogOut aria-hidden className="size-4" />
            {t('Sign out')}
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
          <button type="submit" className="text-sm font-semibold text-gray-900 hover:text-gray-600">
            {t('Save')}
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
            <Avatar name={name} />
            <span
              className={`absolute right-0 bottom-0 size-2 rounded-full ring-[1.5px] ring-white ${STATUS[status].dot}`}
              title={statusLabel}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-gray-900">{name}</span>
            {/* Only problems get a line of text; "Connected" is just the green dot. */}
            <span className="sr-only" role="status">
              {statusLabel}
            </span>
            {status !== 'ready' && (
              <span aria-hidden className="block truncate text-xs text-gray-500">
                {statusLabel}
              </span>
            )}
          </span>
          <Ellipsis aria-hidden className="size-4 text-gray-500" />
        </button>
      )}
    </div>
  )
}
