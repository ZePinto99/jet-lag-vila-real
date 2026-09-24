import { cn } from '@/lib/cn'
import { DIAGRAM_COLORS as C, DIAGRAM_FONT as F } from './diagramTokens'

export interface ZoneDiagramLabels {
  /** Accessible description of the whole figure. */
  alt: string
  /** Caption for the shaded blue area, e.g. "Your defense zone". */
  zone: string
  /** Scale-bar caption, e.g. "200 m". */
  scale: string
  /** Legend row 1 — a teammate standing inside your own zone. */
  one: string
  /** Legend row 2 — an enemy who has walked into your zone. */
  two: string
  /** Legend row 3 — you, outside your own zone. */
  three: string
}

/**
 * The single most important diagram in the guide: what a "defense zone"
 * actually is, and how it decides whether you are a defender or a raider.
 *
 * Prose cannot carry this rule. The zone is not a circle around your home base
 * — it is the *union* of 200 m circles around each of your five candidate
 * landmarks, so it is a lumpy blob whose shape depends on picks your team made
 * at setup. Players who imagine one circle get tagging wrong every time.
 *
 * Scale: 50 user units = 200 m, so 1 unit ≈ 4 m.
 *
 * Markers are numbered rather than labelled inline. At 360 px wide there is no
 * room for three leader-lined captions, and numbers stay legible and need no
 * translation — the wording lives in the legend below the drawing.
 */
export function ZoneDiagram({
  labels,
  className,
}: {
  labels: ZoneDiagramLabels
  className?: string
}) {
  // West candidate landmarks. Three is enough to read as a union; drawing all
  // five just muddies the overlaps at this size.
  const west = [
    { x: 78, y: 66 },
    { x: 62, y: 118 },
    { x: 122, y: 104 },
  ]
  const east = { x: 288, y: 96 }
  const R = 50 // 200 m

  return (
    <figure className={cn('m-0', className)}>
      <svg
        viewBox="0 0 360 200"
        className="h-auto w-full"
        role="img"
        aria-label={labels.alt}
      >
        <defs>
          {/* Union of the three circles, so the shared fill paints once and the
              inner arcs do not show through as darker seams. */}
          <mask id="zd-union">
            <rect x="0" y="0" width="360" height="200" fill="black" />
            {west.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={R} fill="white" />
            ))}
          </mask>
        </defs>

        <rect x="0" y="0" width="360" height="200" fill={C.surface} />

        {/* --- Enemy zone, drawn first so it sits under ours --- */}
        <circle
          cx={east.x}
          cy={east.y}
          r={R}
          fill={C.east}
          fillOpacity="0.1"
          stroke={C.east}
          strokeOpacity="0.5"
          strokeWidth="1.25"
          strokeDasharray="4 3"
        />
        <circle cx={east.x} cy={east.y} r="5" fill={C.east} stroke="#fafafa" strokeWidth="1.5" />

        {/* --- Your zone: one fill through the union mask, then each rim --- */}
        <rect
          x="0"
          y="0"
          width="360"
          height="200"
          fill={C.west}
          fillOpacity="0.17"
          mask="url(#zd-union)"
        />
        {west.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={R}
            fill="none"
            stroke={C.west}
            strokeOpacity="0.55"
            strokeWidth="1.25"
            strokeDasharray="4 3"
          />
        ))}
        {west.map((p, i) => (
          <circle
            key={`c${i}`}
            cx={p.x}
            cy={p.y}
            r="5"
            fill={C.west}
            stroke="#fafafa"
            strokeWidth="1.5"
          />
        ))}

        {/* Zone caption, placed in the empty upper-left of the blob */}
        <text
          x="20"
          y="26"
          fill={C.west}
          fontSize={F.label}
          fontWeight="600"
        >
          {labels.zone}
        </text>

        {/* --- Radius scale bar, from a candidate centre to its rim --- */}
        <line
          x1={west[1].x}
          y1={west[1].y}
          x2={west[1].x}
          y2={west[1].y + R}
          stroke={C.labelMuted}
          strokeWidth="1"
        />
        <line
          x1={west[1].x - 3}
          y1={west[1].y + R}
          x2={west[1].x + 3}
          y2={west[1].y + R}
          stroke={C.labelMuted}
          strokeWidth="1"
        />
        <text
          x={west[1].x + 7}
          y={west[1].y + R - 4}
          fill={C.labelMuted}
          fontSize={F.small}
        >
          {labels.scale}
        </text>

        {/* --- Markers --- */}
        {/* 1 — your teammate, inside your own zone → defender */}
        <Marker x={100} y={92} n="1" fill={C.west} />
        {/* 2 — an enemy who has walked into your zone → raider, taggable */}
        <Marker x={142} y={68} n="2" fill={C.east} />
        {/* 3 — you, out on neutral ground beyond your own zone → raider */}
        <Marker x={205} y={140} n="3" fill={C.me} />
      </svg>

      {/*
        The legend is HTML, not SVG <text>. SVG has no line wrapping, and these
        three captions are the longest strings in the figure — in PT-PT they run
        ~22% longer than English and would either overflow the viewBox or have to
        be silently truncated. As HTML they wrap natively at any width and use
        the same type scale as the rest of the page.
      */}
      <figcaption className="mt-3 flex flex-col gap-1.5 px-1">
        <LegendRow n="1" color={C.west} text={labels.one} />
        <LegendRow n="2" color={C.east} text={labels.two} />
        <LegendRow n="3" color={C.me} text={labels.three} />
      </figcaption>
    </figure>
  )
}

/** A numbered player pin. */
function Marker({
  x,
  y,
  n,
  fill,
}: {
  x: number
  y: number
  n: string
  fill: string
}) {
  return (
    <g>
      <circle cx={x} cy={y} r="9" fill={fill} stroke="#fafafa" strokeWidth="2" />
      <text
        x={x}
        y={y + 3.4}
        textAnchor="middle"
        fontSize={F.small}
        fontWeight="700"
        fill="#0a0a0a"
      >
        {n}
      </text>
    </g>
  )
}

/**
 * One legend line as HTML: numbered swatch + caption that wraps natively.
 *
 * The number ties back to the pin of the same colour in the drawing above, so
 * the picture needs no inline prose and stays translation-proof.
 */
function LegendRow({
  n,
  color,
  text,
}: {
  n: string
  color: string
  text: string
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-neutral-950 ring-1 ring-neutral-50"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        {n}
      </span>
      <span className="text-sm leading-snug text-neutral-300">{text}</span>
    </div>
  )
}
