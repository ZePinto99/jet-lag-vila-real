'use client'

// ConfirmSpendModal (playtest item G21) — a full modal shown before ANY coin
// spend. Displays the item, its cost, and the resulting balance, and requires
// an explicit confirmation. Controlled: the parent owns `open` and the
// confirm/cancel handlers. Replaces the inconsistent inline confirms (some
// spends had a two-step inline confirm, some had none).

import { useT } from '@/lib/i18n/context'

export interface ConfirmSpendModalProps {
  open: boolean
  /** Human label for what's being bought (already localised by the caller). */
  itemName: string
  cost: number
  /** Current team coin balance. */
  balance: number
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmSpendModal({
  open,
  itemName,
  cost,
  balance,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmSpendModalProps) {
  const t = useT()
  if (!open) return null

  const after = balance - cost
  const insufficient = after < 0

  return (
    <div
      className="fixed inset-0 z-[2000] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-xs rounded-2xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-neutral-100">
          {t('spend.title')}
        </h2>

        <dl className="mt-4 flex flex-col gap-2 text-sm">
          <Row label={t('spend.item')} value={itemName} />
          <Row label={t('spend.cost')} value={`−${cost}`} valueClass="text-amber-300 tabular-nums" />
          <Row label={t('spend.balance_now')} value={String(balance)} valueClass="tabular-nums" />
          <div className="my-1 border-t border-neutral-800" />
          <Row
            label={t('spend.balance_after')}
            value={String(after)}
            valueClass={
              'font-semibold tabular-nums ' +
              (insufficient ? 'text-red-400' : 'text-emerald-300')
            }
          />
        </dl>

        {insufficient && (
          <p className="mt-3 rounded bg-red-950/60 px-2 py-1 text-[11px] text-red-200">
            {t('spend.insufficient')}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded bg-red-950/60 px-2 py-1 text-[11px] text-red-200">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl bg-neutral-800 px-4 py-3 text-sm font-semibold text-neutral-300 transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || insufficient}
            className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-900/40 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t('common.saving') : t('spend.confirm_button')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  valueClass = '',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-neutral-400">{label}</dt>
      <dd className={'text-right text-neutral-100 ' + valueClass}>{value}</dd>
    </div>
  )
}
