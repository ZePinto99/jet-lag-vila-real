import { cn } from '@/lib/cn'
import { DIAGRAM_COLORS as C, DIAGRAM_FONT as F } from './diagramTokens'
import { wrapText } from './wrapText'

export interface EconomyDiagramLabels {
  alt: string
  /** The earning source, e.g. "Complete challenges". */
  challenges: string
  /** The currency, e.g. "Coins". */
  coins: string
  /** Extra income note, e.g. "+20 every 30 min". */
  passive: string
  /** Spend 1, e.g. "Intel — narrow down their flag". */
  intel: string
  /** Spend 2, e.g. "Curses — slow them down". */
  curses: string
  /** Spend 3, e.g. "Harden — protect your own flag". */
  harden: string
}

/**
 * Where coins come from and what they buy.
 *
 * Laid out as a left-to-right flow rather than a cycle: earning and spending are
 * genuinely one-directional here (nothing converts back into coins), and a ring
 * at 360 px wide would force the four node labels into unreadable slivers. The
 * three spend branches stack vertically so each keeps a full-width caption.
 */
export function EconomyDiagram({
  labels,
  className,
}: {
  labels: EconomyDiagramLabels
  className?: string
}) {
  const spends = [
    { y: 48, color: C.west, text: labels.intel },
    { y: 104, color: C.east, text: labels.curses },
    { y: 160, color: C.real, text: labels.harden },
  ]
  const coinsX = 96
  const coinsY = 104
  const spendX = 196
  const spendW = 148

  return (
    <figure className={cn('m-0', className)}>
      <svg
        viewBox="0 0 360 210"
        className="h-auto w-full"
        role="img"
        aria-label={labels.alt}
      >
        <rect x="0" y="0" width="360" height="210" fill={C.surface} />

        {/* --- Earning: challenges feed the purse --- */}
        <rect
          x="14"
          y="34"
          width="68"
          height="52"
          rx="7"
          fill="#171717"
          stroke={C.line}
          strokeWidth="1"
        />
        {wrapText(labels.challenges, 11, 3).map((line, i) => (
          <text
            key={i}
            x="48"
            y={52 + i * 12}
            textAnchor="middle"
            fill={C.label}
            fontSize={F.small}
          >
            {line}
          </text>
        ))}
        <path
          d={`M48 86 L48 ${coinsY - 22}`}
          stroke={C.decoy}
          strokeOpacity="0.8"
          strokeWidth="1.5"
        />

        {/* --- Passive income, joining from below --- */}
        <text x="14" y="176" fill={C.labelMuted} fontSize={F.small}>
          {labels.passive}
        </text>
        <path
          d={`M48 160 L48 ${coinsY + 22}`}
          stroke={C.labelMuted}
          strokeWidth="1.25"
          strokeDasharray="3 3"
        />

        {/* --- The purse --- */}
        <circle
          cx={coinsX}
          cy={coinsY}
          r="30"
          fill={C.decoy}
          fillOpacity="0.18"
          stroke={C.decoy}
          strokeWidth="2"
        />
        <text
          x={coinsX}
          y={coinsY + 4}
          textAnchor="middle"
          fill={C.decoy}
          fontSize={F.label}
          fontWeight="700"
        >
          {labels.coins}
        </text>

        {/* --- Spending: three branches --- */}
        {spends.map((s) => (
          <g key={s.y}>
            <path
              d={`M${coinsX + 30} ${coinsY} C ${coinsX + 58} ${coinsY}, ${
                spendX - 26
              } ${s.y + 18}, ${spendX} ${s.y + 18}`}
              fill="none"
              stroke={s.color}
              strokeOpacity="0.7"
              strokeWidth="1.5"
            />
            <rect
              x={spendX}
              y={s.y}
              width={spendW}
              height="36"
              rx="7"
              fill={s.color}
              fillOpacity="0.14"
              stroke={s.color}
              strokeOpacity="0.8"
              strokeWidth="1.25"
            />
            {/* 20 chars/line keeps a PT-PT caption (≈22% longer than EN)
                inside the 148-unit box at 9.5 px. */}
            {wrapText(s.text, 20, 2).map((line, i, arr) => (
              <text
                key={i}
                x={spendX + 10}
                y={s.y + (arr.length === 1 ? 22 : 16) + i * 12}
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
