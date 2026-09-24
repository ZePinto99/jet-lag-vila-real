import { cn } from '@/lib/cn'
import { DIAGRAM_COLORS as C, DIAGRAM_FONT as F } from './diagramTokens'
import { wrapText } from './wrapText'

export interface TagDiagramLabels {
  alt: string
  /** Caption on the 5 m circle, e.g. "5 m". */
  radius: string
  /** The defender pin, e.g. "You (defender)". */
  defender: string
  /** The two caught raiders, e.g. "Both raiders tagged in one tap". */
  raiders: string
  /** Cost of being tagged, e.g. "Their team loses 1 intel card". */
  cost: string
  /** Step 1 of respawn, e.g. "Walk to the assigned neutral landmark". */
  step1: string
  /** Step 2 of respawn, e.g. "Confirm, then walk 45 m away". */
  step2: string
}

/**
 * What the Tag button actually does, and what it costs the other team.
 *
 * Two things here surprise players and both are visual: the 5 m circle catches
 * *everyone* inside it in a single tap, and the penalty is one card per tap —
 * not one per raider. Bunching up is therefore cheap for raiders, which is not
 * obvious from the rulebook sentence.
 *
 * The respawn strip along the bottom shows why a tagged player cannot simply
 * stand up and carry on: it is two stages, and the second needs real walking.
 */
export function TagDiagram({
  labels,
  className,
}: {
  labels: TagDiagramLabels
  className?: string
}) {
  const cx = 88
  const cy = 74
  const r = 46 // the 5 m tag radius

  return (
    <figure className={cn('m-0', className)}>
      <svg
        viewBox="0 0 360 250"
        className="h-auto w-full"
        role="img"
        aria-label={labels.alt}
      >
        <rect x="0" y="0" width="360" height="250" fill={C.surface} />

        {/* --- The tag radius --- */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill={C.west}
          fillOpacity="0.14"
          stroke={C.west}
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />

        {/* Radius measure */}
        <line x1={cx} y1={cy} x2={cx + r} y2={cy} stroke={C.labelMuted} strokeWidth="1" />
        <text
          x={cx + r / 2}
          y={cy - 5}
          textAnchor="middle"
          fill={C.labelMuted}
          fontSize={F.small}
        >
          {labels.radius}
        </text>

        {/* --- Defender (you) at the centre --- */}
        <circle cx={cx} cy={cy} r="10" fill={C.me} stroke="#fafafa" strokeWidth="2" />
        <text x={cx} y={cy - 18} textAnchor="middle" fill={C.me} fontSize={F.label} fontWeight="600">
          {labels.defender}
        </text>

        {/* --- Two enemy raiders, both inside the circle --- */}
        <circle cx={cx + 20} cy={cy + 22} r="9" fill={C.east} stroke="#fafafa" strokeWidth="2" />
        <circle cx={cx + 32} cy={cy + 6} r="9" fill={C.east} stroke="#fafafa" strokeWidth="2" />

        {/* Caption for the pair, to the right of the circle. Wrapped because
            208 units at 11 px only fits ~20 EN chars, and PT-PT runs longer. */}
        {wrapText(labels.raiders, 19, 2).map((line, i) => (
          <text
            key={i}
            x="152"
            y={cy - 4 + i * 13}
            fill={C.east}
            fontSize={F.label}
            fontWeight="600"
          >
            {line}
          </text>
        ))}
        {wrapText(labels.cost, 22, 2).map((line, i) => (
          <text key={i} x="152" y={cy + 26 + i * 12} fill={C.label} fontSize={F.small}>
            {line}
          </text>
        ))}

        {/* --- Respawn, as two stages --- */}
        <line
          x1="20"
          y1="150"
          x2="340"
          y2="150"
          stroke={C.line}
          strokeWidth="1"
        />

        <g>
          <circle cx="40" cy="182" r="13" fill={C.neutral} stroke="#fafafa" strokeWidth="2" />
          <text
            x="40"
            y="186"
            textAnchor="middle"
            fontSize={F.label}
            fontWeight="700"
            fill="#0a0a0a"
          >
            1
          </text>
          {wrapText(labels.step1, 34, 2).map((line, i) => (
            <text key={i} x="62" y={179 + i * 12} fill={C.label} fontSize={F.label}>
              {line}
            </text>
          ))}
        </g>

        {/* Walk arrow between the stages */}
        <path
          d="M40 206 L40 218"
          stroke={C.labelMuted}
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />

        <g>
          <circle cx="40" cy="232" r="13" fill={C.real} stroke="#fafafa" strokeWidth="2" />
          <text
            x="40"
            y="236"
            textAnchor="middle"
            fontSize={F.label}
            fontWeight="700"
            fill="#0a0a0a"
          >
            2
          </text>
          {wrapText(labels.step2, 34, 2).map((line, i) => (
            <text key={i} x="62" y={229 + i * 12} fill={C.label} fontSize={F.label}>
              {line}
            </text>
          ))}
        </g>
      </svg>
    </figure>
  )
}
