import type { ReactNode } from 'react'

/**
 * One section of the player guide.
 *
 * `scroll-mt-24` clears the sticky jump-nav, so a `#hash` link from that nav
 * lands with the heading visible rather than hidden underneath it. That single
 * utility is why the nav needs no scroll listener or IntersectionObserver —
 * native anchors do the whole job.
 */
export function GuideSection({
  id,
  heading,
  children,
}: {
  id: string
  heading: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg font-semibold text-neutral-100">{heading}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-neutral-300">
        {children}
      </div>
    </section>
  )
}

/**
 * A figure with its caption, sized to sit inside the page's card language.
 */
export function GuideFigure({
  children,
  caption,
  note,
}: {
  children: ReactNode
  caption?: string
  note?: string
}) {
  return (
    <div className="my-1 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
      {children}
      {caption && (
        <p className="mt-2 text-xs leading-snug text-neutral-400">{caption}</p>
      )}
      {note && <p className="mt-1 text-[11px] text-neutral-500">{note}</p>}
    </div>
  )
}

/**
 * A callout for the rules you lose by breaking. Reuses the error-box styling
 * already used on the join screen so warnings look the same everywhere.
 */
export function GuideWarning({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm leading-relaxed text-red-200">
      {children}
    </p>
  )
}

/**
 * A highlighted rule that is useful rather than dangerous.
 */
export function GuideNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-sky-900 bg-sky-950/40 px-3 py-2 text-sm leading-relaxed text-sky-100">
      {children}
    </p>
  )
}

/**
 * Collapsible detail. Native <details> so it works without JS, survives
 * find-in-page, and needs no state.
 */
export function GuideDetails({
  summary,
  children,
}: {
  summary: string
  children: ReactNode
}) {
  return (
    <details className="group rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <summary className="cursor-pointer list-none text-sm font-medium text-neutral-200 marker:content-none">
        <span className="inline-block w-4 text-neutral-500 transition group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-2 pl-4 text-sm text-neutral-400">{children}</div>
    </details>
  )
}

/** A big-number chip for the opener's at-a-glance row. */
export function GuideStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900/40 px-2 py-3 text-center">
      <div className="text-base font-semibold text-neutral-100">{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-neutral-500">{label}</div>
    </div>
  )
}
