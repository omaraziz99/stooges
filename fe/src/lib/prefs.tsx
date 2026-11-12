// Display preferences, kept per browser: the theme (Teh Susu = light,
// Kopi O = dark) and Manglish mode for the app's own text. Conversations,
// names and AI-written report text are never translated.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { translate, translateRich, type Lang, type Vars } from './i18n'

export type Theme = 'teh-susu' | 'kopi-o'

const THEME_KEY = 'stooges-theme' // also read by the script in index.html
const LANG_KEY = 'stooges-lang'

function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the choice lasts until reload.
  }
}

type Prefs = {
  theme: Theme
  setTheme: (t: Theme) => void
  lang: Lang
  setLang: (l: Lang) => void
}

const PrefsContext = createContext<Prefs | null>(null)

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (load(THEME_KEY) === 'kopi-o' ? 'kopi-o' : 'teh-susu'))
  const [lang, setLangState] = useState<Lang>(() => (load(LANG_KEY) === 'manglish' ? 'manglish' : 'en'))

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'kopi-o') root.dataset.theme = 'kopi-o'
    else delete root.dataset.theme
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = lang === 'manglish' ? 'en-MY' : 'en'
  }, [lang])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    save(THEME_KEY, t)
  }, [])
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    save(LANG_KEY, l)
  }, [])

  const value = useMemo(() => ({ theme, setTheme, lang, setLang }), [theme, setTheme, lang, setLang])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs(): Prefs {
  const prefs = useContext(PrefsContext)
  if (!prefs) throw new Error('usePrefs needs a PrefsProvider')
  return prefs
}

/**
 * The app's text in the chosen language. `t('Hello {name}', { name })` gives a
 * string; `t.rich(...)` also accepts React elements as values, for sentences
 * with bold or code inside.
 */
export function useT() {
  const { lang } = usePrefs()
  return useMemo(() => {
    const t = (text: string, vars?: Vars) => translate(lang, text, vars)
    t.rich = (text: string, vars: Record<string, ReactNode>) => translateRich(lang, text, vars)
    return t
  }, [lang])
}
