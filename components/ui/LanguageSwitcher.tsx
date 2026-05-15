'use client'

// EN / PT toggle. Two pill buttons; the active one is highlighted. Reads
// and writes the current locale via the i18n context — persistence is
// handled there.

import { useI18n } from '@/lib/i18n/context'
import { LOCALES, LOCALE_LABEL, LOCALE_FULL, type Locale } from '@/lib/i18n/messages'
import { cn } from '@/lib/cn'

interface Props {
  className?: string
  /** Compact mode shows only the two-letter codes. */
  compact?: boolean
}

export function LanguageSwitcher({ className, compact = true }: Props) {
  const { locale, setLocale } = useI18n()
  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-neutral-700 bg-neutral-900/80 p-0.5',
        className,
      )}
    >
      {LOCALES.map((l: Locale) => {
        const active = l === locale
        return (
          <button
            key={l}
            role="radio"
            aria-checked={active}
            type="button"
            onClick={() => setLocale(l)}
            title={LOCALE_FULL[l]}
            className={cn(
              'rounded px-2 py-0.5 text-xs font-semibold tracking-wider transition',
              active
                ? 'bg-neutral-100 text-neutral-900'
                : 'text-neutral-400 hover:text-neutral-100',
            )}
          >
            {compact ? LOCALE_LABEL[l] : LOCALE_FULL[l]}
          </button>
        )
      })}
    </div>
  )
}
