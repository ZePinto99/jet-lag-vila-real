# Jet Lag: Vila Real — Technical Architecture

## 1. System overview

```
┌──────────────────────────────────────────────────────────────────┐
│                   PLAYER PHONES  (PWA, installed)                │
│                                                                  │
│  useGPS (watchPosition)          useTagButton (distance calc)    │
│  usePresence (publish GPS)       useCurseEnforcement (self-mon.) │
│  useGameState (event sub)        Leaflet map                     │
│                                                                  │
│         Zustand store ←── Supabase Realtime subscriptions        │
└────────────────────┬─────────────────────────────────────────────┘
                     │  HTTPS + WebSocket (Supabase Realtime)
         ┌───────────┴──────────────────────┐
         │                                  │
         ▼                                  ▼
┌──────────────────┐          ┌─────────────────────────────────┐
│  Next.js API     │          │   Supabase Realtime             │
│  (Server Actions │          │                                 │
│   / Route Hdlrs) │          │  Presence: game:{id}:positions  │
│                  │          │  (ephemeral GPS, 5 s cadence)   │
│  All mutations   │          │                                 │
│  go through here │          │  DB changes: events table       │
│  → validate      │          │  (triggers client state update) │
│  → write DB      │◄────────►│                                 │
│  → presence snp. │          └─────────────────────────────────┘
└────────┬─────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│                  Supabase  (BaaS)                      │
│                                                        │
│  PostgreSQL (9 tables, append-only events)             │
│  Storage    (photo uploads for flag/challenge/curse)   │
│  pg_cron    (curse expiry every 30 s)                  │
│  Auth       (anonymous sessions — no login required)   │
└────────────────────────────────────────────────────────┘
```

One Next.js app deployed to Vercel. One Supabase project. No separate backend service.

---

## 2. Database schema

Full DDL lives in `supabase/migrations/`. Below is the semantic contract each table holds.

### `games`
One row per game session.
- `status`: `lobby | setup | live | flag_found | finished`  
  `setup` is added vs the migration (teams at home base assigning flags).  
  `flag_found` is added for the chase phase after flag is photographed.
- `config`: jsonb bag for per-game settings (map bounds, time limit, etc.)
- `code`: short human-readable join code (e.g. `"XKBR"`) — add in migration 0002.

### `teams`
Two rows per game (West / East).
- `home_landmark_id`: references the seed landmark ref (e.g. `"landmark.utad-main-library"`).
- `coins`: **mutable counter**. The events table is append-only; coins are the one exception — updated by API handlers as a derived materialization to avoid re-scanning the entire event log on every request. Kept consistent by always writing an event first, then updating this column in the same transaction.

### `players`
One row per phone in the game.
- `role`: `player` only (captain role removed).
- `device_id`: localStorage UUID, used to reconnect to the same player record after page reload.
- `flag_carrier`: boolean (added in migration 0002) — true for the player who photographed the real flag.

### `landmarks`
Per-game state. Not the seed catalog (`/data/landmarks.json`).
- `ref`: foreign key into the seed catalog by ID string.
- `kind`: `flag_real | flag_decoy | flag_empty | home | neutral`.
- Only visible to the owning team (RLS). The other team sees `kind = null` until the flag is found.
- `hardened`: true if the owning team spent 150 coins to upgrade the challenge gate.

### `cards`
Per-team inventory of challenge, curse, and intel cards.
- `ref`: ID string into the seed JSON files.
- `state`: `available | in_hand | active | consumed | expired`.
- `payload`: jsonb with computed answer (for intel) or curse params (for active curses).

### `events`
**Append-only source of truth.** Trigger blocks UPDATE and DELETE.
Key event types:

| type | payload keys |
|---|---|
| `player_joined` | player_id, team_id |
| `game_started` | — |
| `flags_assigned` | team_id |
| `flag_attempt` | landmark_ref, result (real/decoy/empty), player_id |
| `flag_found` | player_id, landmark_ref |
| `game_won` | winner_team_id, flag_carrier_player_id |
| `tag` | defender_id, raider_ids[], lat, lng |
| `intel_purchased` | team_id, intel_ref, cost |
| `curse_cast` | target_team_id, curse_ref, dice_total, expires_at |
| `curse_expired` | curse_id |
| `curse_breach_warned` | curse_id, player_id |
| `curse_breach_penalised` | curse_id, player_id, penalty |
| `challenge_completed` | team_id, challenge_ref, coins_earned |
| `coins_credited` | team_id, amount, reason |
| `coins_deducted` | team_id, amount, reason |
| `flag_hardened` | team_id, landmark_ref |
| `game_paused` | requested_by_team_id |
| `game_resumed` | — |

