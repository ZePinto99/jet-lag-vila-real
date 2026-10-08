import { cn } from '@/lib/cn'
import { DIAGRAM_COLORS as C, DIAGRAM_FONT as F } from './diagramTokens'
import { wrapText } from './wrapText'

export interface FlagOutcomeDiagramLabels {
  alt: string
  /** The shared starting action, e.g. "You photograph a marker". */
  start: string
  realTitle: string
  /** e.g. "Walk home to win" */
  realBody: string
  decoyTitle: string
  /** e.g. "−50 team coins" */
  decoyBody: string
  emptyTitle: string
  /** e.g. "15 min lockout, nothing lost" */
  emptyBody: string
}

/**
 * The three outcomes of attempting a flag, as a branch.
 *
 * This is the guide's most important *warning*. Every candidate looks identical
 * from the outside — the markers are deliberately indistinguishable — so the
 * player is always taking a one-in-three gamble, and the decoy branch fines the
 * team even when its balance is zero. A table buries that asymmetry; three coloured
 * branches of visibly different weight do not.
 */
export function FlagOutcomeDiagram({
  labels,
  className,
}: {
  labels: FlagOutcomeDiagramLabels
  className?: string
}) {
  const branches = [
    {
      x: 20,
      color: C.real,
      title: labels.realTitle,
      body: labels.realBody,
      emphasis: true,
    },
    {
      x: 128,
      color: C.decoy,
      title: labels.decoyTitle,
      body: labels.decoyBody,
      emphasis: true,
    },
    {
      x: 236,
      color: C.empty,
      title: labels.emptyTitle,
      body: labels.emptyBody,
      emphasis: false,
    },
  ]
  const boxW = 104
  const boxY = 96

  return (
    <figure className={cn('m-0', className)}>
      <svg
        viewBox="0 0 360 200"
        className="h-auto w-full"
        role="img"
        aria-label={labels.alt}
      >
        <rect x="0" y="0" width="360" height="200" fill={C.surface} />

        {/* --- The single starting action --- */}
        <rect
          x="88"
          y="14"
          width="184"
          height="32"
          rx="7"
          fill="#171717"
          stroke={C.line}
          strokeWidth="1"
        />
        <text
          x="180"
          y="34"
          textAnchor="middle"
          fill={C.label}
          fontSize={F.label}
          fontWeight="600"
        >
          {labels.start}
        </text>

        {/* --- Branch connectors --- */}
        {branches.map((b) => {
          const midX = b.x + boxW / 2
          return (
            <path
              key={b.x}
              d={`M180 46 L180 70 L${midX} 70 L${midX} ${boxY}`}
              fill="none"
              stroke={b.color}
              strokeOpacity="0.7"
              strokeWidth="1.5"
            />
          )
        })}

        {/* --- Outcome boxes --- */}
        {branches.map((b) => (
          <g key={`box-${b.x}`}>
            <rect
              x={b.x}
              y={boxY}
              width={boxW}
              height="76"
              rx="8"
              fill={b.color}
              fillOpacity={b.emphasis ? 0.16 : 0.08}
              stroke={b.color}
              strokeOpacity={b.emphasis ? 0.85 : 0.5}
              strokeWidth={b.emphasis ? 1.75 : 1}
            />
            <text
              x={b.x + boxW / 2}
              y={boxY + 26}
              textAnchor="middle"
              fill={b.color}
              fontSize={F.label}
              fontWeight="700"
            >
              {b.title}
            </text>
            {/* Bodies are short phrases; split on spaces into at most two lines
                so a longer PT-PT string still fits the box. */}
            {wrapText(b.body, 17).map((line, i) => (
              <text
                key={i}
                x={b.x + boxW / 2}
                y={boxY + 46 + i * 13}
                textAnchor="middle"
                fill={C.label}
                fontSize={F.small}
              >
                {line}
              </text>
            ))}
          </g>
        ))}
      </svg>
    </figure>
  )
}
