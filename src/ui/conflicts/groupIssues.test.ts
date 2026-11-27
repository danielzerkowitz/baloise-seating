import { describe, expect, it } from 'vitest'
import { RULE_SEVERITY, type Issue, type IssueRule } from '../../domain/conflicts'
import type { Weekday } from '../../domain/types'
import { groupIssues, leadIssue, putDayFirst } from './groupIssues'

/** An issue as the engine would report it, with the id scheme of conflicts.ts. */
function issue(
  rule: IssueRule,
  day: Weekday | null,
  where: { teamIds?: string[]; areaId?: string; floorId?: string } = {},
): Issue {
  const teamIds = where.teamIds ?? []
  const areaId = where.areaId ?? null
  const floorId = where.floorId ?? null
  return {
    id: [rule, day ?? '-', floorId ?? '-', areaId ?? '-', teamIds.join('+') || '-'].join('|'),
    rule,
    severity: RULE_SEVERITY[rule],
    day,
    floorId,
    areaId,
    teamIds,
    title: `${rule} on ${day ?? 'no day'}`,
    detail: `numbers of ${rule} on ${day ?? 'no day'}`,
  }
}

describe('groupIssues: merging', () => {
  it('makes one row of the same problem on several days, in week order', () => {
    const thu = issue('area-over-capacity', 'thu', { floorId: 'f1', areaId: 'a1', teamIds: ['alpha', 'beta'] })
    const tue = issue('area-over-capacity', 'tue', { floorId: 'f1', areaId: 'a1', teamIds: ['alpha', 'beta'] })

    const rows = groupIssues([thu, tue])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      key: 'area-over-capacity|f1|a1|alpha+beta',
      severity: 'error',
      rule: 'area-over-capacity',
      issues: [tue, thu],
      days: ['tue', 'thu'],
      floorId: 'f1',
      areaId: 'a1',
      teamIds: ['alpha', 'beta'],
    })
  })

  it('keeps an issue that is not tied to a day as a row without days', () => {
    const idle = issue('no-team-days', null, { teamIds: ['alpha'] })

    const rows = groupIssues([idle])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.days).toEqual([])
    expect(rows[0]?.issues).toEqual([idle])
    expect(rows[0]?.key).toBe('no-team-days|-|-|alpha')
  })

  it('does not merge different rules, teams, areas or floors', () => {
    const base = { floorId: 'f1', areaId: 'a1', teamIds: ['alpha'] }
    const rows = groupIssues([
      issue('team-scattered', 'tue', base),
      issue('off-home-floor', 'thu', base),
      issue('team-scattered', 'thu', { ...base, teamIds: ['beta'] }),
      issue('team-scattered', 'thu', { ...base, teamIds: ['alpha', 'beta'] }),
      issue('team-scattered', 'thu', { ...base, areaId: 'a2' }),
      issue('team-scattered', 'thu', { ...base, floorId: 'f2' }),
    ])

    expect(rows).toHaveLength(6)
    expect(new Set(rows.map((row) => row.key)).size).toBe(6)
    for (const row of rows) expect(row.issues).toHaveLength(1)
  })

  it('gives a row the same key whichever of its days are present', () => {
    const where = { floorId: 'f1', areaId: 'a1', teamIds: ['alpha'] }
    const both = groupIssues([issue('area-over-capacity', 'tue', where), issue('area-over-capacity', 'thu', where)])
    const one = groupIssues([issue('area-over-capacity', 'thu', where)])

    expect(one[0]?.key).toBe(both[0]?.key)
  })
})

describe('groupIssues: order', () => {
  it('puts the most serious level first, whatever order the issues came in', () => {
    const rows = groupIssues([
      issue('no-team-days', null, { teamIds: ['alpha'] }),
      issue('wish-unmet', 'mon', { teamIds: ['alpha'] }),
      issue('team-unseated', 'mon', { teamIds: ['alpha'] }),
      issue('area-over-capacity', 'fri', { floorId: 'f1', areaId: 'a1' }),
    ])

    expect(rows.map((row) => row.severity)).toEqual(['error', 'todo', 'warning', 'info'])
  })

  it('orders rows of one level by their first day, with rows without a day last', () => {
    const rows = groupIssues([
      issue('no-team-days', null, { teamIds: ['alpha'] }),
      issue('seat-differs', 'fri', { teamIds: ['alpha'] }),
      issue('team-over-seated', 'thu', { teamIds: ['beta'] }),
      // Arrives with Thursday, but its first day turns out to be Monday.
      issue('team-scattered', 'thu', { floorId: 'f1', teamIds: ['gamma'] }),
      issue('team-scattered', 'mon', { floorId: 'f1', teamIds: ['gamma'] }),
    ])

    expect(rows.map((row) => row.rule)).toEqual(['team-scattered', 'team-over-seated', 'seat-differs', 'no-team-days'])
  })

  it('keeps rows that tie in the order their issues came', () => {
    const rows = groupIssues([
      issue('seats-in-room', 'tue', { floorId: 'f1', areaId: 'room', teamIds: ['beta'] }),
      issue('area-over-capacity', 'tue', { floorId: 'f1', areaId: 'a2' }),
      issue('area-over-capacity', 'tue', { floorId: 'f1', areaId: 'a1' }),
    ])

    expect(rows.map((row) => row.key)).toEqual([
      'seats-in-room|f1|room|beta',
      'area-over-capacity|f1|a2|-',
      'area-over-capacity|f1|a1|-',
    ])
  })
})

describe('putDayFirst', () => {
  it('moves the rows that cover the day to the front and keeps both parts in order', () => {
    const rows = groupIssues([
      issue('area-over-capacity', 'mon', { floorId: 'f1', areaId: 'a1' }),
      issue('area-over-capacity', 'tue', { floorId: 'f1', areaId: 'a2' }),
      issue('area-over-capacity', 'tue', { floorId: 'f1', areaId: 'a3' }),
      issue('area-over-capacity', 'thu', { floorId: 'f1', areaId: 'a3' }),
      issue('area-over-capacity', 'thu', { floorId: 'f1', areaId: 'a4' }),
      issue('day-over-capacity', 'fri'),
    ])
    expect(rows.map((row) => row.areaId)).toEqual(['a1', 'a2', 'a3', 'a4', null])

    expect(putDayFirst(rows, 'thu').map((row) => row.areaId)).toEqual(['a3', 'a4', 'a1', 'a2', null])
  })

  it('changes nothing when no row covers the day', () => {
    const rows = groupIssues([
      issue('area-over-capacity', 'mon', { floorId: 'f1', areaId: 'a1' }),
      issue('no-team-days', null, { teamIds: ['alpha'] }),
    ])

    expect(putDayFirst(rows, 'wed')).toEqual(rows)
  })
})

describe('leadIssue', () => {
  const where = { floorId: 'f1', areaId: 'a1', teamIds: ['alpha'] }
  const tue = issue('area-over-capacity', 'tue', where)
  const thu = issue('area-over-capacity', 'thu', where)
  const [row] = groupIssues([tue, thu])

  it('is the issue of the given day when the row covers it', () => {
    expect(row && leadIssue(row, 'thu')).toBe(thu)
  })

  it('is the first issue when the row does not cover the day, or no day is given', () => {
    expect(row && leadIssue(row, 'wed')).toBe(tue)
    expect(row && leadIssue(row)).toBe(tue)
  })
})