### `photos`
Photo submissions linked to cards or flag attempts. Stored in Supabase Storage; this table holds the URL, GPS, and timestamp extracted from EXIF (or supplied by the client as fallback).

### `active_curses`
Running curses with `expires_at`. pg_cron deletes expired rows and inserts `curse_expired` events every 30 s.

### `tags`
Immutable log of tag events. Source for the tiebreaker point calculation.

---

## 3. Realtime architecture

### 3.1 GPS presence channel — `game:{gameId}:positions`

Uses **Supabase Realtime Presence**. Ephemeral — nothing stored in DB.

Each phone calls `presence.track()` every 5 s via `useGPS.ts → usePresence.ts`:

```ts
channel.track({
  player_id: string,
  team_id: string,
  lat: number,
  lng: number,
  updated_at: number, // Date.now()
})
```

Every phone receives the full presence state (all connected players + their last position). This is the sole input to the **Tag button** and to the curse enforcement hooks.

Cadence / battery trade-off: 5 s interval, low-accuracy GPS mode between updates, high-accuracy burst only when Tag button computation is needed. Screen wake lock (`navigator.wakeLock.request('screen')`) required — show a banner if not granted.

### 3.2 Game state channel — `game:{gameId}:state`

Uses **Supabase Realtime postgres_changes** subscription on the `events` table filtered by `game_id`. Every INSERT to `events` is broadcast to all subscribers.

Client-side: `useGameState.ts` receives the new event, appends it to the Zustand store's `events` array, then re-derives game state. This keeps the store as a local projection of the event log.

On reconnect / page reload: client fetches full state snapshot via `GET /api/games/[id]/state` (returns teams, players, cards, active curses, all events), hydrates Zustand, then re-subscribes.

---

## 4. API routes

All routes are Next.js Route Handlers (`app/api/...`). All mutations follow the same pattern:

1. Parse + validate body with Zod.
2. Load game state from DB (or pass pre-fetched state).
3. Business rule validation (coins, geofence, timing, role).
4. Write to DB inside a Postgres transaction (events first, then derived tables).
5. Return result. Realtime broadcasts automatically via postgres_changes.

### Route catalogue

```
POST /api/games                          create a new game, return game code
POST /api/games/[id]/join                join with display_name + device_id, return player record
POST /api/games/[id]/ready               team signals setup complete; game starts when both ready
POST /api/games/[id]/flag-setup          assign candidate landmark roles (real/decoy/empty)
POST /api/games/[id]/attempt-flag        submit flag photo at a landmark
POST /api/games/[id]/tag                 tag raider(s) from presence snapshot
POST /api/games/[id]/buy-intel           purchase intel card; server computes + stores answer
POST /api/games/[id]/buy-curse           roll dice; server selects and activates curse
POST /api/games/[id]/submit-challenge    submit challenge proof; server validates + credits coins
POST /api/games/[id]/complete-run        flag carrier crosses home base geofence → triggers win
POST /api/games/[id]/harden-flag         spend 150 coins to upgrade own flag challenge
POST /api/games/[id]/pause               request weather pause (requires both teams to confirm)
POST /api/games/[id]/curse-breach        client self-reports a GPS curse breach
GET  /api/games/[id]/state               full state snapshot for reconnect
GET  /api/games/[id]/challenges          3 active challenges for the calling team
```

### Key route details

#### `POST /api/games/[id]/attempt-flag`

```
Validates:
  - player within 20 m of landmark (haversine, server-side)
  - game status is 'live'
  - player is in enemy half
  - photo uploaded to Storage, URL in request body
  - (optional) EXIF GPS within 50 m of landmark

Looks up landmark kind from DB (only visible to owner team via RLS,
  read server-side bypassing RLS with service role key).

If flag_real:
  - insert event: flag_found
  - update games.status = 'flag_found'
  - update players.flag_carrier = true for this player
  - return { result: 'real', message: 'Return to home base!' }

If flag_decoy:
  - expire all intel cards for this team (UPDATE cards SET state='expired'
    WHERE team_id = X AND kind = 'intel' AND state = 'in_hand')
  - insert event: flag_attempt { result: 'decoy' }
  - return { result: 'decoy' }

If flag_empty:
  - insert event: flag_attempt { result: 'empty' }
  - return { result: 'empty' }
```

