import { useState, type FormEvent } from 'react'
import { createChannel, errorText, setConsent, setProfileName, slugify, type Channel } from '../lib/chat'
import { displayName } from '../lib/format'
import { toNsec } from '../lib/keys'
import type { Status } from '../lib/relay'
import { useMyConsent, useNotify, useProfiles, useRelay } from '../state/relay'
import { Avatar } from './Avatar'

const STATUS: Record<Status, { dot: string; label: string }> = {
  ready: { dot: 'bg-emerald-400', label: 'Connected' },
  authenticating: { dot: 'bg-amber-400', label: 'Signing in…' },
  connecting: { dot: 'bg-amber-400', label: 'Connecting…' },
  offline: { dot: 'bg-rose-500', label: 'Offline, retrying…' },
}

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
  const { status } = useRelay()

  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={onClose} aria-hidden />}
      <nav
        className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-30 w-64 flex-col bg-stone-900 text-stone-300 md:static md:flex md:shrink-0`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-stone-800 px-4">
          <span className="font-bold text-white">Stooges</span>
          <span className="flex items-center gap-1.5 text-xs text-stone-400" role="status">
            <span className={`size-2 rounded-full ${STATUS[status].dot}`} />
            {STATUS[status].label}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <button
            onClick={onOpenKpi}
            className={`mb-3 w-full rounded-md px-2 py-1.5 text-left text-sm ${
              kpiActive ? 'bg-sky-700 font-medium text-white' : 'hover:bg-stone-800 hover:text-white'
            }`}
          >
            KPI insights
          </button>
          <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">Channels</p>
          <ul>
            {channels.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c.id)}
                  className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                    c.id === activeId && !kpiActive ? 'bg-sky-700 font-medium text-white' : 'hover:bg-stone-800 hover:text-white'
                  }`}
                >
                  # {c.name}
                </button>
              </li>
            ))}
          </ul>
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
      <button
        onClick={() => setOpen(true)}
        className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-stone-400 hover:bg-stone-800 hover:text-white"
      >
        + Add channel
      </button>
    )
  }

  const input =
    'w-full rounded-md border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-white placeholder:text-stone-500 outline-none focus:border-stone-400'
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-lg bg-stone-800/60 p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Channel name"
        aria-label="Channel name"
        maxLength={64}
        className={input}
      />
      <input
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        placeholder="What's it about? (optional)"
        aria-label="Channel description"
        maxLength={280}
        className={input}
      />
      <label className="flex items-start gap-2 text-xs text-stone-300">
        <input
          type="checkbox"
          checked={kpiReview}
          onChange={(e) => setKpiReview(e.target.checked)}
          className="mt-0.5 accent-sky-600"
        />
        <span>
          Work channel: include in KPI insights
          <span className="block text-stone-500">Off by default. Everyone sees a badge when it is on.</span>
        </span>
      </label>
      {name && slugify(name) && <p className="text-xs text-stone-500">ID: {slugify(name)}</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-md bg-sky-700 px-3 py-1 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          className="rounded-md px-3 py-1 text-sm text-stone-400 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function Me() {
  const { client, pubkey, secretKey, signOut } = useRelay()
  const profiles = useProfiles()
  const notify = useNotify()
  const name = displayName(profiles, pubkey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState<'secret' | 'public' | null>(null)
  const consent = useMyConsent()
  const [savingConsent, setSavingConsent] = useState(false)

  const toggleConsent = async () => {
    const next = !consent.consented
    const question = next
      ? 'Opt in to KPI insights?\n\nAn AI agent will read your messages in channels marked "KPI insights on" and note positive contributions for you and your manager. It never reads other channels and records no scores.\n\nYou can opt out at any time.'
      : 'Opt out of KPI insights?\n\nThe agent will stop reading your messages and leave you out of the next report.'
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
  const copy = async (which: 'secret' | 'public') => {
    try {
      await navigator.clipboard.writeText(which === 'secret' ? toNsec(secretKey) : pubkey)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      notify('Could not copy to the clipboard.')
    }
  }

  const confirmSignOut = () => {
    if (window.confirm("Sign out? Copy your secret key first. Without it you can't get this identity back.")) signOut()
  }

  const link = 'text-xs text-stone-400 hover:text-white'

  return (
    <div className="shrink-0 border-t border-stone-800 p-3">
      {editing ? (
        <form onSubmit={saveName} className="flex gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={64}
            aria-label="Display name"
            className="min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-800 px-2 py-1 text-sm text-white outline-none focus:border-stone-400"
          />
          <button type="submit" className="text-sm font-medium text-sky-400 hover:text-sky-300">
            Save
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <Avatar pubkey={pubkey} name={name} size="sm" />
          <span className="truncate text-sm font-medium text-white">{name}</span>
        </div>
      )}
      <button
        onClick={toggleConsent}
        disabled={!consent.loaded || savingConsent}
        aria-pressed={consent.consented}
        title="Whether the KPI agent may read your messages in work channels. Off until you turn it on."
        className="mt-2 flex w-full items-center justify-between rounded-md bg-stone-800 px-2 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700 disabled:opacity-60"
      >
        <span>KPI insights</span>
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${
            consent.consented ? 'bg-emerald-600 text-white' : 'bg-stone-600 text-stone-200'
          }`}
        >
          {!consent.loaded ? '…' : consent.consented ? 'Opted in' : 'Not opted in'}
        </span>
      </button>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <button
          className={link}
          onClick={() => {
            setDraft(profiles.get(pubkey)?.name ?? '')
            setEditing((v) => !v)
          }}
        >
          {editing ? 'Cancel' : 'Edit name'}
        </button>
        <button className={link} onClick={() => copy('secret')}>
          {copied === 'secret' ? 'Copied!' : 'Copy secret key'}
        </button>
        <button className={link} onClick={() => copy('public')} title="Safe to share. An admin uses it to make you a manager.">
          {copied === 'public' ? 'Copied!' : 'Copy public key'}
        </button>
        <button className={link} onClick={confirmSignOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}
