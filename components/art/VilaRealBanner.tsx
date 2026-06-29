import { cn } from '@/lib/cn'
import type { TeamSide } from '@/lib/types'

/** Team accent colours — match the map markers (GameMap.tsx). */
const TINT: Record<TeamSide, string> = {
  west: '#3b82f6', // blue-500
  east: '#ec4899', // pink-500
}

/**
 * Hand-coded cartoon illustration of Vila Real — warm storybook style.
 *
 * Recognizable elements, back to front: Serra do Marão hills, the Corgo
 * viaduct, vineyard terraces with cypress trees, Casa de Mateus (the baroque
 * palace from the Mateus wine label), and the Sé Catedral twin towers.
 *
 * The SVG uses `preserveAspectRatio="xMidYMax slice"` so the foreground
 * landmarks stay anchored to the bottom — shrinking the wrapper's height
 * crops the sky, never the town. Control the height via `className`
 * (e.g. `h-56` for a full hero, `h-28` for a strip).
 *
 * Pass `tint` to wash the sky toward a team's colour (used on the create/join
 * screens so the banner reacts to the chosen side).
 */
export function VilaRealBanner({
  className,
  tint,
}: {
  className?: string
  tint?: TeamSide
}) {
  return (
    <div className={cn('relative overflow-hidden', className)}>
      <svg
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMax slice"
        className="h-full w-full"
        role="img"
        aria-label="Cartoon illustration of Vila Real: rolling hills, the Corgo viaduct, vineyards, the Casa de Mateus palace and the cathedral towers"
      >
        <defs>
          <linearGradient id="vr-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffd9a8" />
            <stop offset="45%" stopColor="#ffeccd" />
            <stop offset="100%" stopColor="#cfe6f0" />
          </linearGradient>
          <linearGradient id="vr-fg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5aa24f" />
            <stop offset="100%" stopColor="#3f7d3d" />
          </linearGradient>
          {tint && (
            <>
              {/* Sky wash — visible on the tall hero. Drawn under the scene. */}
              <linearGradient id="vr-tint-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TINT[tint]} stopOpacity="0.42" />
                <stop offset="38%" stopColor={TINT[tint]} stopOpacity="0" />
              </linearGradient>
              {/* Ground glow — visible on the short strip. Drawn over the
                  foreground so the team colour reads as "their" turf. */}
              <linearGradient id="vr-tint-ground" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TINT[tint]} stopOpacity="0" />
                <stop offset="100%" stopColor={TINT[tint]} stopOpacity="0.4" />
              </linearGradient>
            </>
          )}
        </defs>

        {/* Sky */}
        <rect x="0" y="0" width="400" height="200" fill="url(#vr-sky)" />
        {/* Team-colour wash over the sky (drawn under the sun + scene) */}
        {tint && <rect x="0" y="0" width="400" height="200" fill="url(#vr-tint-sky)" />}

        {/* Sun + glow */}
        <circle cx="332" cy="42" r="34" fill="#ffe7a6" opacity="0.55" />
        <circle cx="332" cy="42" r="21" fill="#ffd166" />

        {/* Clouds */}
        <g fill="#ffffff" opacity="0.9">
          <ellipse cx="70" cy="38" rx="20" ry="11" />
          <ellipse cx="92" cy="42" rx="16" ry="9" />
          <ellipse cx="52" cy="44" rx="13" ry="8" />
          <ellipse cx="250" cy="28" rx="16" ry="8" />
          <ellipse cx="268" cy="31" rx="12" ry="7" />
        </g>

        {/* Serra do Marão — far hazy ridge */}
        <path
          d="M0 118 L48 86 L96 110 L150 80 L210 108 L268 82 L330 110 L400 88 L400 200 L0 200 Z"
          fill="#8bafa3"
        />
        {/* Mid hills */}
        <path
          d="M0 138 L60 116 L120 134 L190 112 L260 132 L330 116 L400 132 L400 200 L0 200 Z"
          fill="#9ec45c"
        />

        {/* Corgo viaduct — left valley */}
        <g stroke="#7c6a4d" strokeWidth="1.5" strokeLinejoin="round">
          <rect x="8" y="120" width="104" height="6" fill="#ded0b0" />
          {/* piers */}
          <rect x="18" y="126" width="7" height="34" fill="#e7dcc2" />
          <rect x="42" y="126" width="7" height="34" fill="#e7dcc2" />
          <rect x="66" y="126" width="7" height="34" fill="#e7dcc2" />
          <rect x="90" y="126" width="7" height="34" fill="#e7dcc2" />
          {/* arches */}
          <path d="M25 150 A12 12 0 0 1 42 150" fill="none" />
          <path d="M49 150 A12 12 0 0 1 66 150" fill="none" />
          <path d="M73 150 A12 12 0 0 1 90 150" fill="none" />
        </g>

        {/* Foreground hill */}
        <path
          d="M0 158 C90 140 150 150 210 150 C290 150 340 144 400 156 L400 200 L0 200 Z"
          fill="url(#vr-fg)"
        />

        {/* Vineyard terraces — left foreground hill */}
        <g stroke="#3f6e36" strokeWidth="2" strokeLinecap="round" opacity="0.8">
          <line x1="14" y1="170" x2="48" y2="166" />
          <line x1="12" y1="178" x2="50" y2="174" />
          <line x1="10" y1="186" x2="52" y2="182" />
          <line x1="60" y1="172" x2="96" y2="170" />
          <line x1="58" y1="180" x2="98" y2="178" />
          <line x1="56" y1="188" x2="100" y2="186" />
        </g>

        {/* Cypress trees */}
        <g>
          <path d="M120 168 q-5 -22 0 -34 q5 12 0 34 Z" fill="#2f6b3b" />
          <path d="M132 170 q-4 -18 0 -28 q4 10 0 28 Z" fill="#357a43" />
        </g>

        {/* Casa de Mateus — baroque palace, centre */}
        <g stroke="#5a4632" strokeWidth="1.6" strokeLinejoin="round">
          {/* reflecting pool */}
          <ellipse cx="200" cy="166" rx="44" ry="6" fill="#b7dcea" stroke="none" />
          {/* left & right wings */}
          <rect x="162" y="140" width="18" height="20" fill="#fbf3e4" />
          <rect x="220" y="140" width="18" height="20" fill="#fbf3e4" />
          <path d="M162 140 L171 132 L180 140 Z" fill="#b5651d" />
          <path d="M220 140 L229 132 L238 140 Z" fill="#b5651d" />
          {/* central block */}
          <rect x="180" y="132" width="40" height="28" fill="#fef7ec" />
          {/* main roof */}
          <path d="M178 132 L200 120 L222 132 Z" fill="#c06a26" />
          {/* central pediment + finial */}
          <path d="M192 124 L200 116 L208 124 Z" fill="#fbf3e4" />
          <line x1="200" y1="116" x2="200" y2="110" stroke="#5a4632" strokeWidth="1.4" />
          {/* corner pinnacles */}
          <path d="M180 132 L183 126 L186 132 Z" fill="#e8d9bd" />
          <path d="M214 132 L217 126 L220 132 Z" fill="#e8d9bd" />
          {/* windows + door */}
          <g fill="#7a8a93" stroke="none">
            <rect x="186" y="139" width="5" height="8" />
            <rect x="197" y="139" width="6" height="8" />
            <rect x="209" y="139" width="5" height="8" />
            <rect x="167" y="146" width="4" height="6" />
            <rect x="227" y="146" width="4" height="6" />
          </g>
          <rect x="196" y="150" width="8" height="10" fill="#6b4a2a" stroke="none" />
        </g>

        {/* Sé Catedral — twin towers, right */}
        <g stroke="#5a4632" strokeWidth="1.6" strokeLinejoin="round">
          {/* nave */}
          <rect x="300" y="138" width="30" height="24" fill="#ece3d2" />
          <path d="M300 138 L315 130 L330 138 Z" fill="#b5651d" />
          {/* towers */}
          <rect x="292" y="124" width="13" height="38" fill="#f3ecdd" />
          <rect x="325" y="124" width="13" height="38" fill="#f3ecdd" />
          <path d="M291 124 L298.5 114 L306 124 Z" fill="#c06a26" />
          <path d="M324 124 L331.5 114 L339 124 Z" fill="#c06a26" />
          <line x1="298.5" y1="114" x2="298.5" y2="109" stroke="#5a4632" strokeWidth="1.3" />
          <line x1="331.5" y1="114" x2="331.5" y2="109" stroke="#5a4632" strokeWidth="1.3" />
          {/* windows */}
          <g fill="#7a8a93" stroke="none">
            <rect x="296" y="132" width="5" height="9" />
            <rect x="329" y="132" width="5" height="9" />
            <rect x="311" y="144" width="8" height="12" rx="3" />
          </g>
        </g>

        {/* Team-colour ground glow — over the foreground edge */}
        {tint && <rect x="0" y="150" width="400" height="50" fill="url(#vr-tint-ground)" />}
      </svg>
    </div>
  )
}
