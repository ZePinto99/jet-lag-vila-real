'use client'

// useChat (playtest item G22) — ephemeral in-game chat over Supabase Realtime
// BROADCAST. Nothing is persisted: messages live only for the current session
// and never appear in end-game results.
//
// Two channels:
//   • game:{id}:chat:global      — everyone in the game.
//   • game:{id}:chat:team:{tid}  — only the caller's team (the enemy never
//                                   subscribes to it, so team chat stays private
//                                   even though anon reads are otherwise open).
//
// Sender sees their own message immediately (broadcast self:true).

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

export type ChatScope = 'global' | 'team'

export interface ChatMessage {
  id: string
  scope: ChatScope
  playerId: string
  name: string
  teamId: string
  text: string
  ts: number
}

const MAX_MESSAGES = 200

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

export function useChat(
  gameId: string | null,
  myPlayerId: string | null,
  myTeamId: string | null,
  myName: string,
): {
  messages: ChatMessage[]
  send: (scope: ChatScope, text: string) => void
  connected: boolean
} {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connected, setConnected] = useState(false)
  const globalRef = useRef<RealtimeChannel | null>(null)
  const teamRef = useRef<RealtimeChannel | null>(null)
  const nameRef = useRef(myName)
  nameRef.current = myName

  useEffect(() => {
    if (!gameId || !myPlayerId || !myTeamId) return
    const supabase = createClient()

    const append = (m: ChatMessage) =>
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev
        return [...prev, m].slice(-MAX_MESSAGES)
      })

    const globalCh = supabase.channel(`game:${gameId}:chat:global`, {
      config: { broadcast: { self: true } },
    })
    const teamCh = supabase.channel(`game:${gameId}:chat:team:${myTeamId}`, {
      config: { broadcast: { self: true } },
    })

    let subscribedCount = 0
    const onSub = (status: string) => {
      if (status === 'SUBSCRIBED') {
        subscribedCount += 1
        if (subscribedCount >= 2) setConnected(true)
      }
    }

    globalCh
      .on('broadcast', { event: 'msg' }, ({ payload }) =>
        append(payload as ChatMessage),
      )
      .subscribe(onSub)
    teamCh
      .on('broadcast', { event: 'msg' }, ({ payload }) =>
        append(payload as ChatMessage),
      )
      .subscribe(onSub)

    globalRef.current = globalCh
    teamRef.current = teamCh

    return () => {
      globalRef.current = null
      teamRef.current = null
      setConnected(false)
      supabase.removeChannel(globalCh)
      supabase.removeChannel(teamCh)
      setMessages([])
    }
  }, [gameId, myPlayerId, myTeamId])

  const send = useCallback(
    (scope: ChatScope, text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !myPlayerId || !myTeamId) return
      const channel = scope === 'global' ? globalRef.current : teamRef.current
      if (!channel) return
      const msg: ChatMessage = {
        id: newId(),
        scope,
        playerId: myPlayerId,
        name: nameRef.current || 'Player',
        teamId: myTeamId,
        text: trimmed.slice(0, 500),
        ts: Date.now(),
      }
      channel.send({ type: 'broadcast', event: 'msg', payload: msg })
    },
    [myPlayerId, myTeamId],
  )

  return { messages, send, connected }
}
