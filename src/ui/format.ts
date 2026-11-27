import { WEEKDAY_NAME, WEEKDAY_SHORT, WEEKDAYS, type Weekday } from '../domain/types'

/* Small wording helpers shared by all views, so numbers and day lists read the same
   everywhere. */

/** "1 team", "3 teams". Pass the plural when it is not just an added "s". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function inWeekOrder(days: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((d) => days.includes(d))
}

/** "Tue, Thu"; `none` (default "no days") when the list is empty. */
export function daysShort(days: readonly Weekday[], none = 'no days'): string {
  const sorted = inWeekOrder(days)
  return sorted.length === 0 ? none : sorted.map((d) => WEEKDAY_SHORT[d]).join(', ')
}

/** "Tuesday and Thursday"; `none` (default "no days") when the list is empty. */
export function daysLong(days: readonly Weekday[], none = 'no days'): string {
  const sorted = inWeekOrder(days)
  return sorted.length === 0 ? none : joinAnd(sorted.map((d) => WEEKDAY_NAME[d]))
}

/** 0.8 becomes "80%". Rounded down, so 197 of 198 never reads as 100%. */
export function percent(share: number): string {
  return `${Math.floor(share * 100 + 1e-9)}%`
}
