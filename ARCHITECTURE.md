# Jet Lag: Vila Real — Technical Architecture

## 1. System overview

```
┌──────────────────────────────────────────────────────────────────┐
│                   PLAYER PHONES  (PWA, installed)                │
│                                                                  │
│  useGPS (watchPosition)          useTagButton (distance calc)    │
│  usePresence (publish GPS)       useCurseEnforcement (self-mon.) │
│  useLiveGameRealtime (reconcile) Leaflet map                     │
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
│  PostgreSQL (append-only events + materialized state)  │
│  Storage    (photo uploads for flag/challenge/curse)   │
│  Client poll (curse expiry fallback while game active) │
│  RLS        (server-only writes; trusted-friends reads)│
└────────────────────────────────────────────────────────┘
```

One Next.js app deployed to Vercel. One Supabase project. No separate backend service.

---

## 2. Database schema

Full DDL lives in `supabase/migrations/`. Below is the semantic contract each table holds.

### `games`
One row per game session.
- `status`: `lobby | setup | live | flag_found | paused | finished`
  `setup` is added vs the migration (teams at home base assigning flags).  
  `flag_found` is added for the chase phase after flag is photographed.
- `config`: jsonb bag for per-game settings (map bounds, time limit, etc.)
- `code`: short human-readable join code (e.g. `"XKBR"`) — add in migration 0002.

### `teams`
Two rows per game (West / East).
- `home_landmark_id`: references the seed landmark ref (e.g. `"landmark.miradouro-vila-velha"`).
- `coins`: **mutable counter**. The events table is append-only; coins are the one exception — updated by API handlers as a derived materialization to avoid re-scanning the entire event log on every request. Kept consistent by always writing an event first, then updating this column in the same transaction.

### `players`
One row per phone in the game.
- `role`: `player` only (captain role removed).
- `device_id`: localStorage UUID, used to reconnect to the same player record after page reload.
- `flag_carrier`: boolean (added in migration 0002) — true for the player who photographed the real flag.
- `respawning`, `respawn_target_ref`, `respawn_arrived`: durable two-stage respawn state. A tagged/decoyed player must reach the server-assigned nearest neutral, then move 45 m away before the state clears.

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
| `flag_hardened` | team_id (the real landmark ref is deliberately omitted) |
| `game_paused` | requested_by_team_id |
| `game_resumed` | — |

### Photo proof Storage
Flag attempts, challenge submissions, private flag-surroundings intel, and curse-compliance proofs use dedicated Supabase Storage buckets. Mutation routes validate that the object exists, is an image no larger than 10 MB, and is stored under the expected game/player path. Public event payloads contain only the minimum reference needed for the appropriate team-scoped UI; private surroundings object paths are never persisted in readable card payloads.

### `active_curses`
Running curses with `started_at`, `expires_at`, enforcement parameters, and durable per-curse state where required. A 20-second client poll calls the atomic expiry route and inserts `curse_expired` events; production can replace this fallback with pg_cron.

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

Every phone receives the presence state (connected players + their latest position). Clients prune entries older than 30 seconds. Tag requests include the relevant snapshot, but the server independently validates player identity, team, GPS freshness, defense-zone/raider eligibility, and the 10 m tolerance.

Cadence / battery trade-off: 5 s interval, low-accuracy GPS mode between updates, high-accuracy burst only when Tag button computation is needed. Screen wake lock (`navigator.wakeLock.request('screen')`) required — show a banner if not granted.

### 3.2 Game state channel — `game:{gameId}:state`

Uses **Supabase Realtime postgres_changes** subscription on the `events` table filtered by `game_id`. Every INSERT to `events` is broadcast to all subscribers.

Client-side, `useLiveGameRealtime.ts` reconciles events plus mutable games/teams/players/cards/curses rows into the Zustand store. Hidden/filter-sensitive state also has explicit event reconciliation.

