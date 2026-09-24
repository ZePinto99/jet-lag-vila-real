/**
 * Greedy word wrap for SVG <text>, which has no automatic wrapping.
 *
 * The guide's diagrams take their captions as props so they can be translated,
 * and PT-PT strings run roughly 20% longer than their English counterparts — so
 * every caption that sits inside a fixed-width shape has to be wrapped rather
 * than assumed to fit.
 *
 * @param text     the caption to break up
 * @param max      soft character budget per line; a single over-long word is
 *                 never split, it just overflows its line
 * @param maxLines lines beyond this are dropped, so a runaway translation
 *                 cannot push the drawing out of its viewBox
 */
export function wrapText(text: string, max: number, maxLines = 3): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (next.length > max && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, maxLines)
}
