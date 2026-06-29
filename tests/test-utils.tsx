import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { I18nProvider } from '@/lib/i18n/context'
import { useGameStore, type GameStoreState } from '@/store/gameStore'
import type {
  ActiveCurse,
  Card,
  Game,
  GameEvent,
  Landmark,
  Player,
  Team,
} from '@/lib/types'
import {
  getTestStore,
  mockGPS,
  mockRealtimeChannel,
  mockStorage,
  mockSupabaseClient,
  resetTestStore,
} from '../jest.setup'

export {
  getTestStore,
  mockGPS,
  mockRealtimeChannel,
  mockStorage,
  mockSupabaseClient,
  resetTestStore,
}

type Locale = 'en' | 'pt'

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  storeState?: Partial<GameStoreState>
  language?: Locale
}

function ProviderWrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}

export function renderWithProviders(
  component: ReactElement,
  options: RenderWithProvidersOptions = {},
) {
  resetTestStore()
  if (options.language) {
    window.localStorage.setItem('jl_locale', options.language)
  }
  if (options.storeState) {
    useGameStore.setState(options.storeState)
  }
  const { storeState: _storeState, language: _language, ...renderOptions } = options
  return render(component, {
    wrapper: ProviderWrapper,
    ...renderOptions,
  })
}

const createdAt = '2026-06-18T12:00:00.000Z'

export function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    code: 'ABCD',
    status: 'live',
    config: { duration_minutes: 180, starting_coins: 0 },
    started_at: createdAt,
    ended_at: null,
    created_at: createdAt,
    ...overrides,
  }
}

export function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-west',
    game_id: 'game-1',
    name: 'Team West',
    side: 'west',
    home_landmark_id: 'landmark.utad',
    coins: 100,
    created_at: createdAt,
    ...overrides,
  }
}

export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    team_id: 'team-west',
    display_name: 'Alex',
    role: 'player',
    device_id: 'test-device-id',
    flag_carrier: false,
    ready: true,
    is_host: false,
    respawning: false,
    created_at: createdAt,
    ...overrides,
  }
}

export function makeLandmark(overrides: Partial<Landmark> = {}): Landmark {
  return {
    id: 'landmark-row-1',
    game_id: 'game-1',
    ref: 'landmark.utad',
    lat: 41.2867,
    lng: -7.7399,
    team_id: 'team-west',
    kind: 'flag_real',
    hardened: false,
    created_at: createdAt,
    ...overrides,
  }
}

export function makeEvent(overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    id: 'event-1',
    game_id: 'game-1',
    type: 'challenge_completed',
    actor_player_id: 'player-1',
    payload: { team_id: 'team-west' },
    created_at: createdAt,
    ...overrides,
  }
}

export function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    game_id: 'game-1',
    team_id: 'team-west',
    kind: 'intel',
    ref: 'intel.eliminate-one',
    state: 'in_hand',
    payload: {
      intel_ref: 'intel.eliminate-one',
      not_real: { ref: 'landmark.enemy-a', name: 'Enemy A' },
    },
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  }
}

export function makeCurse(overrides: Partial<ActiveCurse> = {}): ActiveCurse {
  return {
    id: 'curse-1',
    game_id: 'game-1',
    target_team_id: 'team-west',
    curse_ref: 'curse.full-stop',
    started_at: createdAt,
    expires_at: '2026-06-18T12:03:00.000Z',
    params: {},
    created_at: createdAt,
    ...overrides,
  }
}

export function mockGameInProgress() {
  const west = makeTeam()
  const east = makeTeam({
    id: 'team-east',
    name: 'Team East',
    side: 'east',
    home_landmark_id: 'landmark.biblioteca',
  })
  const me = makePlayer({ id: 'player-west', team_id: west.id })
  const enemy = makePlayer({
    id: 'player-east',
    team_id: east.id,
    display_name: 'Blair',
  })
  useGameStore.setState({
    game: makeGame(),
    teams: [west, east],
    players: [me, enemy],
    me,
    isHydrated: true,
  })
  return { game: makeGame(), west, east, me, enemy }
}

export function mockPlayerAsDefender() {
  const data = mockGameInProgress()
  const gps = {
    lat: 41.2867,
    lng: -7.7399,
    accuracy: 5,
    updated_at: Date.now(),
  }
  useGameStore.setState({
    myGps: gps,
    myTeamLandmarks: [makeLandmark({ lat: gps.lat, lng: gps.lng })],
  })
  return { ...data, gps }
}

export function mockPlayerAsRaider() {
  const data = mockGameInProgress()
  const gps = {
    lat: 41.296,
    lng: -7.746,
    accuracy: 5,
    updated_at: Date.now(),
  }
  useGameStore.setState({
    myGps: gps,
    myTeamLandmarks: [makeLandmark({ lat: 41.2867, lng: -7.7399 })],
  })
  return { ...data, gps }
}

export function mockPlayerWithCoins(n: number) {
  const data = mockGameInProgress()
  useGameStore.setState({
    teams: data.west.id
      ? [{ ...data.west, coins: n }, data.east]
      : useGameStore.getState().teams,
  })
  return data
}
