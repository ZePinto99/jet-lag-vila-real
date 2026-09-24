/**
 * Sticky jump-nav for the player guide.
 *
 * Plain anchor links, deliberately: the guide doubles as a mid-game lookup, and
 * a horizontally scrollable pill row plus `scroll-mt-24` on each section gets
 * that with no scroll listener, no IntersectionObserver and no active-state
 * bookkeeping to go stale. It also keeps working with JS disabled.
 *
 * No smooth scrolling — an instant jump is what you want when you are settling
 * an argument on a street corner, and it respects reduced-motion for free.
 */
export function GuideNav({
  label,
  items,
}: {
  /** Accessible name for the nav, e.g. "Jump to". */
  label: string
  items: Array<{ id: string; label: string }>
}) {
  return (
    <nav
      aria-label={label}
      className="sticky top-0 z-20 -mx-6 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur"
    >
      <ul className="flex gap-2 overflow-x-auto px-6 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="block whitespace-nowrap rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-50"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
