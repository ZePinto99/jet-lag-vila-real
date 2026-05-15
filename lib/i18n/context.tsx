'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_LOCALE,
  LOCALES,
  translate,
  type Locale,
} from './messages'

const STORAGE_KEY = 'jl_locale'

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, tokens?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as ReadonlyArray<string>).includes(v)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Hydrate from localStorage on mount. Server-render starts in DEFAULT_LOCALE
  // to avoid hydration mismatch; the client effect then swaps if needed.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (isLocale(stored) && stored !== locale) {
        setLocaleState(stored)
      }
    } catch {
      /* localStorage unavailable — keep default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
      // Optional: reflect in <html lang>. Not critical for the app but nice
      // for accessibility tools.
      if (typeof document !== 'undefined') {
        document.documentElement.lang = next
      }
    } catch {
      /* localStorage unavailable */
    }
  }, [])

  const value = useMemo<I18nContextValue>(() => {
    return {
      locale,
      setLocale,
      t: (key, tokens) => translate(key, locale, tokens),
    }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const v = useContext(I18nContext)
  if (!v) {
    // Provider not mounted (e.g. server-rendered fragment). Fall back to a
    // no-op translator so server output stays in the default locale.
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key, tokens) => translate(key, DEFAULT_LOCALE, tokens),
    }
  }
  return v
}

export function useT() {
  return useI18n().t
}
