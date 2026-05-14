// Shared types for Jet Lag: Vila Real.
// Mirrors the DB schema in supabase/migrations/ and the API contract used by
// the lobby flow (step 1). Extend as later steps land.

// ---------------------------------------------------------------------------
// Enums (match Postgres CHECK constraints)
// ---------------------------------------------------------------------------

export type GameStatus =
  | 'lobby'
  | 'setup'
  | 'live'
  | 'flag_found'
  | 'paused'
  | 'finished'

export type TeamSide = 'west' | 'east'

export type PlayerRole = 'player'

export type LandmarkKind =
  | 'flag_real'
  | 'flag_decoy'
  | 'flag_empty'
  | 'home'
  | 'neutral'

export type CardKind = 'challenge' | 'curse' | 'intel'

export type CardState =
  | 'available'
  | 'in_hand'
  | 'active'
  | 'consumed'
  | 'expired'

export type PhotoKind = 'flag_attempt' | 'challenge' | 'curse_proof' | 'other'

// ---------------------------------------------------------------------------
// DB row types (snake_case to match Postgres column names directly)
// ---------------------------------------------------------------------------

export interface GameConfig {
  duration_minutes?: number
  starting_coins?: number
}

export interface Game {
  id: string
  code: string
  status: GameStatus
  config: GameConfig
  started_at: string | null
  ended_at: string | null
  created_at: string
}

export interface Team {
  id: string
  game_id: string
  name: string
  side: TeamSide
  home_landmark_id: string | null
  coins: number
  created_at: string
}

export interface Player {
  id: string
  team_id: string
  display_name: string
  role: PlayerRole
  device_id: string
  flag_carrier: boolean
  ready: boolean
  is_host: boolean
  respawning: boolean
  created_at: string
}

// ---------------------------------------------------------------------------
// Lobby API contract (step 1)
// ---------------------------------------------------------------------------

// POST /api/games
// Creates a new game in 'lobby' status. Creates two empty teams (west + east)
// and adds the caller as the first player on `preferred_side` (or 'west' by default).
export interface CreateGameRequest {
  display_name: string
  device_id: string
  preferred_side?: TeamSide
}
export interface CreateGameResponse {
  game: Game
  teams: Team[]
  players: Player[]
  me: Player
}

// GET /api/games/by-code/[code]
// Returns the full lobby snapshot. Used by /game/join lookup and /game/[code] hydration.
export interface GameByCodeResponse {
  game: Game
  teams: Team[]
  players: Player[]
}

// POST /api/games/[id]/join
// Adds the caller to one of the two teams in `lobby` status. Idempotent on device_id —
// if a player with this device_id already exists in this game, returns the existing one.
export interface JoinGameRequest {
  display_name: string
  device_id: string
  preferred_side?: TeamSide
}
export interface JoinGameResponse {
  game: Game
  teams: Team[]
  players: Player[]
  me: Player
}

// POST /api/games/[id]/switch-team
// Swap to the other team. Only allowed while game.status='lobby' and player not ready.
export interface SwitchTeamRequest {
  player_id: string
  device_id: string
}
export interface SwitchTeamResponse {
  player: Player
  team: Team
}

// POST /api/games/[id]/ready
// Toggle ready flag on a player. When all players (>=1 per team) are ready,
// the next call to /start can transition the game.
export interface SetReadyRequest {
  player_id: string
  device_id: string
  ready: boolean
}
export interface SetReadyResponse {
  player: Player
  all_ready: boolean
}

// POST /api/games/[id]/start
// Server-validated transition: lobby -> setup. Requires both teams have >=1 player
// and all players ready. Idempotent: returns current status if already past lobby.
export interface StartGameRequest {
  device_id: string
}
export interface StartGameResponse {
  game: Game
}

// ---------------------------------------------------------------------------
// Landmark types (DB row + seed catalog + step 2 flag-setup contract)
// ---------------------------------------------------------------------------

// Per-game landmark row (in landmarks table).
export interface Landmark {
  id: string
  game_id: string
  ref: string
  lat: number
  lng: number
  team_id: string | null
  kind: LandmarkKind
  hardened: boolean
  created_at: string
}

// Entry from data/landmarks.json (the seed catalog).
export interface SeedLandmark {
  id: string
  name: string
  lat: number
  lng: number
  team_pool: TeamSide | 'neutral'
  kind: string
  approximate: boolean
  source: string
  notes?: string
}

export type FlagRole = 'real' | 'decoy' | 'empty'

export interface FlagAssignment {
  landmark_ref: string
  role: FlagRole
}

