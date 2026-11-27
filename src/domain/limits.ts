/* The bounds that values of a plan are kept within. One place for all of them: the reducer
   applies them when something is typed, `normalizeProject` when a plan is read back, and the
   fields in the views stop at the same numbers. If they differed, a value the planner typed
   would change the next time the plan is opened. */

export const LIMITS = {
  /** Names of plans, floors, areas and teams. */
  name: 120,
  /** Names of domains and ARTs. */
  orgName: 60,
  notes: 2000,
  /** A team's short code on the plan. */
  code: 4,
  /** A floor's sign. */
  label: 3,
  /** People in one team. */
  teamSize: 5000,
  /** Seats of one area, and seats one team holds in one area. */
  seats: 1000,
  /** The planner's reason for accepting a warning. */
  acceptNote: 500,
  /** An issue's detail text as stored with an acceptance. Generated texts stay far below. */
  acceptDetail: 5000,
} as const

/** Text as it may be stored: without the characters a database or a file cannot hold (NUL
 *  and other control characters except tab and line breaks) and without half surrogate
 *  pairs, which would show as broken characters and are refused by Postgres. */
export function cleanText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

/** `cleanText`, cut to `max` characters without splitting a surrogate pair. */
export function boundedText(text: string, max: number): string {
  const clean = cleanText(text)
  if (clean.length <= max) return clean
  const last = clean.charCodeAt(max - 1)
  return clean.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)
}