#### `POST /api/games/[id]/tag`

```
Body: {
  defender_id: string,
  raider_ids: string[],           // adversaries client claims are within 5m
  defender_pos: {lat, lng},
  raider_positions: {player_id, lat, lng}[]  // from presence snapshot
}

Validates:
  - defender in own half (midline check on defender_pos)
  - defender NOT within 50m of any own candidate landmark for > 120 s
    (check events log for last camping_warning for this player)
  - For each raider: haversine(defender_pos, raider_pos) <= 10 m
    (10 m server-side vs 5 m client-side — GPS tolerance buffer)
  - raider is on the opposing team
  - game status is 'live'

For each valid tagged raider:
  - insert tag record
  - insert event: tag { defender_id, raider_id }
  - remove 1 random intel card from raider's team (state = 'expired')

Return: { tagged: raider_ids[] }
```

#### `POST /api/games/[id]/buy-intel`

```
Body: { player_id, intel_ref }

Validates:
  - team coin balance >= cost (from intel.json)
  - team has < 4 intel cards total (any state)
  - this intel_ref not already purchased by this team

Computes answer server-side (reads own landmarks table with service role):
  I1 (North/South): compare real flag landmark lat to midline lat
  I2 (East/West): compare real flag landmark lng to home base lng
  I3 (Eliminate One): pick random non-real, non-already-revealed candidate
  I4 (Eliminate Two): same, pick two
  I5 (Decoy Reveal): reveal a decoy landmark ref
  I6 (Hot/Cold): compute distance bracket from requesting team's centroid
  I7 (Surroundings): return the stored photo URL for the real flag landmark
         (requires team to have submitted a surroundings photo during setup)
  I8 (Direction): compute bearing from city center to real flag landmark
  I9 (Landmark Type): return the kind field from landmarks seed JSON

Writes:
  - deduct coins (events + teams.coins)
  - insert card (kind=intel, state=in_hand, payload={answer})
  - insert event: intel_purchased

Return: { card_id, answer }  ← full answer, visible to entire team
```

#### `POST /api/games/[id]/buy-curse`

```
Body: { player_id, num_dice }   (1–3)

Validates:
  - team coins >= 50 * num_dice
  - target team exists
  - no same-effect curse already active on target team

Server-side dice roll:
  total = sum of num_dice rolls of d6 (Math.random server-side)
  tier: 1–3 = minor, 4–8 = medium, 9+ = major
  select curse: weighted random from curses.json filtered by tier
    (weight towards curses not currently active on target)

Writes:
  - deduct coins
  - insert active_curses row (expires_at = now + duration)
  - insert event: curse_cast
  - insert card (kind=curse, state=active, payload=curse params)

Return: { curse, dice_total, expires_at }
```

#### `POST /api/games/[id]/complete-run`

```
Body: { player_id, pos: {lat, lng} }

Validates:
  - player.flag_carrier = true
  - haversine(pos, team home base coords) <= 30 m
  - game.status = 'flag_found'

Writes:
  - insert event: game_won
  - update games: status='finished', ended_at=now()

Return: { winner_team_id }
Broadcast triggers end-game screen on all phones.
```

---

## 5. Client-side architecture

### 5.1 Hooks

**`useGPS.ts`**
- Calls `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`.
- Requests `navigator.wakeLock.request('screen')` on mount.
- Throttles updates: only publishes if position changed by > 3 m or > 5 s elapsed.
- Exports: `{ lat, lng, accuracy, error, wakeActive }`.

**`usePresence.ts`**
- Subscribes to the Supabase Presence channel.
- Calls `channel.track(myPosition)` whenever GPS updates.
- Exports: `players: Record<player_id, {lat, lng, team_id, updated_at}>`.

**`useTagButton.ts`**
- Reads presence state + my GPS.
- Computes `isInOwnHalf(myPos, midline)`.
- Filters adversaries: opposing team, `haversine(me, them) <= 5`.
- Exports: `{ tagEnabled: bool, targetIds: string[] }`.
- The Tag button is just `disabled={!tagEnabled}`.

**`useGameState.ts`**
- Subscribes to `postgres_changes` on `events` table.
- On new event: appends to Zustand store, re-derives computed state.
- On mount: fetches full state snapshot if store is empty.

