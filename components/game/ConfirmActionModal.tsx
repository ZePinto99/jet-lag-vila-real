'use client'

import { useId } from 'react'
import { useT } from '@/lib/i18n/context'
import { useModalDialog } from '@/lib/hooks/useModalDialog'

interface ConfirmActionModalProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  busy?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** PWA-safe confirmation dialog for non-spend actions such as leave/kick. */
export function ConfirmActionModal({
  open,
  title,
  body,
  confirmLabel,
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  const t = useT()
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useModalDialog({ open, busy, onCancel })

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[2000] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-xs rounded-2xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold text-neutral-100">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-neutral-400">{body}</p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-dialog-autofocus
            className="flex-1 rounded-xl bg-neutral-800 px-4 py-3 text-sm font-semibold text-neutral-300 transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              'flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-50 ' +
              (danger
                ? 'bg-red-500 text-white hover:bg-red-400'
                : 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400')
            }
          >
            {busy ? t('common.saving') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
