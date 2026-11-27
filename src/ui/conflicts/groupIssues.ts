import { SEVERITY_ORDER, type Issue, type IssueRule, type Severity } from '../../domain/conflicts'
import { WEEKDAYS, type Id, type Weekday } from '../../domain/types'

/* The engine reports an issue per day. To the planner, "NE 1 is over capacity" on Tuesday
   and again on Thursday is one thing to look at, so the list shows it as one row that names
   both days. */

export interface IssueRow {
  /** The issue id without its day: `rule|floorId|areaId|teamIds`. It stays the same while
   *  days come and go, so a row keeps its place and its open state. Unique within one list. */
  key: string
  severity: Severity
  rule: IssueRule
  /** The same problem on each of its days, in week order; an issue without a day comes
   *  last. Never empty. */
  issues: [Issue, ...Issue[]]
  /** The days the row covers, in week order. Empty when the problem is not tied to a day. */
  days: Weekday[]
  floorId: Id | null
  areaId: Id | null
  teamIds: Id[]
}

function rowKey(issue: Issue): string {
  return [issue.rule, issue.floorId ?? '-', issue.areaId ?? '-', issue.teamIds.join('+') || '-'].join('|')
}

/** Position in the week; an issue without a day sorts after Friday. */
function dayPosition(day: Weekday | null): number {
  return day === null ? WEEKDAYS.length : WEEKDAYS.indexOf(day)
}

/** One row for each problem: issues with the same rule, teams, area and floor are the same
 *  problem on several days. Rows are ordered most serious first, then by their first day
 *  (rows without a day last), then in the order the issues came. */
export function groupIssues(issues: readonly Issue[]): IssueRow[] {
  // A Map keeps its keys in the order they were added: the order the issues came in.
  const byKey = new Map<string, IssueRow>()
  for (const issue of issues) {
    const key = rowKey(issue)
    const row = byKey.get(key)
    if (row) {
      row.issues.push(issue)
    } else {
      byKey.set(key, {
        key,
        severity: issue.severity,
        rule: issue.rule,
        issues: [issue],
        days: [],
        floorId: issue.floorId,
        areaId: issue.areaId,
        teamIds: issue.teamIds,
      })
    }
  }

  const rows = [...byKey.values()]
  for (const row of rows) {
    row.issues.sort((a, b) => dayPosition(a.day) - dayPosition(b.day))
    row.days = WEEKDAYS.filter((day) => row.issues.some((issue) => issue.day === day))
  }
  // Sorting is stable, so rows that tie on level and first day stay in the order they came.
  return rows.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      dayPosition(a.issues[0].day) - dayPosition(b.issues[0].day),
  )
}

/** The rows that cover `day` first, then the others; both parts keep their order. */
export function putDayFirst(rows: readonly IssueRow[], day: Weekday): IssueRow[] {
  return [...rows.filter((row) => row.days.includes(day)), ...rows.filter((row) => !row.days.includes(day))]
}

/** The issue a row is presented with: the one for `day` when the row covers that day,
 *  otherwise its first. */
export function leadIssue(row: IssueRow, day?: Weekday): Issue {
  return row.issues.find((issue) => issue.day === day) ?? row.issues[0]
}