**`useCurseEnforcement.ts`**
- Reads active curses from store.
- For each `enforcement = 'A'` curse: computes constraint from GPS.
  - Slow Walk: compute speed from consecutive GPS readings (Δdist / Δtime).
  - Frozen: compute drift from starting position.
  - Buddy Up: read team-mates' positions from presence.
- On breach: calls `POST /api/games/[id]/curse-breach`.
- For `enforcement = 'B'` curses: manages photo prompt timers.
- Exports: `{ activeCurses, breachWarnings }`.

### 5.2 Zustand store (`store/gameStore.ts`)

```ts
type GameStore = {
  // identity
  gameId: string | null
  myPlayerId: string | null
  myTeamId: string | null

  // game state (derived from events)
  game: Game | null
  teams: Team[]
  players: Player[]
  myTeamCoins: number
  intelCards: Card[]          // my team's intel
  activeCurses: ActiveCurse[] // curses ON my team
  challenges: Challenge[]     // 3 active challenges for my team
  events: GameEvent[]         // full log

  // computed
  isFlagCarrier: boolean
  gamePhase: 'lobby' | 'setup' | 'live' | 'flag_found' | 'finished'
}
```

### 5.3 Page / component map

```
app/
  page.tsx                    Home: create or join game (enter code)
  game/[code]/
    page.tsx                  Phase router: renders correct view based on gamePhase
    setup/page.tsx            Flag assignment (select 5 landmarks, assign roles)
    map/page.tsx              Live map (Leaflet, dynamic import to avoid SSR)
    actions/page.tsx          Intel, curses, challenges tabs
    results/page.tsx          End screen + event timeline

components/
  map/
    GameMap.tsx               Dynamic-imported Leaflet map (client only)
    LandmarkPin.tsx           Pin component: icon differs by kind + reveal state
    PlayerMarker.tsx          GPS dot for each player in presence
  game/
    TagButton.tsx             Big button, enabled/disabled from useTagButton
    CurseTimer.tsx            Countdown + enforcement prompt for active curses
    IntelCard.tsx             Displays purchased intel answer
    ChallengeCard.tsx         Challenge task + photo upload
    CoinLedger.tsx            Current balance + recent transactions
  ui/                         Button, Card, Badge primitives
```

### 5.4 Geo utilities (`lib/geo/`)

- **`haversine.ts`** — distance in metres between two {lat, lng} pairs.
- **`midline.ts`** — the east/west dividing line is a vertical (constant longitude) through a point between UTAD and Mateus. Returns `'west' | 'east'` for a given position. Midline longitude stored in `games.config`.
- **`geofence.ts`** — `isWithinRadius(pos, center, radiusM): bool`. Used for landmark attempts (20 m), home base win trigger (30 m), camping check (50 m).

---

## 6. Key flows end-to-end

### 6.1 Tag

```
Defender phone (every 5 s):
  1. Receive presence update for all players
  2. useTagButton: filter adversaries in own half within 5 m
  3. Tag button becomes active (highlighted)

Defender taps Tag:
  4. POST /api/games/[id]/tag { defender_id, raider_ids, positions... }
  5. Server validates (10 m GPS tolerance), writes tag + events
  6. events INSERT → Realtime broadcast → all phones
  7. Tagged raiders: Zustand update shows "You were tagged — walk to [neutral]"
  8. Tagged raiders' intel: 1 random card set to 'expired'
```

### 6.2 Flag attempt → win

```
Raider at candidate landmark (within 20 m):
  1. Tap "Attempt Flag" → app reveals challenge task
  2. Raider completes task, takes photo
  3. Photo upload → Supabase Storage → URL returned
  4. POST /api/games/[id]/attempt-flag { landmark_ref, photo_url, pos }
  5. Server checks kind:
     a. real → game status = 'flag_found', raider.flag_carrier = true
              → INSERT events: flag_found
              → ALL phones receive event: "Team X found the flag!"
     b. decoy → intel cards expired, INSERT event
     c. empty → INSERT event, no penalty

Flag found → return home:
  6. Flag carrier's phone shows "RUN HOME" with distance to home base
  7. Other team notified — can attempt to tag on return journey
  8. When carrier within 30 m of home base:
     → POST /api/games/[id]/complete-run { pos }
     → Server: status = 'finished', INSERT game_won
     → All phones: game over screen
```

### 6.3 GPS curse (Slow Walk)

