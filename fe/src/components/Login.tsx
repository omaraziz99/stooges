import { lazy, Suspense, useState, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { logIn, MIN_PASSWORD, signUp } from '../lib/auth'
import { usePrefs, useT } from '../lib/prefs'
import { cn } from '../lib/utils'
import { ManglishSwitch, ThemeSwitch } from './PrefsControls'
import { LiquidGlass } from './ui/liquid-glass'

// three.js is large, so the cube background loads only when the login page shows.
const BackgroundCubesGrid = lazy(() =>
  import('./ui/background-cubes-grid').then((m) => ({ default: m.BackgroundCubesGrid })),
)

const EASE_OUT = [0.215, 0.61, 0.355, 1] as const

/** Create an account (name, email, password) or log in (email, password). */
export function Login({ onLogin }: { onLogin: (secretKey: Uint8Array, name: string | null) => void }) {
  const reduceMotion = useReducedMotion()
  const t = useT()
  const { theme } = usePrefs()
  const [mode, setMode] = useState<'signup' | 'login'>('signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === 'signup' && !name.trim()) return setError(t('Enter your name.'))
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      return setError(t('Use at least {n} characters for your password.', { n: MIN_PASSWORD }))
    }
    setBusy(true)
    try {
      if (mode === 'signup') onLogin(await signUp(email, password), name.trim())
      else onLogin(await logIn(email, password), null)
    } catch (err) {
      // Server messages are English; known ones have a Manglish version.
      setError(t(err instanceof Error ? err.message : String(err)))
      setBusy(false)
    }
  }

  const switchMode = (next: 'signup' | 'login') => {
    setMode(next)
    setError(null)
  }

  const tab = (active: boolean) =>
    cn(
      'flex-1 rounded-full py-1.5 text-sm font-medium transition-colors',
      active
        ? 'bg-white text-neutral-900 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.06)]'
        : 'text-neutral-500 hover:text-neutral-900',
    )
  const label = 'block text-sm font-medium text-neutral-900'
  const field =
    'mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-black/30 disabled:opacity-60'

  return (
    <main className="relative isolate flex min-h-dvh w-full items-center justify-center overflow-hidden px-5 py-16">
      <Suspense fallback={<div aria-hidden className="absolute inset-0 -z-10 bg-stone-50" />}>
        {/* WebGL, so it can't use the CSS palette: Kopi O gets roasted cubes. */}
        {theme === 'kopi-o' ? (
          <BackgroundCubesGrid
            className="-z-10"
            topColor="#2b221c"
            leftColor="#211a15"
            rightColor="#18130f"
            glowColor="#8a6248"
          />
        ) : (
          <BackgroundCubesGrid className="-z-10" />
        )}
      </Suspense>

      <div className="absolute top-4 right-4 flex flex-col items-end gap-2 sm:flex-row sm:items-center">
        <div className="w-52">
          <ThemeSwitch />
        </div>
        <ManglishSwitch className="rounded-full bg-white/80 py-1 pr-1.5 pl-3 shadow-sm ring-1 ring-black/5 backdrop-blur" />
      </div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.1 }}
        className="flex w-full max-w-sm flex-col items-center antialiased"
      >
        <h1 className="text-[clamp(36px,5vw,52px)] font-medium tracking-[-0.03em] text-neutral-900">Stooges</h1>

        <LiquidGlass
          radius={24}
          className="mt-8 w-full shadow-[0_12px_40px_rgb(0_0_0/0.25),inset_0_1px_0_rgb(255_255_255/0.5)]"
        >
        <form onSubmit={submit} className="p-5">
          <div className="flex gap-1 rounded-full bg-black/[0.04] p-1" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={tab(mode === 'signup')} onClick={() => switchMode('signup')}>
              {t('Create account')}
            </button>
            <button type="button" role="tab" aria-selected={mode === 'login'} className={tab(mode === 'login')} onClick={() => switchMode('login')}>
              {t('Log in')}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {mode === 'signup' && (
              <label className={label}>
                {t('Name')}
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={64}
                  autoComplete="name"
                  placeholder="Maya Chen"
                  disabled={busy}
                  className={field}
                />
              </label>
            )}
            <label className={label}>
              {t('Email')}
              <input
                autoFocus={mode === 'login'}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@company.com"
                disabled={busy}
                className={field}
              />
            </label>
            <label className={label}>
              {t('Password')}
              <input
                type="password"
                required
                minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? t('At least {n} characters', { n: MIN_PASSWORD }) : ''}
                disabled={busy}
                className={field}
              />
            </label>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-neutral-900 px-5 text-[15px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-colors hover:bg-neutral-800 disabled:opacity-60"
          >
            {busy
              ? t(mode === 'signup' ? 'Creating account…' : 'Logging in…')
              : t(mode === 'signup' ? 'Create account' : 'Log in')}
          </button>
        </form>
        </LiquidGlass>
      </motion.div>
    </main>
  )
}
