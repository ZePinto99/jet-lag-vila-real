// Zustand store — single source of truth on the client for game state.
// Step 1 holds the lobby snapshot (game, teams, players, me).
// Step 3 adds the live-phase snapshot (landmarks, curses, cards, events) plus
// the realtime-derived GPS + presence state. Lobby actions remain intact.

import { create } from 'zustand'
import type {
  ActiveCurse,
  Card,
  EnemyLandmark,
  Game,
  GameEvent,
  GpsPosition,
  Landmark,
  LiveStateResponse,
  PlacedCurse,
  Player,
  PresencePayload,
  Team,
} from '@/lib/types'

export interface LobbySnapshot {
  game: Game
  teams: Team[]
  players: Player[]
  me?: Player | null
}

const MAX_EVENTS_KEPT = 200

export interface GameStoreState {
  // identity / lobby snapshot
  game: Game | null
  teams: Team[]
  players: Player[]
  me: Player | null
  isHydrated: boolean

  // live phase
  myTeamLandmarks: Landmark[]
  enemyLandmarks: EnemyLandmark[]
  activeCurses: ActiveCurse[] // curses targeting my team
  myCards: Card[]              // my team's cards (challenge/curse/intel, any state)
  myPlacedCurses: PlacedCurse[] // my team's armed placements (hidden from enemy)
  events: GameEvent[]          // append-only; capped at MAX_EVENTS_KEPT client-side

  // local-only realtime state
  myGps: GpsPosition | null
  presence: Record<string, PresencePayload>
}

export interface GameStoreActions {
  // lobby (existing)
  setSnapshot: (snapshot: LobbySnapshot) => void
  upsertPlayer: (player: Player) => void
  removePlayer: (playerId: string) => void
  setMe: (player: Player | null) => void
  setGame: (game: Game) => void
  upsertTeam: (team: Team) => void
  clear: () => void

  // live phase (step 3)
  setLiveSnapshot: (snapshot: LiveStateResponse) => void
  setMyGps: (pos: GpsPosition | null) => void
  setPresence: (presence: Record<string, PresencePayload>) => void
  appendEvent: (event: GameEvent) => void
  upsertActiveCurse: (curse: ActiveCurse) => void
  removeActiveCurse: (id: string) => void
  upsertCard: (card: Card) => void
  removeCard: (id: string) => void
  addPlacedCurse: (placed: PlacedCurse) => void
  removePlacedCurseByLandmark: (landmarkRef: string) => void
}

export type GameStore = GameStoreState & GameStoreActions

const initialState: GameStoreState = {
  game: null,
  teams: [],
  players: [],
  me: null,
  isHydrated: false,

  myTeamLandmarks: [],
  enemyLandmarks: [],
  activeCurses: [],
  myCards: [],
  myPlacedCurses: [],
  events: [],

  myGps: null,
  presence: {},
}

export const useGameStore = create<GameStore>((set) => ({
  ...initialState,

  // --- lobby actions ---

  setSnapshot: (snapshot) =>
    set(() => ({
      game: snapshot.game,
      teams: snapshot.teams,
      players: snapshot.players,
      me: snapshot.me ?? null,
      isHydrated: true,
    })),

  upsertPlayer: (player) =>
    set((state) => {
      const idx = state.players.findIndex((p) => p.id === player.id)
      const players =
        idx === -1
          ? [...state.players, player]
          : state.players.map((p) => (p.id === player.id ? player : p))
      const me = state.me && state.me.id === player.id ? player : state.me
      return { players, me }
    }),

  removePlayer: (playerId) =>
    set((state) => ({
      players: state.players.filter((p) => p.id !== playerId),
      me: state.me && state.me.id === playerId ? null : state.me,
    })),

  setMe: (player) => set(() => ({ me: player })),

  setGame: (game) => set(() => ({ game })),

  upsertTeam: (team) =>
    set((state) => {
      const idx = state.teams.findIndex((t) => t.id === team.id)
      const teams =
        idx === -1
          ? [...state.teams, team]
          : state.teams.map((t) => (t.id === team.id ? team : t))
      return { teams }
    }),

  clear: () => set(() => ({ ...initialState })),

  // --- live-phase actions ---

  setLiveSnapshot: (snapshot) =>
    set((state) => {
      // Find/update `me` from the freshly fetched players list when possible.
      const nextMe = state.me
        ? snapshot.players.find((p) => p.id === state.me!.id) ?? state.me
        : state.me
      const cappedEvents = snapshot.recent_events.slice(-MAX_EVENTS_KEPT)
      return {
        game: snapshot.game,
        teams: snapshot.teams,
        players: snapshot.players,
        me: nextMe,
        isHydrated: true,
        myTeamLandmarks: snapshot.my_team_landmarks,
        enemyLandmarks: snapshot.enemy_landmarks,
        activeCurses: snapshot.active_curses,
        myCards: snapshot.my_cards,
        myPlacedCurses: snapshot.my_placed_curses ?? [],
        events: cappedEvents,
      }
    }),

  setMyGps: (pos) => set(() => ({ myGps: pos })),

  setPresence: (presence) => set(() => ({ presence })),

  appendEvent: (event) =>
    set((state) => {
      // Dedupe by id to avoid double inserts when the realtime subscription
      // and a fresh snapshot fetch race.
      if (state.events.some((e) => e.id === event.id)) return {}
      const next = [...state.events, event]
      const capped =
        next.length > MAX_EVENTS_KEPT
          ? next.slice(next.length - MAX_EVENTS_KEPT)
          : next
      return { events: capped }
    }),

  upsertActiveCurse: (curse) =>
    set((state) => {
      const idx = state.activeCurses.findIndex((c) => c.id === curse.id)
      const activeCurses =
        idx === -1
          ? [...state.activeCurses, curse]
          : state.activeCurses.map((c) => (c.id === curse.id ? curse : c))
      return { activeCurses }
    }),

  removeActiveCurse: (id) =>
    set((state) => ({
      activeCurses: state.activeCurses.filter((c) => c.id !== id),
    })),

  upsertCard: (card) =>
    set((state) => {
      const idx = state.myCards.findIndex((c) => c.id === card.id)
      const myCards =
        idx === -1
          ? [...state.myCards, card]
          : state.myCards.map((c) => (c.id === card.id ? card : c))
      return { myCards }
    }),

  removeCard: (id) =>
    set((state) => ({
      myCards: state.myCards.filter((c) => c.id !== id),
    })),

  addPlacedCurse: (placed) =>
    set((state) => {
      if (state.myPlacedCurses.some((p) => p.id === placed.id)) return {}
      return { myPlacedCurses: [...state.myPlacedCurses, placed] }
    }),

  removePlacedCurseByLandmark: (landmarkRef) =>
    set((state) => ({
      myPlacedCurses: state.myPlacedCurses.filter(
        (p) => p.landmark_ref !== landmarkRef,
      ),
    })),
}))
