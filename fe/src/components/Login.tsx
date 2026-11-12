import { useState, type FormEvent } from 'react'
import { generateSecretKey } from 'nostr-tools/pure'
import { parseSecretKey } from '../lib/keys'

/** Create a new identity (a fresh key) or sign in with an existing secret key. */
export function Login({ onLogin }: { onLogin: (secretKey: Uint8Array, name: string | null) => void }) {
  const [mode, setMode] = useState<'new' | 'import'>('new')
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === 'new') {
      if (!name.trim()) return setError('Enter a display name.')
      onLogin(generateSecretKey(), name.trim())
    } else {
      try {
        onLogin(parseSecretKey(key), null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const tab = (active: boolean) =>
    `flex-1 rounded-md py-1.5 text-sm font-medium ${active ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-stone-900">Stooges</h1>
        <p className="mt-1 text-sm text-stone-600">Team chat with channels, threads, and reactions.</p>

        <div className="mt-5 flex gap-1 rounded-lg bg-stone-100 p-1" role="tablist">
          <button role="tab" aria-selected={mode === 'new'} className={tab(mode === 'new')} onClick={() => setMode('new')}>
            New account
          </button>
          <button
            role="tab"
            aria-selected={mode === 'import'}
            className={tab(mode === 'import')}
            onClick={() => setMode('import')}
          >
            I have a key
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          {mode === 'new' ? (
            <label className="block">
              <span className="text-sm font-medium text-stone-700">Display name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                placeholder="e.g. Maya"
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-stone-500"
              />
            </label>
          ) : (
            <label className="block">
              <span className="text-sm font-medium text-stone-700">Secret key</span>
              <input
                autoFocus
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="nsec1…"
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm outline-none focus:border-stone-500"
              />
            </label>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-sky-700 py-2 font-medium text-white hover:bg-sky-800"
          >
            {mode === 'new' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-xs leading-relaxed text-stone-500">
          Your identity is a secret key stored in this browser. Use “Copy secret key” in the sidebar to back it up, or
          to sign in on another device.
        </p>
      </div>
    </main>
  )
}
