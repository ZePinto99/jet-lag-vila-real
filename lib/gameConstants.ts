// Player-facing game constants shared by the API routes that enforce them and
// the surfaces that explain them (notably the in-app player guide at /guide).
//
// Why this module exists: these values used to be declared privately inside
// individual route files, which meant (a) a client page could not read them
// without importing a route, and (b) several had already drifted into two
// copies. Keeping them here gives one source of truth per number.
//
// This file must stay free of server-only imports so client components can read
// it. Values that already live in a single exported home elsewhere are NOT
// re-exported here — importing them from their own module keeps one source of
// truth rather than two. Those are:
//   PLAY_AREA_RADIUS_M                    lib/geo/playArea.ts
//   DEFENSE_ZONE_RADIUS_M                 lib/geo/zones.ts
//   ENEMY_CANDIDATE_RAID_RADIUS_M         lib/geo/zones.ts
//   TAG_RADIUS_M                          lib/hooks/useTagButton.ts
//   CAMPING_WARNING_S / _LOCK_S / _COOLDOWN_S
//                                         lib/hooks/useCamping.ts
//   FLAG_ATTEMPT_RADIUS_M                 lib/hooks/useFlagAttemptButton.ts
//   TIME_BONUS_INTERVAL_MINUTES           lib/timeBonuses.ts
//   WEATHER_PROPOSAL_WINDOW_MS            lib/weatherPause.ts
//   POSITION_MAX_AGE_MS                   lib/geo/positionFreshness.ts

// ---------------------------------------------------------------------------
// Coin economy (RULEBOOK §7)
// ---------------------------------------------------------------------------

/** Starting balance per team (RULEBOOK §7.1). */
export const STARTING_COINS = 100

/** Coins awarded per elapsed time-bonus interval (RULEBOOK §7.2). */
export const TIME_BONUS = 20

/** Cost of a single curse die; a cast rolls 1–3 (RULEBOOK §7.3 / §8.2). */
export const COIN_COST_PER_DIE = 50

/**
 * Cost to harden your own real flag's challenge, once per game
 * (RULEBOOK §5.3 / §7.3).
 */
export const HARDEN_COST = 150

// ---------------------------------------------------------------------------
// Intel (RULEBOOK §11)
// ---------------------------------------------------------------------------

/**
 * Anti-spam cap on how much intel a team may hold. Counted over cards the team
 * has NOT lost to an enemy action — i.e. `in_hand` intel.
 *
 * Why not "any state": the cap used to count intel rows in every state, which
 * made it a lifetime purchase budget rather than a hand size. That
 * double-penalised a single enemy action, because every intel expiry in the
 * codebase is an enemy action:
 *   - a tag (0039:155-164, one card per Tag action)
 *   - `curse.intel-loss` (0046:112-124, one card)
 *   - a decoy flag attempt (0026:130-133, ALL in_hand intel, no `limit 1`)
 * A team holding 4 cards that raided a decoy was then locked out of intel for
 * the rest of the game: 0 usable cards, 0 purchases, at any balance. Worse, the
 * map ignores non-`in_hand` cards (lib/intel/narrowing.ts:58), so an expired
 * card contributed nothing while fully consuming a slot. It also made
 * `curse.intel-loss` exceed its catalogue text ("discard 1 random intel card")
 * by silently burning a purchase slot too (SIM_EVALUATION P1 / P16).
 *
 * Intel is never consumed by its owner — no code path writes `consumed` for
 * `kind = 'intel'` (0015:110, the only writer, filters `kind = 'challenge'`).
 * So for intel, `state = 'in_hand'` is exactly "not lost to an enemy action",
 * and a tag now costs a card rather than a card AND a slot.
 *
 * Anti-farm is preserved by the SEPARATE duplicate guard, which is deliberately
 * state-agnostic: `intel_already_purchased` rejects a ref the team has ever
 * bought, in any state. A team therefore cannot churn a lost card by rebuying
 * it, and with 8 catalogue refs the lifetime ceiling stays bounded.
 */
export const INTEL_CAP = 4

// ---------------------------------------------------------------------------
// Flag attempts (RULEBOOK §5.2, PLAYTEST_TRIAGE P1-2 / P2-1 / P2-3)
// ---------------------------------------------------------------------------

