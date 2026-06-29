import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { useGameStore } from '@/store/gameStore'

type Callback = (payload?: unknown) => void
type PresenceState = Record<string, unknown[]>

export interface MockRealtimeChannel {
  name: string
  callbacks: Array<{
    type: string
    filter: Record<string, unknown>
    callback: Callback
  }>
  on: jest.MockedFunction<
    (type: string, filter: Record<string, unknown>, callback: Callback) => MockRealtimeChannel
  >
  subscribe: jest.MockedFunction<(callback?: (status: string) => void) => MockRealtimeChannel>
  track: jest.MockedFunction<(payload: unknown) => Promise<void>>
  untrack: jest.MockedFunction<() => Promise<void>>
  presenceState: jest.MockedFunction<() => PresenceState>
  setPresenceState: (state: PresenceState) => void
  emit: (type: string, payload: unknown) => void
  emitPresence: (event: 'sync' | 'join' | 'leave') => void
}

interface SupabaseStorageBucketMock {
  upload: jest.Mock
  getPublicUrl: jest.Mock
}

interface SupabaseMockClient {
  channel: jest.Mock
  removeChannel: jest.Mock
  storage: {
    from: jest.Mock
  }
  from: jest.Mock
  auth: {
    signInAnonymously: jest.Mock
  }
}

const channels: MockRealtimeChannel[] = []
let mockCurrentStorageBucket: SupabaseStorageBucketMock
let mockCurrentClient: SupabaseMockClient
let mockCurrentAdminClient: SupabaseMockClient

function createStorageBucket(): SupabaseStorageBucketMock {
  return {
    upload: jest.fn().mockResolvedValue({ data: { path: 'mock/path.jpg' }, error: null }),
    getPublicUrl: jest.fn((path: string) => ({
      data: { publicUrl: `https://storage.test/${path}` },
    })),
  }
}

export function mockRealtimeChannel(name = 'mock-channel'): MockRealtimeChannel {
  let state: PresenceState = {}
  const channel: MockRealtimeChannel = {
    name,
    callbacks: [],
    on: jest.fn((type: string, filter: Record<string, unknown>, callback: Callback) => {
      channel.callbacks.push({ type, filter, callback })
      return channel
    }),
    subscribe: jest.fn((callback?: (status: string) => void) => {
      callback?.('SUBSCRIBED')
      return channel
    }),
    track: jest.fn().mockResolvedValue(undefined),
    untrack: jest.fn().mockResolvedValue(undefined),
    presenceState: jest.fn(() => state),
    setPresenceState: (next: PresenceState) => {
      state = next
    },
    emit: (type: string, payload: unknown) => {
      for (const entry of channel.callbacks) {
        if (entry.type === type) entry.callback(payload)
      }
    },
    emitPresence: (event: 'sync' | 'join' | 'leave') => {
      for (const entry of channel.callbacks) {
        if (
          entry.type === 'presence' &&
          (entry.filter as { event?: string }).event === event
        ) {
          entry.callback()
        }
      }
    },
  } satisfies MockRealtimeChannel
  channels.push(channel)
  return channel
}

function createSupabaseMock(): SupabaseMockClient {
  const client = {
    channel: jest.fn((name: string) => mockRealtimeChannel(name)),
    removeChannel: jest.fn(),
    storage: {
      from: jest.fn(() => mockCurrentStorageBucket),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      signInAnonymously: jest.fn().mockResolvedValue({ data: {}, error: null }),
    },
  }
  return client
}

export function mockSupabaseClient(
  overrides: Partial<SupabaseMockClient> = {},
): SupabaseMockClient {
  mockCurrentClient = { ...createSupabaseMock(), ...overrides }
  return mockCurrentClient
}

export function mockSupabaseAdmin(
  overrides: Partial<SupabaseMockClient> = {},
): SupabaseMockClient {
  mockCurrentAdminClient = { ...createSupabaseMock(), ...overrides }
  return mockCurrentAdminClient
}

export function mockStorage(
  overrides: Partial<SupabaseStorageBucketMock> = {},
): SupabaseStorageBucketMock {
  mockCurrentStorageBucket = { ...createStorageBucket(), ...overrides }
  return mockCurrentStorageBucket
}

interface MockGPSControl {
  watchPosition: jest.Mock
  clearWatch: jest.Mock
  emitPosition: (
    coords: Partial<GeolocationCoordinates> & { latitude: number; longitude: number },
  ) => void
  emitError: (code: number) => void
}

export function mockGPS(): MockGPSControl {
  const watchers = new Map<
    number,
    {
      success: PositionCallback
      error?: PositionErrorCallback | null
    }
  >()
  let nextId = 1
  const control: MockGPSControl = {
    watchPosition: jest.fn((success: PositionCallback, error?: PositionErrorCallback | null) => {
      const id = nextId++
      watchers.set(id, { success, error })
      return id
    }),
    clearWatch: jest.fn((id: number) => {
      watchers.delete(id)
    }),
    emitPosition: (coords) => {
      const position = {
        coords: {
          accuracy: coords.accuracy ?? 5,
          altitude: coords.altitude ?? null,
          altitudeAccuracy: coords.altitudeAccuracy ?? null,
          heading: coords.heading ?? null,
          latitude: coords.latitude,
          longitude: coords.longitude,
          speed: coords.speed ?? null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition
      for (const watcher of watchers.values()) watcher.success(position)
    },
    emitError: (code) => {
      const error = {
        code,
        message: 'mock gps error',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError
      for (const watcher of watchers.values()) watcher.error?.(error)
    },
  }

  if (typeof window === 'undefined') return control

  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: control.watchPosition,
      clearWatch: control.clearWatch,
    },
  })
  return control
}

export function getTestStore() {
  return useGameStore
}

export function resetTestStore() {
  useGameStore.getState().clear()
}

class MockResponse {
  status: number
  ok: boolean
  private body: string

  constructor(body: string | null = null, init: { status?: number } = {}) {
    this.status = init.status ?? 200
    this.ok = this.status >= 200 && this.status < 300
    this.body = body ?? ''
  }

  async text() {
    return this.body
  }

  async json() {
    return this.body ? JSON.parse(this.body) : null
  }
}

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => mockCurrentClient),
}))

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(() => mockCurrentAdminClient),
}))

beforeEach(() => {
  jest.useRealTimers()
  channels.length = 0
  mockStorage()
  mockSupabaseClient()
  mockSupabaseAdmin()
  resetTestStore()
  if (typeof window !== 'undefined') {
    if (typeof globalThis.Response === 'undefined') {
      Object.defineProperty(globalThis, 'Response', {
        configurable: true,
        value: MockResponse,
      })
    }
    mockGPS()
    window.localStorage.clear()
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: jest.fn(() => 'test-device-id'),
    })
  }
  jest.setTimeout(15_000)
})

afterEach(() => {
  cleanup()
  resetTestStore()
  jest.restoreAllMocks()
  jest.clearAllMocks()
})
