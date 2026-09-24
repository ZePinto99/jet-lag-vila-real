import { cn } from '@/lib/cn'
import { DIAGRAM_COLORS as C, DIAGRAM_FONT as F } from './diagramTokens'
import { wrapText } from './wrapText'

export interface CampingDiagramLabels {
  alt: string
  /** Caption on the forbidden radius, e.g. "50 m from your own flag". */
  radius: string
  /** The landmark pin, e.g. "Your candidate". */
  landmark: string
  /** Warning milestone, e.g. "90 s — app warns you". */
  warn: string
  /** Lock milestone, e.g. "120 s — your Tag button switches off". */
  lock: string
  /** Reset rule, e.g. "Leave for 60 s to reset the timer". */
  reset: string
}

/**
 * The camping rule, which players consistently get wrong in the same direction:
 * they assume standing on their own flag is the safest thing they can do.
 *
 * It is the opposite — loiter within 50 m of your own candidate for two minutes
 * and the app disables *your* Tag button, leaving you standing next to your flag
 * unable to defend it. The drawing pairs the forbidden donut with a timeline so
 * the penalty and its schedule land together.
 */
export function CampingDiagram({
  labels,
  className,
}: {
  labels: CampingDiagramLabels
  className?: string
}) {
  const cx = 82
  const cy = 76
  const r = 56 // the 50 m camping radius

  // Timeline geometry
  const tx = 168
  const tTop = 30
  const tBottom = 150
  const warnY = tTop + (tBottom - tTop) * 0.42 // 90 s of a 120 s span, roughly
  const lockY = tBottom

  return (
    <figure className={cn('m-0', className)}>
      <svg
        viewBox="0 0 360 215"
        className="h-auto w-full"
        role="img"
        aria-label={labels.alt}
      >
        <defs>
          {/* Hatch fill marks the radius as forbidden ground rather than a
              friendly zone — the blue/pink zone fills elsewhere in the guide
              all mean "yours"/"theirs", so this needs a different visual verb. */}
          <pattern
            id="cd-hatch"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="7" stroke={C.danger} strokeOpacity="0.5" strokeWidth="1.5" />
          </pattern>
        </defs>

        <rect x="0" y="0" width="360" height="215" fill={C.surface} />

        {/* --- Forbidden radius --- */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="url(#cd-hatch)"
          stroke={C.danger}
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />

        {/* Your own candidate landmark at the centre */}
        <circle cx={cx} cy={cy} r="7" fill={C.real} stroke="#fafafa" strokeWidth="1.75" />

        {/* A defender loitering inside it */}
        <circle cx={cx + 24} cy={cy + 18} r="9" fill={C.me} stroke="#fafafa" strokeWidth="2" />

        {/* Radius measure */}
        <line x1={cx} y1={cy} x2={cx} y2={cy - r} stroke={C.labelMuted} strokeWidth="1" />
        {wrapText(labels.radius, 15, 2).map((line, i) => (
          <text
            key={i}
            x={cx}
            y={cy - r - 10 + i * 11}
            textAnchor="middle"
            fill={C.danger}
            fontSize={F.small}
            fontWeight="600"
          >
            {line}
          </text>
        ))}

        <text
          x={cx}
          y={cy + r + 16}
          textAnchor="middle"
          fill={C.labelMuted}
          fontSize={F.small}
        >
          {labels.landmark}
        </text>

        {/* --- Countdown timeline --- */}
        <line x1={tx} y1={tTop} x2={tx} y2={tBottom} stroke={C.line} strokeWidth="2" />

        {/* 90 s: warning */}
        <circle cx={tx} cy={warnY} r="5.5" fill={C.decoy} stroke="#fafafa" strokeWidth="1.5" />
        {wrapText(labels.warn, 22, 2).map((line, i) => (
          <text
            key={i}
            x={tx + 14}
            y={warnY + 1 + i * 12}
            fill={C.label}
            fontSize={F.small}
          >
            {line}
          </text>
        ))}

        {/* 120 s: tag button disabled */}
        <circle cx={tx} cy={lockY} r="5.5" fill={C.danger} stroke="#fafafa" strokeWidth="1.5" />
        {wrapText(labels.lock, 22, 2).map((line, i) => (
          <text
            key={i}
            x={tx + 14}
            y={lockY + 1 + i * 12}
            fill={C.label}
            fontSize={F.small}
            fontWeight="600"
          >
            {line}
          </text>
        ))}

        {/* --- Reset rule, spanning the full width underneath --- */}
        <line x1="20" y1="178" x2="340" y2="178" stroke={C.line} strokeWidth="1" />
        <text x="20" y="198" fill={C.real} fontSize={F.label} fontWeight="600">
          {labels.reset}
        </text>
      </svg>
    </figure>
  )
}