On reconnect, browser foregrounding, network restoration, or page reload, the client fetches a curated `GET /api/games/[id]/live-state` snapshot, hydrates Zustand, and re-subscribes. This recovers events missed while a mobile browser slept without a force refresh.

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
POST /api/games/[id]/switch-team         switch lobby team (maximum 4 players)
POST /api/games/[id]/start               host starts only with equal 1–4-player teams
POST /api/games/[id]/ready               team signals setup complete; game starts when both ready
POST /api/games/[id]/flag-setup          assign candidate landmark roles (real/decoy/empty)
POST /api/games/[id]/attempt-start       open a landmark mini-challenge / reaction window
POST /api/games/[id]/attempt-flag        submit flag photo at a landmark
POST /api/games/[id]/tag                 tag raider(s) from presence snapshot
POST /api/games/[id]/respawn-clear       confirm assigned-neutral arrival, then 45 m departure
POST /api/games/[id]/buy-intel           purchase intel card; server computes + stores answer
POST /api/games/[id]/buy-curse           roll dice; server selects and activates curse
POST /api/games/[id]/place-curse         place a hidden proximity curse
POST /api/games/[id]/trigger-placed-curse atomically reveal/activate a placed curse
POST /api/games/[id]/submit-challenge    submit challenge proof for opposing-team review
POST /api/games/[id]/submit-curse-proof server-upload private [B] compliance photo + receipt
POST /api/games/[id]/accept-challenge    opposing team accepts submitted proof
POST /api/games/[id]/reject-challenge    opposing team rejects submitted proof
POST /api/games/[id]/resolve-challenge-reviews auto-accept proofs pending for 120 s
POST /api/games/[id]/complete-run        flag carrier crosses home base geofence → triggers win
POST /api/games/[id]/harden-flag         spend 150 coins to upgrade own flag challenge
POST /api/games/[id]/pause               two-team weather pause/resume proposal and confirmation
POST /api/games/[id]/extend-curse        durable Frozen anchor/violation accounting
POST /api/games/[id]/complete-pilgrimage geofence-complete the Pilgrimage action lock
POST /api/games/[id]/expire-curses       atomically expire elapsed curses
POST /api/games/[id]/time-tick           award authoritative elapsed 30-minute +20 bonuses, capped by configured duration
POST /api/games/[id]/end-by-timeout      settle due bonuses, then atomically persist points/tiebreak/coin-flip result
GET  /api/games/[id]/live-state          curated reconnect snapshot
GET  /api/games/[id]/challenges          3 active challenges for the calling team
```

### Key route details

#### `POST /api/games/[id]/attempt-flag`

```
Validates:
  - current player GPS within 28 m of landmark (12 m when hardened)
  - game status is 'live' and the first-30-minute protection window elapsed
  - player is not respawning and team actions are not curse/weather locked
  - the named image exists in the expected Storage bucket/game/player path
  - that team/landmark is not in its 15-minute retry lockout

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
  - assign nearest-neutral two-stage respawn and 15-minute landmark lockout
  - return { result: 'decoy' }

If flag_empty:
  - insert event: flag_attempt { result: 'empty' }
  - apply 15-minute landmark lockout
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
  - defender is inside the union of 200 m circles around their own candidates
  - defender NOT within 50m of any own candidate landmark for > 120 s
    (check events log for last camping_warning for this player)
  - For each raider: haversine(defender_pos, raider_pos) <= 10 m
    (10 m server-side vs 5 m client-side — GPS tolerance buffer)
  - raider is on the opposing team
  - raider is outside their own 200 m defense-zone union OR within 50 m of one of the defender's selected candidates
  - both GPS positions are fresh and belong to the claimed players
  - game status is 'live'

For each valid tagged raider:
  - insert tag record
  - insert event: tag { defender_id, raider_id }
  - persist the nearest neutral target and two-stage respawn state

After the batch succeeds, fine the raiding team TAG_COIN_PENALTY (40) coins for the
whole Tag action — once per tap, not per raider — clamped at their balance so it can
never go negative, and recorded as `coins_deducted { reason: 'tag_penalty' }`. Intel
cards are NOT touched (migration 0058; the old rule expired one random card, but
`/live-state` had already sent the client that card's answer, so it confiscated a map
overlay rather than the knowledge).

Return: { tagged: raider_ids[], coins_drained }
```

#### `POST /api/games/[id]/buy-intel`

```
Body: { player_id, intel_ref }

Validates:
  - team coin balance >= cost (from intel.json)
  - team has < 4 intel cards total (any state)
  - this intel_ref not already purchased by this team

