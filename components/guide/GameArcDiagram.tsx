import { cn } from '@/lib/cn'
import { DIAGRAM_COLORS as C, DIAGRAM_FONT as F } from './diagramTokens'
import { wrapText } from './wrapText'

export interface GameArcDiagramLabels {
  alt: string
  lobbyTitle: string
  lobbyBody: string
  setupTitle: string
  setupBody: string
  huntTitle: string
  huntBody: string
  endTitle: string
  endBody: string
  /** Note on the protected opening window, e.g. "No flag attempts for 30 min". */
  protection: string
}

/**
 * The shape of a whole game, so a new player knows what happens when.
 *
 * Vertical rather than horizontal: four phases with real captions do not fit
 * across 360 px, and a phone scrolls down anyway. The protected opening window
 * is called out on the hunt phase because it is the one piece of timing that
 * changes what players should do in the first half-hour.
 */
export function GameArcDiagram({
  labels,
  className,
}: {
  labels: GameArcDiagramLabels
  className?: string
}) {
  const phases = [
    { title: labels.lobbyTitle, body: labels.lobbyBody, color: C.neutral },
    { title: labels.setupTitle, body: labels.setupBody, color: C.west },
    { title: labels.huntTitle, body: labels.huntBody, color: C.east },
    { title: labels.endTitle, body: labels.endBody, color: C.real },
  ]
  const rowH = 54
  const top = 12
  const railX = 26

  return (
    <figure className={cn('m-0', className)}>
      <svg
        viewBox={`0 0 360 ${top + phases.length * rowH + 30}`}
        className="h-auto w-full"
        role="img"
        aria-label={labels.alt}
      >
        <rect
          x="0"
          y="0"
          width="360"
          height={top + phases.length * rowH + 30}
          fill={C.surface}
        />

        {/* The rail connecting the phases */}
        <line
          x1={railX}
          y1={top + 14}
          x2={railX}
          y2={top + (phases.length - 1) * rowH + 14}
          stroke={C.line}
          strokeWidth="2"
        />

        {phases.map((p, i) => {
          const y = top + i * rowH
          return (
            <g key={p.title}>
              <circle
                cx={railX}
                cy={y + 14}
                r="9"
                fill={p.color}
                stroke="#fafafa"
                strokeWidth="2"
              />
              <text
                x={railX}
                y={y + 17.5}
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="#0a0a0a"
              >
                {i + 1}
              </text>
              <text
                x={railX + 22}
                y={y + 12}
                fill={p.color}
                fontSize={F.label}
                fontWeight="700"
              >
                {p.title}
              </text>
              {wrapText(p.body, 40, 2).map((line, li) => (
                <text
                  key={li}
                  x={railX + 22}
                  y={y + 27 + li * 12}
                  fill={C.label}
                  fontSize={F.small}
                >
                  {line}
                </text>
              ))}
            </g>
          )
        })}

        {/* Protected opening window, tied to the hunt phase (index 2) */}
        <text
          x={railX + 22}
          y={top + 2 * rowH + 51}
          fill={C.decoy}
          fontSize={F.small}
          fontWeight="600"
        >
          {labels.protection}
        </text>
      </svg>
    </figure>
  )
}
