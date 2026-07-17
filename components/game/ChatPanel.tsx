'use client'

// ChatPanel (playtest item G22) — the writable chat surface. Global + per-team
// channels via useChat (ephemeral broadcast, no persistence). Fills the tab and
// keeps the newest message in view.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n/context'
import type { ChatMessage, ChatScope } from '@/lib/hooks/useChat'

interface ChatPanelProps {
  messages: ChatMessage[]
  send: (scope: ChatScope, text: string) => void
  connected: boolean
  myPlayerId: string
  teamColorClass: string
}

export function ChatPanel({
  messages,
  send,
  connected,
  myPlayerId,
  teamColorClass,
}: ChatPanelProps) {
  const t = useT()
  const [scope, setScope] = useState<ChatScope>('global')
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  const visible = useMemo(
    () => messages.filter((m) => m.scope === scope),
    [messages, scope],
  )

  // Keep pinned to the newest message.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible.length])

  function onSend(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    send(scope, text)
    setDraft('')
  }

  return (
    <section className="mx-auto flex h-full max-w-2xl flex-col px-4 py-3">
      <div className="flex items-center gap-2">
        <ScopeTab
          label={t('chat.channel_global')}
          active={scope === 'global'}
          onClick={() => setScope('global')}
        />
        <ScopeTab
          label={t('chat.channel_team')}
          active={scope === 'team'}
          onClick={() => setScope('team')}
          accentClass={teamColorClass}
        />
        <span className="ml-auto text-[10px] text-neutral-500">
          {connected ? t('chat.ephemeral_note') : t('chat.connecting')}
        </span>
      </div>

      <div
        ref={listRef}
        className="mt-3 flex-1 space-y-2 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 p-3"
      >
        {visible.length === 0 ? (
          <p className="py-8 text-center text-xs text-neutral-500">
            {t('chat.empty')}
          </p>
        ) : (
          visible.map((m) => {
            const mine = m.playerId === myPlayerId
            return (
              <div
                key={m.id}
                className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}
              >
                <span className="px-1 text-[10px] text-neutral-500">
                  {mine ? t('chat.you') : m.name}
                </span>
                <span
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3 py-1.5 text-sm',
                    mine
                      ? 'bg-emerald-600/80 text-white'
                      : 'bg-neutral-800 text-neutral-100',
                  )}
                >
                  {m.text}
                </span>
              </div>
            )
          })
        )}
      </div>

      <form onSubmit={onSend} className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('chat.placeholder')}
          maxLength={500}
          className="flex-1 rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {t('chat.send')}
        </button>
      </form>
    </section>
  )
}

function ScopeTab({
  label,
  active,
  onClick,
  accentClass,
}: {
  label: string
  active: boolean
  onClick: () => void
  accentClass?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-medium transition',
        active
          ? 'bg-neutral-800 text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-300',
        active && accentClass,
      )}
    >
      {label}
    </button>
  )
}