```
Defender buys curse:
  1. POST buy-curse → server rolls 1d6 = 2 (minor) → selects Slow Walk
  2. INSERT active_curses { curse_ref: 'curse.slow-walk', expires_at: now+5min }
  3. INSERT event: curse_cast

Target team phones receive postgres_changes event:
  4. Zustand: active curses updated → useCurseEnforcement activates
  5. Hook begins computing speed from consecutive GPS readings
  6. Speed > 3 km/h: visual warning shown
  7. Speed > 4 km/h:
     → POST curse-breach → server inserts breach event + deducts 10 coins

At expires_at:
  8. pg_cron fires → DELETE active_curses row → INSERT curse_expired event
  9. All phones: curse timer clears
```

### 6.4 Intel purchase

```
Any player taps "Buy Intel" → selects card type:
  1. POST buy-intel { intel_ref: 'intel.north-south' }
  2. Server reads real flag landmark (service role, bypassing RLS)
  3. Computes: is real flag lat > midline lat? → 'north'
  4. INSERT card { kind: 'intel', payload: { direction: 'north' }, state: 'in_hand' }
  5. Deduct coins
  6. Return: { answer: 'north' } → displayed on client for whole team
```

---

## 7. Auth & game joining

No email/password. Flow:

1. Phone visits `/`. Creates or joins a game with a **4-letter code** (e.g. `XKBR`).
2. Supabase anonymous auth: `supabase.auth.signInAnonymously()`. Each phone gets a session.
3. `device_id` (UUID stored in localStorage) is sent with join request, allowing reconnect.
4. RLS policies use `auth.uid()` or `device_id` to restrict reads:
   - Own team's landmark kinds: visible.
   - Enemy team's landmark kinds: hidden (`kind` returned as `null`).
   - Own intel card answers: visible.
   - Enemy intel cards: not visible.

---

## 8. GPS accuracy and practical constraints

| Concern | Mitigation |
|---|---|
| Urban GPS drift ±10–20 m | Tag server-side threshold: 10 m (vs 5 m displayed to player) |
| Screen-off kills GPS | Wake Lock API; banner if not supported |
| Battery drain | 5 s presence cadence; high-accuracy only during active curse |
| Indoor GPS loss | Presence `updated_at` staleness check; stale > 30 s → shown as offline |
| Narrow streets (Pelourinho area) | Geofence radii tuned: 20 m for attempts, 30 m for home win, 50 m for camping |

---

## 9. What is NOT yet built (implementation backlog)

In priority order for a playable v1:

1. **Migration 0002** — add `game_code`, `flag_carrier`, remove `captain` role, add `setup` + `flag_found` statuses.
2. **Game create/join flow** — `POST /api/games`, `POST /api/games/[id]/join`, landing page UI.
3. **Flag setup UI** — team selects 5 candidate landmarks, assigns roles, confirms ready.
4. **Live game view** — tab shell (Map / Actions / Status), real-time data wired up.
5. **Tag button** — `useGPS` + `usePresence` + `useTagButton` + `TagButton.tsx`.
6. **`POST /api/games/[id]/tag`** route with full validation.
7. **Flag attempt** — geofence check, challenge reveal, photo upload, `attempt-flag` route.
8. **Win condition** — `complete-run` route + "RUN HOME" screen.
9. **Buy intel** — all 9 intel answer computations + UI.
10. **Buy curse** — dice roll, curse selection, `active_curses` row, push to target.
11. **Curse enforcement** — `useCurseEnforcement`, photo prompt timers, GPS speed check.
12. **Challenges** — 3-at-a-time rotation, submission, coin credit.
13. **Results / timeline** — end screen reading events log.
14. **Camping enforcement** — server-side check in tag route + client-side warning.
15. **RLS policies** — landmark kind hidden, intel answers scoped to team.
16. **pg_cron setup** — curse expiry job in Supabase dashboard.
17. **I7 intel (Surroundings photo)** — teams submit surroundings photo during setup.

---

## 10. Infrastructure

- **Hosting:** Vercel (free tier, hobby plan covers this scale)
- **DB / Realtime / Storage / Auth:** Supabase free tier (500 MB DB, 1 GB Storage, 200 concurrent Realtime connections — more than enough for 8 players)
- **DNS / HTTPS:** Vercel default domain; custom domain optional
- **pg_cron:** available on Supabase Pro+ or via a scheduled Supabase Edge Function on free tier

One `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # server-only, for RLS bypass on flag kind lookup
```
