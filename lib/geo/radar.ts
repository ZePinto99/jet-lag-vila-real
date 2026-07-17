// Enemy radar cadence (RULEBOOK §6 defense zones + playtest item C11).
//
// An enemy raider standing inside one of YOUR team's defense zones is revealed
// to your whole team — but only intermittently, like a Call-of-Duty radar
// sweep: a short ON pulse, then a longer OFF gap, repeating. Enemies are never
// shown outside your zones (no neutral-zone leaks), and the rule is identical
// for every player on every device.
//
// Tune the cadence here — this is the single source of truth for the timings.
export const RADAR_CONFIG = {
  /** How long each ping stays visible, in milliseconds. */
  onMs: 5_000,
  /** How long the enemy is hidden between pings, in milliseconds. */
  offMs: 15_000,
} as const

/** Full radar cycle length (one ping + one gap). */
export const RADAR_PERIOD_MS = RADAR_CONFIG.onMs + RADAR_CONFIG.offMs

/**
 * True during the visible ("ping") window of the current radar cycle.
 * Driven off a shared wall clock so every device pulses in sync.
 */
export function radarPingVisible(nowMs: number): boolean {
  return nowMs % RADAR_PERIOD_MS < RADAR_CONFIG.onMs
}