// POST /api/games/[id]/flag-setup
// Submit the calling player's team flag assignment. Must be exactly:
// 1 real, 2 decoys, 2 empty (5 landmarks total, all from the team's pool).
// First submit per team wins; subsequent submits return 409.
// When both teams have submitted, the server transitions game.status='live'
// and sets games.started_at = now().
export interface FlagSetupRequest {
  device_id: string
  assignments: FlagAssignment[]
}
export interface FlagSetupResponse {
  game: Game
  my_landmarks: Landmark[]
  both_teams_done: boolean
}

// GET /api/games/[id]/setup-state?device_id=...
// Role-aware snapshot for the setup phase. Returns the caller's own team's
// pool and current assignment, plus a boolean for whether the other team has
// finished. Does NOT expose the other team's landmarks or kinds.
export interface SetupStateResponse {
  game: Game
  my_team: Team
  my_pool: SeedLandmark[]
  my_landmarks: Landmark[]
  other_team_id: string
  other_team_done: boolean
}

// POST /api/games/[id]/remove-player
// Remove a player from a game in `lobby` status.
//   - Self-removal: target_player_id === your own player_id, always allowed
//   - Kick: requester must be host (is_host=true)
// If the removed player was the host and others remain, host auto-transfers
// to the oldest other player. If the removed player was the last one in the
// game, the game row is deleted.
export interface RemovePlayerRequest {
  target_player_id: string
  device_id: string
}
export interface RemovePlayerResponse {
  removed_player_id: string
  game_deleted: boolean
  new_host_id: string | null
}

// ---------------------------------------------------------------------------
// Live phase types (step 3)
// ---------------------------------------------------------------------------

// Enemy landmark: kind and hardened are intentionally omitted (secret state).
// Ref + coords are public so raiders can navigate to them.
export interface EnemyLandmark {
  id: string
  ref: string
  lat: number
  lng: number
  team_id: string
}

export interface ActiveCurse {
  id: string
  game_id: string
  target_team_id: string
  curse_ref: string
  started_at: string
  expires_at: string | null
  params: Record<string, unknown>
  created_at: string
}

