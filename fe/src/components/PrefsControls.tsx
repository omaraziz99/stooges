import { Coffee, Languages, Milk } from 'lucide-react'
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
                ? 'bg-white text-stone-900 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.08)]'
                : 'text-stone-500 hover:text-stone-900'
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
      className={`flex items-center gap-2 text-left text-sm text-stone-800 ${className}`}
    >
      <Languages aria-hidden className="size-4 text-stone-500" />
      <span className="flex-1">{t('Manglish mode')}</span>
      <span
        aria-hidden
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-stone-300'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-[#fff] shadow transition-transform ${on ? 'translate-x-4' : ''}`}
        />
      </span>
    </button>
  )
}