Computes answer server-side (reads own landmarks table with service role):
  I1 (North/South): compare real flag latitude to the fixed defending-side pool pivot (West 41.2954885 / East 41.29820795); persist it for overlays
  I2 (Eliminate One): pick random non-real, non-already-revealed candidate
  I3 (Eliminate Two): same, pick two
  I4 (Decoy Reveal): reveal a decoy landmark ref
  I5 (Hot/Cold): compute and persist an immutable purchase-time bracket + buy position; never persist or return the target coordinates
  I6 (Surroundings): sign the private setup photo for a short-lived display URL
  I7 (Direction): compute bearing from the canonical play-area centre

  The former I2 (East/West) is REMOVED from data/intel.json, so it has no
  compute path and the ref is rejected as `invalid_intel_ref`. It eliminated
  exactly one candidate 6 times in 7 for 30 coins and narrowed 4 of 5 when a
  defender hid on its own home base; neither available pivot was sound — see
  RULEBOOK §11 and SIM_EVALUATION P3a. Cards held by pre-removal games are
  still decoded by narrowing.ts / overlays.ts / IntelCardDisplay.tsx.

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
  - exclude disabled entries, same-effect active curses, Coin Drain at zero target coins, and Intel Loss with no target intel; if none are eligible, spend nothing

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
- Requires a fresh local fix inside the union of the team's 200 m candidate zones.
- Filters fresh adversaries within 5 m who are outside their own defense-zone union or within 50 m of one of the local team's candidates.
- Exports: `{ tagEnabled: bool, targetIds: string[] }`.
- The Tag button is just `disabled={!tagEnabled}`.

**`useLiveGameRealtime.ts`**
- Subscribes to the relevant mutable tables and append-only events.
- Merges changes into Zustand, with event-based reconciliation for hidden or filtered deletes.
- Refetches `live-state` after subscription rejoin, network restoration, or foregrounding.

**`useCurseEnforcement.ts`**
- Reads active curses from store.
- For each `enforcement = 'A'` curse: computes the documented live constraint from GPS.
  - Slow Walk: compute speed from consecutive GPS readings (Δdist / Δtime).
  - Frozen: compute drift from starting position.
  - Buddy Up: read team-mates' positions from presence.
- Frozen reports durable per-player anchors and overlap-safe violation intervals; Pilgrimage is a server-enforced action lock until its geofence completes. Other movement constraints produce visible compliance readouts rather than automatic GPS-noise penalties.
- For `enforcement = 'B'` curses: manages timed private proof-photo prompts and acknowledgements.
- Exports action locks and per-curse prompts/readouts.

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
  gamePhase: 'lobby' | 'setup' | 'live' | 'flag_found' | 'paused' | 'finished'
}
```

### 5.3 Page / component map

```
app/
  page.tsx                    Home: create or join game (enter code)
  game/[code]/
    page.tsx                  Phase router: renders correct view based on gamePhase
    Lobby.tsx                 Equal-team lobby, ready/start controls
    Setup.tsx                 Map-first flag assignment and surroundings photo
    Live.tsx                  Map / Actions / Status tabs and results overlay

components/
  map/
    GameMap.tsx               Dynamic-imported Leaflet map (client only)
    SetupMap.tsx              Setup role cycling, labels, list fallback
  game/
    TagButton.tsx             Big button, enabled/disabled from useTagButton
    ActiveCursesBanner.tsx    Timers, prompts, movement readouts, proof state
    IntelCardDisplay.tsx      Displays purchased intel answer
    ChallengesPanel.tsx       Challenge task, upload, peer review
    WeatherPausePanel.tsx     Two-team pause/resume voting
  ui/                         Button, Card, Badge primitives
```

### 5.4 Geo utilities (`lib/geo/`)

- **`haversine.ts`** — distance in metres between two {lat, lng} pairs.
- **`zones.ts`** — defense-zone membership for the union of 200 m candidate circles.
- **`playArea.ts`** — canonical 1.5 km play disk, the legacy I1 fallback latitude, and I7 Direction bearing origin. New I1 cards persist the fixed defending-side pool pivot in their payload.
- **`nearestNeutral.ts`** — server-assigned nearest respawn target.
- **`polyline.ts`** — point-to-route distance for Detour streets.

---

## 6. Key flows end-to-end

### 6.1 Tag

```
Defender phone (every 5 s):
  1. Receive presence update for all players
  2. useTagButton: require own defense-zone eligibility, then filter fresh enemy raiders within 5 m
  3. Tag button becomes active (highlighted)

Defender taps Tag:
  4. POST /api/games/[id]/tag { defender_id, raider_ids, positions... }
  5. Server validates (10 m GPS tolerance), writes tag + events
  6. events INSERT → Realtime broadcast → all phones
  7. Tagged raiders: Zustand update shows the exact assigned nearest neutral
  8. Raiding team's intel: at most 1 random card set to 'expired' for the whole tap
  9. Raider confirms arrival, remains immune, walks 45 m away, then confirms departure to clear respawn
