import { cn } from '@/lib/cn'
import { DIAGRAM_COLORS as C, DIAGRAM_FONT as F } from './diagramTokens'
import { wrapText } from './wrapText'

export interface IntelNarrowingDiagramLabels {
  alt: string
  /** State before buying, e.g. "5 candidates — any could hold the flag". */
  before: string
  /** The card bought, e.g. "Buy North/South". */
  card: string
  /** State after, e.g. "2 ruled out — 3 left to check". */
  after: string
  /** Caption on the struck-out markers, e.g. "Ruled out". */
  ruledOut: string
}

/**
 * What buying an intel card actually buys you: fewer places to walk.
 *
 * New players read "reveals whether the flag is north or south" and picture a
 * pointer to the flag. It is subtraction, not direction — the value is the
 * candidates it eliminates, and with a hard cap of four cards per game that
 * arithmetic is the whole strategy. Showing five pins becoming three makes the
 * point faster than the card descriptions do.
 */
export function IntelNarrowingDiagram({
  labels,
  className,
}: {
  labels: IntelNarrowingDiagramLabels
  className?: string
}) {
  // Five candidates before; the last two get ruled out.
  const before = [30, 74, 118, 162, 206]
  const ruledOutFrom = 3 // index at which pins become struck out

  return (
    <figure className={cn('m-0', className)}>
      <svg
        viewBox="0 0 360 196"
        className="h-auto w-full"
        role="img"
        aria-label={labels.alt}
      >
        <rect x="0" y="0" width="360" height="196" fill={C.surface} />

        {/* --- Before --- */}
        <text x="20" y="22" fill={C.labelMuted} fontSize={F.small}>
          {labels.before}
        </text>
        {before.map((x) => (
          <circle
            key={x}
            cx={x + 20}
            cy="44"
            r="11"
            fill={C.east}
            fillOpacity="0.85"
            stroke="#fafafa"
            strokeWidth="1.75"
          />
        ))}

        {/* --- The purchase --- */}
        <rect
          x="20"
          y="70"
          width="150"
          height="28"
          rx="6"
          fill={C.decoy}
          fillOpacity="0.16"
          stroke={C.decoy}
          strokeOpacity="0.8"
          strokeWidth="1.25"
        />
        <text x="32" y="88" fill={C.decoy} fontSize={F.small} fontWeight="600">
          {labels.card}
        </text>
        <path
          d="M95 98 L95 116"
          stroke={C.decoy}
          strokeOpacity="0.8"
          strokeWidth="1.5"
          markerEnd=""
        />

        {/* --- After --- */}
        {before.map((x, i) => {
          const out = i >= ruledOutFrom
          return (
            <g key={`after-${x}`}>
              <circle
                cx={x + 20}
                cy="132"
                r="11"
                fill={out ? C.neutral : C.east}
                fillOpacity={out ? 0.3 : 0.85}
                stroke={out ? C.labelMuted : '#fafafa'}
                strokeWidth="1.75"
              />
              {out && (
                <>
                  <line
                    x1={x + 12}
                    y1="124"
                    x2={x + 28}
                    y2="140"
                    stroke={C.danger}
                    strokeWidth="2"
                  />
                  <line
                    x1={x + 28}
                    y1="124"
                    x2={x + 12}
                    y2="140"
                    stroke={C.danger}
                    strokeWidth="2"
                  />
                </>
              )}
            </g>
          )
        })}

        {/* Ruled-out caption under the struck pins */}
        <text
          x={before[ruledOutFrom] + 20}
          y="158"
          fill={C.danger}
          fontSize={F.small}
        >
          {labels.ruledOut}
        </text>

        {/* Result line */}
        {wrapText(labels.after, 46, 2).map((line, i) => (
          <text key={i} x="20" y={172 + i * 12} fill={C.real} fontSize={F.label} fontWeight="600">
            {line}
          </text>
        ))}
      </svg>
    </figure>
  )
}
