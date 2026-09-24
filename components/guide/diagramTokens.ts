// Shared drawing tokens for the player-guide diagrams.
//
// The guide explains rules that are overwhelmingly spatial — a 200 m zone union,
// a 5 m tag radius, a 50 m camping donut — so each one gets a hand-drawn SVG
// rather than prose. These tokens keep the set looking like one family, and keep
// the colours identical to what the player sees on the real map.
//
// Colours mirror GameMap.tsx / SetupMap.tsx. They are duplicated there too (five
// files predate this one); this module is the shared home for the *guide* only,
// deliberately not a refactor of the map components.

export const DIAGRAM_COLORS = {
  /** Team West — matches GameMap.tsx TEAM_COLOR.west (blue-500). */
  west: '#3b82f6',
  /** Team East — matches GameMap.tsx TEAM_COLOR.east (pink-500). */
  east: '#ec4899',
  /** Neutral landmarks (neutral-500). */
  neutral: '#737373',
  /** "You" marker — matches GameMap.tsx ME_COLOR (cyan-400). */
  me: '#22d3ee',
  /** Real flag — matches SetupMap.tsx ROLE_COLOR.real (emerald-500). */
  real: '#10b981',
  /** Decoy — matches SetupMap.tsx ROLE_COLOR.decoy (amber-500). */
  decoy: '#f59e0b',
  /** Empty candidate (neutral-500). */
  empty: '#737373',
  /** Danger / loss states (rose-500). */
  danger: '#f43f5e',
  /** Diagram surface, matching the page's card background. */
  surface: '#0a0a0a',
  /** Hairlines and zone outlines (neutral-700). */
  line: '#404040',
  /** Body label text (neutral-300). */
  label: '#d4d4d8',
  /** De-emphasised label text (neutral-500). */
  labelMuted: '#8a8a8a',
} as const

/**
 * Font sizes in user units. The diagrams render at roughly 320–400 user units
 * wide inside a container that is ~328 px at the narrowest supported phone
 * width, so 1 user unit ≈ 1 px and these read as px. Anything below ~9 is
 * illegible in sunlight — that floor is why several diagrams stack rather than
 * scale down.
 */
export const DIAGRAM_FONT = {
  title: 13,
  label: 11,
  small: 9.5,
} as const