```

### 6.2 Flag attempt → win

```
Raider at candidate landmark after the 30-minute protection window (within 28 m, or 12 m if hardened):
  1. Tap "Attempt Flag" → app reveals challenge task
  2. Raider completes task, takes photo
  3. Photo upload → Supabase Storage → URL returned
  4. POST /api/games/[id]/attempt-flag { landmark_ref, photo_url, pos }
  5. Server checks kind:
     a. real → game status = 'flag_found', raider.flag_carrier = true
              → INSERT events: flag_found
              → ALL phones receive event: "Team X found the flag!"
     b. decoy → intel cards expired, 15-minute lock, two-stage respawn
     c. empty → 15-minute landmark lock, no inventory penalty

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
  6. Speed over the threshold: visual warning shown (honor enforcement; GPS noise is not auto-fined)

At expires_at:
  8. client fallback poll (or future pg_cron) calls atomic expiry → DELETE active_curses row → INSERT curse_expired event
  9. All phones: curse timer clears
```

### 6.4 Intel purchase

```
Any player taps "Buy Intel" → selects card type:
  1. POST buy-intel { intel_ref: 'intel.north-south' }
  2. Server reads real flag landmark (service role, bypassing RLS)
  3. Selects the fixed full-pool pivot for the defending side
  4. Compares real-flag latitude to that pivot → 'north' or 'south'
  5. INSERT card { kind: 'intel', payload: { direction: 'north', pivot_lat }, state: 'in_hand' }
  6. Deduct coins
  7. Return the answer + pivot → displayed consistently for the whole team and map overlay
```

---

## 7. Identity, joining, and v1 security posture

No email/password is required. A phone creates or joins with a **4-letter code**, and a localStorage UUID (`device_id`) reconnects it to the same player. All mutations authenticate that device/player pair in server routes and use the service-role client for writes; anon-key clients cannot mutate tables directly.

The curated setup/live/observer APIs redact enemy flag state and private I7 paths. However, v1 keeps broad anonymous SELECT policies so `postgres_changes` Realtime works without per-user sessions. A malicious participant can bypass the curated API and inspect some non-I7 rows directly. The v1.1 hardening path is anonymous Supabase Auth, `auth_user_id` on players, team-scoped SELECT policies, and server-curated per-team Broadcast events. Until that work lands, this is a trusted friend-game security model rather than protection against a hostile client.

---

## 8. GPS accuracy and practical constraints

| Concern | Mitigation |
|---|---|
| Urban GPS drift ±10–20 m | Tag server-side threshold: 10 m (vs 5 m displayed to player) |
| Screen-off kills GPS | Wake Lock API; banner if not supported |
| Battery drain | 5 s presence cadence; high-accuracy only during active curse |
| Indoor GPS loss | Presence `updated_at` staleness check; stale > 30 s → shown as offline |
| Narrow streets / urban drift | Attempt radii tuned to 28 m normally and 12 m when hardened; home win 30 m; camping 50 m |

---

## 9. Implementation and verification status

The playable v1 flow is implemented end to end: equal 1–4-player teams; map-first secret setup with a private I7 surroundings image; live GPS/presence; tagging and two-stage respawn; structured flag attempts; intel; curses and placed curses; peer-reviewed challenges; chat; weather pause/resume; timeout scoring; flag-carrier return; observer/results; push opt-in; and reconnect recovery.

Database-side state transitions and economy mutations are serialized through Postgres functions so retries and simultaneous team-mate actions cannot double-spend, double-award, overfill a roster, or produce duplicate phase/win events. `tools/sim/` contains strict browser, API-concurrency, terminal-outcome, realtime-recovery, and 1v1–4v4 full-game scenarios used for release verification.

Remaining deployment/field work is operational rather than a missing game flow:

1. Apply every checked-in migration to the hosted Supabase project.
2. Configure the matching public/private VAPID keys and subject for background Web Push.
3. Move curse expiry from the client fallback poll to a production scheduler if games must progress while every client is offline.
4. Complete the documented v1.1 anonymous-auth/team-scoped SELECT-policy hardening before treating participants as adversarial clients.
5. Field-check broad landmark centroids and real-device GPS/push behavior in Vila Real.

---

## 10. Infrastructure

- **Hosting:** Vercel (free tier, hobby plan covers this scale)
- **DB / Realtime / Storage / Auth:** Supabase free tier (500 MB DB, 1 GB Storage, 200 concurrent Realtime connections — more than enough for 8 players)
- **DNS / HTTPS:** Vercel default domain; custom domain optional
- **Curse expiry:** the client poll is sufficient while a game has an active browser; use a production scheduler if expiry must continue with all clients offline.

One `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # server-only, for RLS bypass on flag kind lookup
```
