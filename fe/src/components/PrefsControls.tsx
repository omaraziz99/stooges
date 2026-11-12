import { useEffect, useRef, useState } from 'react'
import { Coffee, Languages, Milk, Settings } from 'lucide-react'
import { usePrefs, useT, type Theme } from '../lib/prefs'

const THEMES: { id: Theme; label: string; Icon: typeof Coffee; hint: string }[] = [
  { id: 'teh-susu', label: 'Teh Susu', Icon: Milk, hint: 'Switch to Teh Susu (light)' },
  { id: 'kopi-o', label: 'Kopi O', Icon: Coffee, hint: 'Switch to Kopi O (dark)' },
]

/**
 * Teh Susu (light) / Kopi O (dark). `inMenu` gives the buttons menu roles,
 * for use inside the account menu.
 */
export function ThemeSwitch({ inMenu = false }: { inMenu?: boolean }) {
  const { theme, setTheme } = usePrefs()
  const t = useT()
  return (
    <div
      role={inMenu ? 'group' : 'radiogroup'}
      aria-label={t('Theme')}
      className="flex gap-0.5 rounded-full bg-black/[0.05] p-0.5"
    >
      {THEMES.map(({ id, label, Icon, hint }) => {
        const active = theme === id
        return (
          <button
            key={id}
            type="button"
            role={inMenu ? 'menuitemradio' : 'radio'}
            aria-checked={active}
            title={t(hint)}
            onClick={() => setTheme(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-white text-gray-900 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.08)]'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Icon aria-hidden className="size-3.5" />
            {t(label)}
          </button>
        )
      })}
    </div>
  )
}

/** Switches the app's own text (not conversations) into Manglish. */
export function ManglishSwitch({ inMenu = false, className = '' }: { inMenu?: boolean; className?: string }) {
  const { lang, setLang } = usePrefs()
  const t = useT()
  const on = lang === 'manglish'
  return (
    <button
      type="button"
      role={inMenu ? 'menuitemcheckbox' : 'switch'}
      aria-checked={on}
      onClick={() => setLang(on ? 'en' : 'manglish')}
      className={`flex items-center gap-2 text-left text-sm text-gray-800 ${className}`}
    >
      <Languages aria-hidden className="size-4 text-gray-500" />
      <span className="flex-1">{t('Manglish mode')}</span>
      <span
        aria-hidden
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-brand-600' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-[#fff] shadow transition-transform ${on ? 'translate-x-4' : ''}`}
        />
      </span>
    </button>
  )
}

/** A gear button that opens theme (Teh Susu / Kopi O) and Manglish mode in a small menu. Used on the landing, login and dashboard pages. */
export function SettingsMenu() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('Settings')}
        title={t('Settings')}
        className={`flex size-10 items-center justify-center rounded-full border border-gray-200 text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${open ? 'bg-gray-100' : 'bg-white'}`}
      >
        <Settings aria-hidden className="size-[18px]" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('Settings')}
          className="absolute top-full right-0 z-30 mt-2 w-64 rounded-2xl bg-white p-2 text-gray-900 shadow-lg ring-1 ring-black/10"
        >
          <p className="px-2.5 pt-1 pb-2 text-xs font-medium text-gray-500">{t('Theme')}</p>
          <div className="px-1 pb-2">
            <ThemeSwitch inMenu />
          </div>
          <div role="separator" className="my-1 border-t border-gray-200" />
          <ManglishSwitch inMenu className="w-full rounded-lg px-2.5 py-2 hover:bg-black/5" />
        </div>
      )}
    </div>
  )
}
