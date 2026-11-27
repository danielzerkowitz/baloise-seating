/** Team colours. Sixteen hues that stay distinct from each other as a tint on a grey
 *  floor plan. Crimson, amber and the status green are left out on purpose: in this tool
 *  those always mean "conflict", "warning" and "fine". */
export const TEAM_COLORS = [
  '#0f8b8d', // teal
  '#e2711d', // orange
  '#2f6fde', // blue
  '#8e4ec6', // violet
  '#3a9d4b', // green
  '#d6409f', // pink
  '#7a5c3e', // brown
  '#00a3d7', // sky
  '#8ab317', // lime
  '#5a55d2', // indigo
  '#e58f7b', // coral
  '#5e8c7b', // sage
  '#b56576', // rose
  '#6d7f99', // slate
  '#9a8c1f', // olive
  '#3f6c8f', // steel
] as const

const INK = '#16233b'
const WHITE = '#ffffff'
const BLACK = '#000000'

/** The contrast small text needs against its background to be readable (WCAG AA). */
const READABLE_CONTRAST = 4.5

/** Returns '#rrggbb' in lower case, or null when the input is not a hex colour. */
export function normalizeHex(input: string): string | null {
  const s = input.trim().toLowerCase()
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const long = /^#?([0-9a-f]{6})$/.exec(s)
  return long ? `#${long[1]}` : null
}

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance, 0 (black) to 1 (white). Unknown input counts as mid grey. */
export function luminance(hex: string): number {
  const n = normalizeHex(hex)
  if (!n) return 0.5
  const r = parseInt(n.slice(1, 3), 16)
  const g = parseInt(n.slice(3, 5), 16)
  const b = parseInt(n.slice(5, 7), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The text colour that reads best on the given background: white or ink. On the mid-tones
 *  where neither of the two is readable (five of the team colours are among them) it is
 *  black, which is readable on all of those. */
export function readableInk(background: string): string {
  const onWhite = contrast(background, WHITE)
  const onInk = contrast(background, INK)
  if (Math.max(onWhite, onInk) < READABLE_CONTRAST) return BLACK
  return onWhite >= onInk ? WHITE : INK
}

/** The palette colour used least so far; ties go to the earlier palette entry. */
export function nextTeamColor(used: readonly string[]): string {
  const counts = new Map<string, number>(TEAM_COLORS.map((c) => [c, 0]))
  for (const u of used) {
    const n = normalizeHex(u)
    if (n && counts.has(n)) counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  let best: string = TEAM_COLORS[0]
  let bestCount = Number.POSITIVE_INFINITY
  for (const c of TEAM_COLORS) {
    const k = counts.get(c) ?? 0
    if (k < bestCount) {
      best = c
      bestCount = k
    }
  }
  return best
}

/** Inline style for anything painted in a team's colour (chips, swatches, zones). */
export function teamStyle(color: string): Record<'--team' | '--team-ink', string> {
  const c = normalizeHex(color) ?? TEAM_COLORS[0]
  return { '--team': c, '--team-ink': readableInk(c) }
}