/**
 * Server-side geofence radius for flag attempts. RULEBOOK §5.2 sets the attempt
 * geofence at 20 m, and the client lights the button at 20 m
 * (FLAG_ATTEMPT_RADIUS_M in lib/hooks/useFlagAttemptButton.ts). But urban GPS
 * drift in Vila Real's narrow, densely clustered streets routinely adds 5–10 m
 * of error — so a raider who is plainly at the landmark when the button lit can
 * read 22–25 m by the time the POST lands, producing intermittent
 * out_of_geofence rejections. Mirroring the Tag route's 5 m→10 m buffer, the
 * server accepts up to 28 m. See PLAYTEST_TRIAGE P1-2.
 *
 * The 20/28 split is deliberate: the client is conservative, the server is the
 * authority.
 */
export const ATTEMPT_RANGE_M = 28

/**
 * Radius for merely *opening* the attempt panel. Matches ATTEMPT_RANGE_M so the
 * panel never opens somewhere a submission would then be rejected.
 */
export const ATTEMPT_START_RADIUS_M = 28

/**
 * A hardened landmark (team spent HARDEN_COST) is harder to capture: the raider
 * must be more precisely on the spot. We tighten the radius rather than swap the
 * visible challenge text, so hardening never leaks which enemy candidate is the
 * real flag (only the real flag can be hardened). See PLAYTEST_TRIAGE P2-1.
 */
export const HARDENED_RANGE_M = 12

/**
 * No flag attempts in the opening window of the game (P2-3). Server-derived
 * from game.started_at so it survives refresh / late join.
 */
export const PROTECTION_WINDOW_MS = 30 * 60_000

/**
 * After a failed attempt (decoy or empty), the attempting team is locked out of
 * THAT landmark for this long (P2-4). The server enforces it; the client
 * re-derives it from the event log to grey the landmark out with a countdown.
 */
export const LANDMARK_LOCKOUT_MS = 15 * 60_000

// ---------------------------------------------------------------------------
// Respawn (RULEBOOK §6)
// ---------------------------------------------------------------------------

/**
 * Hysteresis distance a tagged raider must put between themselves and the
 * neutral landmark to clear the immunity stage, so noisy GPS at exactly the
 * arrival radius cannot clear it instantly.
 */
export const NEUTRAL_LEAVE_RADIUS_M = 45

// ---------------------------------------------------------------------------
// Tagging and camping (RULEBOOK §6)
// ---------------------------------------------------------------------------

/**
 * Server-side tag radius. The client lights the Tag button at TAG_RADIUS_M
 * (5 m, lib/hooks/useTagButton.ts) but the server accepts up to 10 m, because
 * two phones in a narrow street routinely disagree by several metres. Same
 * shape as the flag-attempt 20/28 split: the client is conservative, the server
 * is the authority.
 */
export const TAG_RANGE_M = 10

/**
 * A defender may not loiter within this distance of their OWN candidate
 * landmarks; doing so past CAMPING_LOCK_S disables their own Tag button.
 * Enforced by the tag route and the camping-heartbeat route, and mirrored
 * client-side in lib/hooks/useCamping.ts.
 */
export const CAMPING_RADIUS_M = 50

// ---------------------------------------------------------------------------
// Challenges (RULEBOOK §8.1)
// ---------------------------------------------------------------------------

/**
 * Server-side geofence for a challenge submission: how close the submitting
 * player must be to the challenge's landmark.
 *
 * Looser than a flag attempt (20 m client / 28 m server) because a challenge is
 * performed at the surrounding location rather than exactly on a marker, but
 * tighter than the 100 m this used to be. In Vila Real's historic core a 100 m
 * circle reached well past its own landmark — Largo do Pelourinho's circle
 * covered Avenida Carvalho Araújo (~82 m away) — so a team could claim a
 * landmark from a block away without visiting it. 60 m still absorbs urban GPS
 * drift, which the rest of the app budgets at 5–10 m (SIM_EVALUATION P10).
 *
 * Verified against data/challenges.json: the closest pair of distinct challenge
 * landmarks is Sé Catedral ↔ Largo do Pelourinho at 60.6 m, so at 60 m no two
 * challenges are ever mutually claimable from one spot. That 0.6 m headroom is
 * the binding constraint — do not raise this value without re-measuring.
 */
export const CHALLENGE_GEOFENCE_M = 60

// ---------------------------------------------------------------------------
// Scoring on timeout (RULEBOOK §13)
// ---------------------------------------------------------------------------

/** Points for photographing the enemy's real flag. */
export const FLAG_PTS = 10
/** Points per completed challenge. */
export const CHALLENGE_PTS = 1
/** Points per successful tag. */
export const TAG_PTS = 1

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/** Fallback game length in minutes when game.config.duration_minutes is unset. */
export const DEFAULT_DURATION_MIN = 180