export interface Card {
  id: string
  game_id: string
  team_id: string
  kind: CardKind
  ref: string
  state: CardState
  payload: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface GameEvent {
  id: string
  game_id: string
  type: string
  actor_player_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

// GET /api/games/[id]/live-state?device_id=...
// Role-aware snapshot for live phase. Enemy landmarks are stripped of kind/hardened.
// Players list is full (display_name visible — already known from lobby).
export interface LiveStateResponse {
  game: Game
  my_team: Team
  teams: Team[]
  players: Player[]
  my_team_landmarks: Landmark[]
  enemy_landmarks: EnemyLandmark[]
  active_curses: ActiveCurse[]    // curses targeting MY team
  my_cards: Card[]                 // my team's cards (intel + curses cast + challenges)
  recent_events: GameEvent[]       // last 50 events for timeline
}

// Browser GPS reading (used by useGPS, broadcast via Presence).
export interface GpsPosition {
  lat: number
  lng: number
  accuracy: number       // metres
  updated_at: number     // Date.now() ms
}

// Payload published to the Presence channel for a player.
export interface PresencePayload extends GpsPosition {
  player_id: string
  team_id: string
}

// ---------------------------------------------------------------------------
// Tag / Respawn API contract (step 4)
// ---------------------------------------------------------------------------

// POST /api/games/[id]/tag
// Body: the tagger's own player + GPS, plus the targets the client believes
// are within 5 m (with each target's last known position from the Presence
// snapshot). Server re-validates with a 10 m GPS tolerance and checks
// defense-zone membership for the tagger.
export interface TagRequest {
  device_id: string
  tagger_player_id: string
  tagger_pos: GpsPosition
  targets: Array<{
    player_id: string
    pos: GpsPosition
  }>
}

export interface TagResponse {
  tagged_player_ids: string[]
  rejected: Array<{ player_id: string; reason: string }>
}

// POST /api/games/[id]/respawn-clear
// Tagged player calls this when they reach a neutral landmark. Server checks
// the position is within 30 m of any neutral landmark from the seed catalog,
// then clears the player's `respawning` flag.
export interface RespawnClearRequest {
  device_id: string
  player_id: string
  pos: GpsPosition
}

export interface RespawnClearResponse {
  player: Player
  cleared_at_neutral_ref: string
}

// ---------------------------------------------------------------------------
// Flag attempt / win / harden contract (step 5)
// ---------------------------------------------------------------------------

export type FlagAttemptResult = 'real' | 'decoy' | 'empty'

// POST /api/games/[id]/attempt-flag
// Player attempts an enemy candidate landmark. Server validates:
//  - Game.status === 'live' (no double-attempts during flag_found)
//  - Player exists, device_id matches, not respawning
//  - haversine(pos, landmark) <= 20 m (server tolerance with 30 m client buffer)
//  - landmark.team_id is the OPPOSING team
// Result:
//  - real:  player.flag_carrier=true; game.status='flag_found'
//  - decoy: all of caller's team's in_hand intel cards → 'expired'
//  - empty: no penalty
// Event: 'flag_attempt' with payload { landmark_ref, result, team_id }.
export interface AttemptFlagRequest {
  device_id: string
  player_id: string
  landmark_ref: string
  pos: GpsPosition
  photo_url?: string
}

export interface AttemptFlagResponse {
  result: FlagAttemptResult
  message: string
  game: Game
}

// POST /api/games/[id]/complete-run
// Flag carrier must be within 30 m of their team's home base AND game.status='flag_found'.
// Triggers status='finished' + game_won event with winner_team_id.
export interface CompleteRunRequest {
  device_id: string
  player_id: string
  pos: GpsPosition
}

export interface CompleteRunResponse {
  game: Game
  winner_team_id: string
}

// POST /api/games/[id]/harden-flag
// Caller's team spends 150 coins to mark a landmark `hardened=true`. Once per
// team per game. The landmark must belong to caller's team. Hardened state is
// kept hidden from the enemy (no realtime publication of landmark updates).
export interface HardenFlagRequest {
  device_id: string
  player_id: string
  landmark_ref: string
}

export interface HardenFlagResponse {
  landmark_ref: string
  team_coins: number
}

// ---------------------------------------------------------------------------
// Intel purchase contract (step 7)
// ---------------------------------------------------------------------------

// All intel answer shapes share a common envelope; the discriminator is the
// `intel_ref` string (matches data/intel.json ids).
export type IntelAnswer =
  | { intel_ref: 'intel.north-south'; direction: 'north' | 'south' }
  | { intel_ref: 'intel.east-west'; direction: 'east' | 'west' }
  | {
      intel_ref: 'intel.eliminate-one'
      not_real: { ref: string; name: string }
    }
  | {
      intel_ref: 'intel.eliminate-two'
      not_real: Array<{ ref: string; name: string }>
    }
  | {
      intel_ref: 'intel.decoy-reveal'
      decoy: { ref: string; name: string }
    }
  | {
      intel_ref: 'intel.hot-cold'
      bucket: 'under_200m' | 'under_500m' | 'under_1km' | 'over_1km'
      // The position the player was standing at when they bought this intel.
      // The bucket is a distance bracket from this point to the real flag.
      // Stored in payload so the client can compute "ruled out" enemies later.
      buy_position: { lat: number; lng: number }
    }
  | {
      intel_ref: 'intel.surroundings'
      text: string
    }
  | {
      intel_ref: 'intel.direction'
      bearing: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
    }
  | { intel_ref: 'intel.landmark-type'; category: string }

// POST /api/games/[id]/buy-intel
// Body validation:
//  - intel_ref must exist in data/intel.json
//  - player_pos is required only when intel_ref === 'intel.hot-cold'
// Server validation:
//  - game.status in ('live', 'flag_found')
//  - caller exists, device_id matches
//  - team has bought fewer than 4 intel cards total (any state)
//  - team has not already bought this specific intel_ref
//  - team coins >= intel cost (from intel.json)
// Side effects:
//  - Insert event `coins_deducted { team_id, amount, reason: 'buy_intel' }`
//  - UPDATE teams.coins -= cost
//  - INSERT card { kind: 'intel', ref, state: 'in_hand', payload: answer }
//  - Insert event `intel_purchased { team_id, intel_ref, cost }` (does NOT
//    include the answer payload, which is the team's private state)
export interface BuyIntelRequest {
  device_id: string
  player_id: string
  intel_ref: string
  player_pos?: GpsPosition
}

export interface BuyIntelResponse {
  card: Card
  answer: IntelAnswer
  team_coins: number
}

// ---------------------------------------------------------------------------
// Curse purchase + expiry contract (step 8)
// ---------------------------------------------------------------------------

export type CurseTier = 'minor' | 'medium' | 'major'
export type CurseEnforcement = 'A' | 'B' | 'C' | 'L'

// POST /api/games/[id]/buy-curse
// Buyer spends `50 * num_dice` coins from their own team to roll a sum of
// num_dice d6s. The sum determines the tier (1–3 minor, 4–8 medium, 9+ major);
// the server picks a random curse from that tier that is NOT currently
// already active on the enemy team. Ledger effects ([L] curses) apply
// immediately to the enemy team.
export interface BuyCurseRequest {
  device_id: string
  player_id: string
  num_dice: 1 | 2 | 3
}

export interface BuyCurseResponse {
  curse_ref: string
  curse_name: string
  tier: CurseTier
  enforcement: CurseEnforcement
  description: string
  dice_total: number
  dice_rolls: number[]
  duration_minutes: number | null
  expires_at: string | null
  // Optional, present for [L] one-shots so the UI can summarise effects:
  ledger_effect?:
    | { kind: 'coin_drain'; amount: number; target_team_coins: number }
    | { kind: 'intel_loss'; expired_card_ref: string | null }
    | { kind: 'full_stop' }
    | { kind: 'check_in' }
  // The buyer's team coins after the dice cost is deducted.
  buyer_team_coins: number
}

// POST /api/games/[id]/expire-curses
// Idempotent housekeeping. Finds active_curses rows where expires_at < now()
// for this game, deletes them, and emits a `curse_expired` event per row.
// Any player in the game can poke it; it's safe to call frequently.
export interface ExpireCursesRequest {
  device_id: string
}

export interface ExpireCursesResponse {
  expired_curse_ids: string[]
}

// ---------------------------------------------------------------------------
// Challenges contract (step 9)
// ---------------------------------------------------------------------------

export interface ChallengeDefinition {
  id: string
  location_name: string
  // Some challenges (e.g. the pastel de nata quote) are landmark-agnostic;
  // those carry `landmark_ref: null` and skip the geofence check on submit.
  landmark_ref: string | null
  task: string
  reward_coins: number
  photo_required: boolean
  notes?: string
}

// GET /api/games/[id]/challenges?device_id=...
// Returns the 3 currently-active challenges for the caller's team. If the
// team has fewer than 3 in `available` state, the server draws random
// replacements from the pool of unused challenges.
export interface GetChallengesResponse {
  active: ChallengeDefinition[]
}

// POST /api/games/[id]/submit-challenge
// Marks a challenge as `consumed`, credits the team with reward_coins (+30
// first-blood bonus if applicable), and draws a replacement challenge.
//
// Validation:
//  - Game.status in ('live', 'flag_found')
//  - Player not respawning (challenges are field work)
//  - Challenge is currently `available` for the calling team
//  - If challenge has a landmark_ref: position required, must be within 100 m
//    of that landmark's seed coords. Else geofence is skipped.
export interface SubmitChallengeRequest {
  device_id: string
  player_id: string
  challenge_ref: string
  pos?: GpsPosition
  photo_url?: string
  /** Free-form text submission for non-photo challenges (count, quote, etc.). */
  text_submission?: string
}

export interface SubmitChallengeResponse {
  challenge_ref: string
  reward_coins: number
  first_blood: boolean
  bonus_coins: number
  team_coins: number
  replacement: ChallengeDefinition | null
}

// ---------------------------------------------------------------------------
// Results / timeout contract (step 10)
// ---------------------------------------------------------------------------

// Per-team score breakdown per RULEBOOK §13.2 tiebreaker.
//   Flag photographed (kind=real attempt): +10 each
//   Each completed challenge:               +1
//   Each successful tag:                    +1
//   Each curse cast:                        +0.5
//   Each 50 coins remaining (floor):        +1
export interface TeamScore {
  team_id: string
  team_side: TeamSide
  found_real_flag: boolean
  challenges_completed: number
  tags_made: number
  curses_cast: number
  coins_remaining: number
  flag_points: number
  challenge_points: number
  tag_points: number
  curse_points: number
  coin_points: number
  total: number
}

export type WinReason = 'flag_returned' | 'timeout_points' | 'timeout_tiebreaker' | 'timeout_tied'

// POST /api/games/[id]/end-by-timeout
// Idempotent: only transitions when status in ('live', 'flag_found') AND
// now >= started_at + duration_minutes. Computes the winner via §13.2:
//   1. Higher total points wins
//   2. Tied → most challenges wins
//   3. Still tied → most coins wins
//   4. Still tied → null winner_team_id (the app reports a tie)
export interface EndByTimeoutRequest {
  device_id: string
}

export interface EndByTimeoutResponse {
  game: Game
  winner_team_id: string | null
  reason: WinReason
  scores: TeamScore[]
}

// ---------------------------------------------------------------------------
// Error envelope (all routes return this on failure)
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string
  details?: unknown
}
