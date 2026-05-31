'use client'

// ToastLayer — renders the in-app discovery toasts from useGameToasts at the
// top-center of the live view. Foregrounded PWA only; tap a toast to dismiss.

import { cn } from '@/lib/cn'
import type { GameToast, ToastTone } from '@/lib/hooks/useGameToasts'

const TONE_CLASS: Record<ToastTone, string> = {
  alert: 'border-red-500/60 bg-red-950/90 text-red-50',
  warn: 'border-amber-500/60 bg-amber-950/90 text-amber-50',
  success: 'border-emerald-500/60 bg-emerald-950/90 text-emerald-50',
  info: 'border-sky-500/60 bg-sky-950/90 text-sky-50',
}

export function ToastLayer({
  toasts,
  onDismiss,
}: {
  toasts: GameToast[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[1200] flex flex-col items-center gap-1.5 px-3">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => onDismiss(toast.id)}
          className={cn(
            'pointer-events-auto w-full max-w-sm rounded-xl border px-3 py-2 text-left text-xs font-medium shadow-lg backdrop-blur transition',
            TONE_CLASS[toast.tone],
          )}
        >
          {toast.text}
        </button>
      ))}
    </div>
  )
}
