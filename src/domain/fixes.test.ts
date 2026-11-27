/* Tests for the one-click fixes. How to read this file: after the helpers, one `describe`
   per rule or family of rules. Each has a plan in which a fix is offered, with its label,
   explanation and action checked and the plan looked at after the click, next to the plans
   in which no fix may be offered. Every fix in this file is fetched with `fixesFor`, which
   also checks that the fix keeps its promise. At the end: what holds for every result, a
   plan in which every rule fires, and random offices. */

import { describe, expect, it } from 'vitest'
import { autoSeat } from './autoseat'
import { RULE_SEVERITY, findIssues, type Issue, type IssueRule } from './conflicts'
import { suggestDayMoves } from './dayMoves'
import { suggestFixes, type Fix } from './fixes'
import { dayLoad, dayOccupancy, sameSeating, sumSeats, teamDayStatus, type TeamDayStatus } from './model'
import { reduce, settleSeating } from './reducer'
import { area, floor, project, row, team, violations } from './testkit'
import {
  WEEKDAYS,
  type Area,
  type DayWish,
  type Floor,
  type Project,
  type Seating,
  type Settings,
  type Team,
  type Weekday,
} from './types'

// ---------------------------------------------------------------------------
// A small building and helpers to test with
// ---------------------------------------------------------------------------

/** Desk clusters side by side with ids ne1, ne2, ... and names "NE 1", "NE 2", ... Clusters
 *  next to each other are neighbours on the plan, clusters with one in between are not. */
function deskRow(prefix: string, count: number, capacity: number, y = 0.1): Area[] {
  return Array.from({ length: count }, (_, i) =>
    area(`${prefix}${i + 1}`, capacity, {
      name: `${prefix.toUpperCase()} ${i + 1}`,
      rect: { x: 0.05 + i * 0.11, y, w: 0.1, h: 0.2 },
    }),
  )
}

/** Floor 4: desk clusters NE 1 to NE 4 with 4 desks each, a touchdown bench with 3 overflow
 *  seats that runs along the whole row and a meeting room. 16 desks, 3 overflow seats. */
function floor4(): Floor {
  return floor('4', [
    ...deskRow('ne', 4, 4),
    area('bench', 3, { kind: 'overflow', name: 'Touchdown bench', rect: { x: 0.05, y: 0.32, w: 0.43, h: 0.1 } }),
    area('room', 8, { kind: 'no-seating', name: 'Meeting room 4.1', rect: { x: 0.7, y: 0.1, w: 0.2, h: 0.3 } }),
  ])
}

/** Floor 3, one floor down: desk clusters SW 1 to SW 3 with 4 desks each. 12 desks. */
function floor3(): Floor {
  return floor('3', deskRow('sw', 3, 4))
}

/** One floor with five areas of four desks, A to E, and nothing else: 20 desks. For the
 *  tests about days, where only the numbers matter. */
function office(teams: Team[], settings: Partial<Settings> = {}): Project {
  return project([floor('4', row(['a', 'b', 'c', 'd', 'e'], 4))], teams, settings)
}

type TeamOptions = Parameters<typeof team>[4]

/** The team most examples are about. */
function claims(size: number, days: readonly Weekday[], seating: Seating = {}, options: TeamOptions = {}): Team {
  return team('claims', size, days, seating, { name: 'Claims Intake', ...options })
}

/** A second team to share a plan with. */
function under(size: number, days: readonly Weekday[], seating: Seating = {}, options: TeamOptions = {}): Team {
  return team('under', size, days, seating, { name: 'Underwriting', ...options })
}

/** A team that is only there to keep seats taken: as many people as it holds seats. */
function holder(id: string, days: readonly Weekday[], seating: Seating): Team {
  return team(id, sumSeats(seating), days, seating)
}

/** What a team said about the week; days that are not mentioned were not asked about. */
function wishes(said: Partial<Record<Weekday, DayWish>>): Record<Weekday, DayWish> {
  return { mon: 'none', tue: 'none', wed: 'none', thu: 'none', fri: 'none', ...said }
}

/** The team with other wishes than "wants its team days, was not asked about the rest". */
function saying(who: Team, said: Partial<Record<Weekday, DayWish>>): Team {
  return { ...who, wishes: { ...who.wishes, ...said } }
}

const NOWHERE_ELSE: Partial<Record<Weekday, DayWish>> = { mon: 'cannot', wed: 'cannot', thu: 'cannot', fri: 'cannot' }

function ids(issues: readonly Issue[]): string[] {
  return issues.map((issue) => issue.id)
}

function issueOf(p: Project, id: string): Issue {
  const issues = findIssues(p)
  const found = issues.find((issue) => issue.id === id)
  if (!found) throw new Error(`no issue "${id}" among ${JSON.stringify(ids(issues))}`)
  return found
}

function teamOf(p: Project, id: string): Team {
  const found = p.teams.find((t) => t.id === id)
  if (!found) throw new Error(`no team ${id}`)
  return found
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

const DAY_RULES: readonly IssueRule[] = ['day-over-capacity', 'day-needs-overflow', 'day-uses-reserve']

/** The conflicts of a plan with the number of seats each is about, worked out from the data
 *  model and not with `findIssues`: seats held beyond what an area has, seats placed in a
 *  room, seats a day needs beyond the desks and overflow seats of the building. */
function conflictsOf(p: Project): Map<string, number> {
  const conflicts = new Map<string, number>()
  for (const day of WEEKDAYS) {
    for (const occupancy of dayOccupancy(p, day).values()) {
      const { area: place, used } = occupancy
      if (place.kind === 'no-seating') {
        for (const { teamId, seats } of occupancy.teams) conflicts.set(`${teamId} in room ${place.id} on ${day}`, seats)
      } else if (used > place.capacity) {
        conflicts.set(`${place.id} over capacity on ${day}`, used - place.capacity)
      }
    }
    const { needed, capacity } = dayLoad(p, day)
    if (needed > capacity.desks + capacity.overflow) {
      conflicts.set(`${day} cannot fit`, needed - capacity.desks - capacity.overflow)
    }
  }
  return conflicts
}

/** How many of the seats a team needs on a day it also holds. */
function seatsCovered(p: Project, t: Team, day: Weekday): number {
  const status = teamDayStatus(p, t, day)
  return Math.min(status.seated, status.needed)
}

/** Applies a fix and checks the promise that comes with every fix: the plan stays sound,
 *  the issue is gone (for a day that is too full: the day needs fewer seats), no conflict is
 *  new or bigger, no team holds fewer of the seats it needs, and no day got fuller than the
 *  building has desks. `where` says in a failure which plan and issue it was. */
function expectPromiseKept(p: Project, issue: Issue, fix: Fix, where: string): void {
  const what = `${where}: "${fix.label}"`
  const result = reduce(p, fix.action)
  expect(result, what).not.toBe(p)
  expect(violations(result), what).toEqual([])

  if (issue.day !== null && DAY_RULES.includes(issue.rule)) {
    // A day that is too full keeps its issue (and its id) until it fits; every seat less
    // is the help that was promised.
    expect(dayLoad(result, issue.day).needed, what).toBeLessThan(dayLoad(p, issue.day).needed)
  } else {
    expect(ids(findIssues(result)), what).not.toContain(issue.id)
  }

  const conflictsBefore = conflictsOf(p)
  for (const [conflict, seats] of conflictsOf(result)) {
    expect(seats, `${what}: ${conflict}`).toBeLessThanOrEqual(conflictsBefore.get(conflict) ?? 0)
  }
  for (const now of result.teams) {
    const was = teamOf(p, now.id)
    for (const day of now.days) {
      const seats = `${what}: seats of ${now.id} on ${day}`
      expect(seatsCovered(result, now, day), seats).toBeGreaterThanOrEqual(seatsCovered(p, was, day))
    }
    // And over the week: a team that moved to another day arrives with the seats it had.
    if (now.days.length === was.days.length) {
      const overTheWeek = (plan: Project, team: Team) =>
        team.days.reduce((sum, day) => sum + seatsCovered(plan, team, day), 0)
      expect(overTheWeek(result, now), `${what}: seats of ${now.id} over the week`).toBeGreaterThanOrEqual(
        overTheWeek(p, was),
      )
    }
  }
  for (const day of WEEKDAYS) {
    const load = dayLoad(result, day)
    if (load.needed > dayLoad(p, day).needed) {
      expect(load.needed, `${what}: seats needed on ${day}`).toBeLessThanOrEqual(load.capacity.desks)
    }
  }
}

/** The fixes for one issue of a plan, after checking what must hold for EVERY result: the
 *  input is left alone, the same question gets the same answer, there are at most three
 *  fixes, each with an id of its own and texts in the set form, and each keeps its promise.
 *  `where` says in a failure which plan it was, when the issue id is not enough. */
function fixesFor(p: Project, issueId: string, where = issueId): Fix[] {
  expect(violations(p), where).toEqual([])
  const issue = issueOf(p, issueId)
  const before = structuredClone(p)
  // Frozen, so that any attempt to write to the input throws.
  const fixes = suggestFixes(deepFreeze(p), deepFreeze(issue))
  expect(p, where).toStrictEqual(before)
  expect(suggestFixes(structuredClone(before), structuredClone(issue)), where).toStrictEqual(fixes)

  expect(fixes.length, where).toBeLessThanOrEqual(3)
  expect(new Set(fixes.map((fix) => fix.id)).size, where).toBe(fixes.length)
  for (const fix of fixes) {
    for (const text of [fix.label, fix.explanation]) {
      // A sentence that starts with a capital and has no full stop, with nothing left blank.
      expect(text, where).toMatch(/^[A-Z].*[^.\s]$/)
      expect(text, where).not.toMatch(/undefined|null|NaN| {2}/)
      expect(text, where).not.toMatch(/(^|[^0-9])1 seats|(^|[^0-9])(0|[2-9]|[0-9]{2,}) seat( |$)/)
    }
    expectPromiseKept(p, issue, fix, where)
  }
  return fixes
}

/** The one fix of a list. */
function only(fixes: readonly Fix[]): Fix {
  const [fix] = fixes
  if (!fix || fixes.length !== 1) throw new Error(`expected one fix, got ${JSON.stringify(fixes.map((f) => f.label))}`)
  return fix
}

/** The fix of a list that has the given label. */
function labelled(fixes: readonly Fix[], label: string): Fix {
  const found = fixes.find((fix) => fix.label === label)
  if (!found) throw new Error(`no fix "${label}" among ${JSON.stringify(fixes.map((f) => f.label))}`)
  return found
}

function apply(p: Project, fix: Fix): Project {
  return reduce(p, fix.action)
}

/** The ids of the issues that are left after a fix. */
function idsAfter(p: Project, fix: Fix): string[] {
  return ids(findIssues(apply(p, fix)))
}

/** How a team is seated on a day of a plan. */
function seatedOn(p: Project, teamId: string, day: Weekday): TeamDayStatus {
  return teamDayStatus(p, teamOf(p, teamId), day)
}

/** The plan as automatic seating would leave it after seating one team from scratch. Where
 *  no fix may be offered, this shows what the fix would have been. */
function reseated(p: Project, teamId: string): Project {
  return autoSeat(p, { teamIds: [teamId], restart: true }).project
}

/** The fix that gives a team what automatic seating proposes for it alone: the seats it
 *  misses on top of those it holds, or with `restart` a place found from scratch. */
function seatingFix(p: Project, teamId: string, label: string, options: { restart: boolean }): Fix {
  const result = autoSeat(p, { teamIds: [teamId], restart: options.restart })
  const proposed = teamOf(result.project, teamId)
  const outcome = result.outcomes.find((each) => each.teamId === teamId)
  if (!outcome) throw new Error(`no outcome for ${teamId}`)
  return {
    id: `seat/replace|${teamId}`,
    label,
    explanation: outcome.message,
    action: { type: 'seat/replace', teamId, seating: proposed.seating, daySeating: proposed.daySeating },
  }
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

describe('area-over-capacity', () => {
  it('offers to reseat either team, the one with the fewest seats there first', () => {
    const p = project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 4 }), under(2, ['tue'], { ne1: 2 })])
    const fixes = fixesFor(p, 'area-over-capacity|tue|-|ne1|-')
    expect(fixes).toEqual([
      seatingFix(p, 'under', 'Reseat Underwriting', { restart: true }),
      seatingFix(p, 'claims', 'Reseat Claims Intake', { restart: true }),
    ])
    expect(fixes.map((fix) => fix.id)).toEqual(['seat/replace|under', 'seat/replace|claims'])
    // What the planner reads: where the team goes.
    expect(fixes.map((fix) => fix.explanation)).toEqual(['Seated in NE 2 on Floor 4', 'Seated in NE 2 on Floor 4'])
    for (const fix of fixes) expect(idsAfter(p, fix)).toEqual([])
    // The other team stays where it is.
    expect(teamOf(apply(p, labelled(fixes, 'Reseat Underwriting')), 'claims')).toBe(teamOf(p, 'claims'))
    expect(teamOf(apply(p, labelled(fixes, 'Reseat Claims Intake')), 'under')).toBe(teamOf(p, 'under'))
  })

  it('takes teams with equally many seats in list order', () => {
    const p = project([floor4()], [team('first', 3, ['tue'], { ne1: 3 }), team('second', 3, ['tue'], { ne1: 3 })])
    const fixes = fixesFor(p, 'area-over-capacity|tue|-|ne1|-')
    expect(fixes.map((fix) => fix.label)).toEqual(['Reseat First', 'Reseat Second'])
  })

  it('tries two teams at most', () => {
    // Any of the three could make room for the other two.
    const p = project([floor4()], ['one', 'two', 'three'].map((id) => team(id, 2, ['tue'], { ne1: 2 })))
    const fixes = fixesFor(p, 'area-over-capacity|tue|-|ne1|-')
    expect(fixes.map((fix) => fix.label)).toEqual(['Reseat One', 'Reseat Two'])
  })

  it('only tries a team whose leaving brings the area back within its seats', () => {
    // Six seats taken in an area for four: one of the small teams leaving is not enough.
    const p = project(
      [floor4()],
      [team('one', 1, ['tue'], { ne1: 1 }), team('two', 1, ['tue'], { ne1: 1 }), team('four', 4, ['tue'], { ne1: 4 })],
    )
    const fix = only(fixesFor(p, 'area-over-capacity|tue|-|ne1|-'))
    expect(fix).toEqual(seatingFix(p, 'four', 'Reseat Four', { restart: true }))
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('offers nothing when no single team can solve it by leaving', () => {
    // Three teams of two in an area for two: whoever leaves, four seats are still taken.
    const small = floor('4', [area('nook', 2, { name: 'Nook' }), ...deskRow('ne', 3, 4, 0.5)])
    const p = project([small], ['one', 'two', 'three'].map((id) => team(id, 2, ['tue'], { nook: 2 })))
    expect(fixesFor(p, 'area-over-capacity|tue|-|nook|-')).toEqual([])
  })

  it('offers nothing when there is no other place', () => {
    const oneArea = floor('4', deskRow('ne', 1, 4))
    const p = project([oneArea], [claims(4, ['tue'], { ne1: 4 }), under(2, ['tue'], { ne1: 2 })])
    expect(fixesFor(p, 'area-over-capacity|tue|-|ne1|-')).toEqual([])
  })

  it('does not reseat a team that would then lack seats on another of its days', () => {
    // Underwriting has no seats on Thursday yet, and Thursday is full. Seating it from
    // scratch would solve Tuesday and still leave Thursday open.
    const twoAreas = floor('4', deskRow('ne', 2, 4))
    const plan = (thursday: Team[]) =>
      project(
        [twoAreas],
        [
          claims(4, ['tue'], { ne1: 4 }),
          under(2, ['tue', 'thu'], { ne1: 2 }, { daySeating: { thu: {} } }),
          ...thursday,
        ],
      )
    const full = plan([holder('x', ['thu'], { ne1: 4 }), holder('y', ['thu'], { ne2: 4 })])
    expect(fixesFor(full, 'area-over-capacity|tue|-|ne1|-').map((fix) => fix.label)).toEqual([
      'Reseat Claims Intake',
    ])
    // With room on Thursday the team is offered first, as the one with the fewest seats.
    const room = plan([holder('x', ['thu'], { ne1: 4 })])
    expect(fixesFor(room, 'area-over-capacity|tue|-|ne1|-').map((fix) => fix.label)).toEqual([
      'Reseat Underwriting',
      'Reseat Claims Intake',
    ])
  })

  it('reseats a team that overfills an area on its own', () => {
    const p = project([floor4()], [claims(6, ['tue'], { ne1: 6 })])
    const fix = only(fixesFor(p, 'area-over-capacity|tue|-|ne1|-'))
    expect(fix.label).toBe('Reseat Claims Intake')
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('finds desks for a team from an overflow area that is too full', () => {
    // Four seats taken on a bench for three.
    const p = project([floor4()], [claims(2, ['tue'], { bench: 2 }), under(2, ['tue'], { bench: 2 })])
    const fixes = fixesFor(p, 'area-over-capacity|tue|-|bench|-')
    expect(fixes.map((fix) => fix.label)).toEqual(['Reseat Claims Intake', 'Reseat Underwriting'])
    const atDesks = { inDesks: 2, inOverflow: 0 }
    expect(seatedOn(apply(p, labelled(fixes, 'Reseat Claims Intake')), 'claims', 'tue')).toMatchObject(atDesks)
    expect(seatedOn(apply(p, labelled(fixes, 'Reseat Underwriting')), 'under', 'tue')).toMatchObject(atDesks)
  })
})

describe('seats-in-room', () => {
  it('offers to take the seats out of the room', () => {
    const p = project([floor4()], [under(3, ['tue'], { room: 3 })])
    const fix = only(fixesFor(p, 'seats-in-room|tue|-|room|under'))
    expect(fix).toEqual({
      id: 'seat/set|under|room',
      label: 'Remove these seats',
      explanation: "Takes Underwriting's 3 seats out of Meeting room 4.1",
      action: { type: 'seat/set', teamId: 'under', areaId: 'room', seats: 0, scope: 'all' },
    })
    // The conflict is gone; that the team still needs seats was true before as well.
    expect(idsAfter(p, fix)).toEqual(['team-unseated|tue|-|-|under'])
  })

  it('takes them out of the normal seating, so on every day that uses it', () => {
    const p = project([floor4()], [under(3, ['tue', 'thu'], { ne1: 3, room: 1 })])
    expect(ids(findIssues(p))).toEqual(['seats-in-room|tue|-|room|under', 'seats-in-room|thu|-|room|under'])
    const fix = only(fixesFor(p, 'seats-in-room|thu|-|room|under'))
    expect(fix.explanation).toBe("Takes Underwriting's 1 seat out of Meeting room 4.1")
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('takes them out of one room at a time', () => {
    const twoRooms = floor('4', [
      ...deskRow('ne', 2, 4),
      area('room1', 8, { kind: 'no-seating', name: 'Meeting room 4.1' }),
      area('room2', 6, { kind: 'no-seating', name: 'Meeting room 4.2' }),
    ])
    const p = project([twoRooms], [under(4, ['tue'], { ne1: 2, room1: 1, room2: 1 })])
    const fix = only(fixesFor(p, 'seats-in-room|tue|-|room2|under'))
    expect(fix.id).toBe('seat/set|under|room2')
    expect(fix.explanation).toBe("Takes Underwriting's 1 seat out of Meeting room 4.2")
    expect(idsAfter(p, fix)).toEqual(['seats-in-room|tue|-|room1|under', 'team-short|tue|-|-|under'])
  })

  it('takes them out of the day exception when the team has one on that day', () => {
    const p = project([floor4()], [under(3, ['tue', 'thu'], { ne1: 3 }, { daySeating: { tue: { ne1: 2, room: 1 } } })])
    const fix = only(fixesFor(p, 'seats-in-room|tue|-|room|under'))
    expect(fix.action).toEqual({ type: 'seat/set', teamId: 'under', areaId: 'room', seats: 0, scope: 'tue' })
    // The seats that are counted are those of the day as well.
    expect(fix.explanation).toBe("Takes Underwriting's 1 seat out of Meeting room 4.1")
    expect(teamOf(apply(p, fix), 'under')).toMatchObject({ seating: { ne1: 3 }, daySeating: { tue: { ne1: 2 } } })
  })
})

describe('day-over-capacity, day-needs-overflow and day-uses-reserve', () => {
  it('offers the moves that suggestDayMoves finds, in its order', () => {
    // 22 seats needed on 20 desks.
    const p = office([team('alpha', 12, ['tue']), team('beta', 10, ['tue', 'thu']), team('gamma', 3, ['mon'])])
    const fixes = fixesFor(p, 'day-over-capacity|tue|-|-|-')
    expect(fixes).toEqual([
      {
        id: 'team/moveDay|beta|wed',
        label: 'Move Beta to Wednesday',
        explanation: 'Wednesday has 20 desks free; Beta was not asked about Wednesday yet. Ask the team first',
        action: { type: 'team/moveDay', id: 'beta', from: 'tue', to: 'wed' },
      },
      {
        id: 'team/moveDay|alpha|wed',
        label: 'Move Alpha to Wednesday',
        explanation: 'Wednesday has 20 desks free; Alpha was not asked about Wednesday yet. Ask the team first',
        action: { type: 'team/moveDay', id: 'alpha', from: 'tue', to: 'wed' },
      },
    ])
    const moves = suggestDayMoves(p, 'tue', 3)
    expect(fixes.map((fix) => fix.action)).toEqual(
      moves.map(({ teamId, from, to }) => ({ type: 'team/moveDay', id: teamId, from, to })),
    )
    for (const fix of fixes) {
      const moved = apply(p, fix)
      expect(dayLoad(moved, 'tue').level).toBe('fits')
      expect(dayLoad(moved, 'wed').level).toBe('fits')
    }
  })

  it('says "ask the team first" only for a day the team said nothing about', () => {
    const p = office([saying(team('alpha', 12, ['tue']), { wed: 'can' }), team('beta', 10, ['tue'])])
    const fixes = fixesFor(p, 'day-over-capacity|tue|-|-|-')
    expect(fixes.map((fix) => [fix.label, fix.explanation])).toEqual([
      ['Move Alpha to Wednesday', 'Wednesday has 20 desks free and Alpha said it could come then'],
      ['Move Beta to Monday', 'Monday has 20 desks free; Beta was not asked about Monday yet. Ask the team first'],
    ])
  })

  it('offers moves for a day that only fits with overflow seats', () => {
    // 11 seats needed on 10 desks and 2 overflow seats.
    const p = project(
      [floor('1', [area('desks', 10), area('touchdown', 2, { kind: 'overflow' })])],
      [team('big', 8, ['tue']), team('small', 3, ['tue'])],
    )
    const fixes = fixesFor(p, 'day-needs-overflow|tue|-|-|-')
    expect(fixes.map((fix) => fix.label)).toEqual(['Move Small to Monday', 'Move Big to Monday'])
  })

  it('offers moves for a day that eats into the reserve', () => {
    // 16 seats needed; of the 20 desks a quarter is kept free, which leaves 15.
    const p = office([team('alpha', 10, ['tue']), team('beta', 6, ['tue'])], { reserve: 0.25 })
    const fixes = fixesFor(p, 'day-uses-reserve|tue|-|-|-')
    expect(fixes.map((fix) => fix.label)).toEqual(['Move Beta to Monday', 'Move Alpha to Monday'])
  })

  it('counts every seat less as help: the day may still be too full afterwards', () => {
    // 30 seats needed on 20 desks.
    const sizes: [string, number][] = [['three', 3], ['six', 6], ['twelve', 12], ['nine', 9]]
    const p = office(sizes.map(([id, size]) => team(id, size, ['tue'])))
    const fixes = fixesFor(p, 'day-over-capacity|tue|-|-|-')
    expect(fixes.map((fix) => fix.label)).toEqual([
      'Move Twelve to Monday',
      'Move Nine to Monday',
      'Move Six to Monday',
    ])
    const moveNine = labelled(fixes, 'Move Nine to Monday')
    // Without the nine, Tuesday needs 21 seats: still one too many, and a step closer.
    expect(idsAfter(p, moveNine)).toContain('day-over-capacity|tue|-|-|-')
    expect(dayLoad(apply(p, moveNine), 'tue').needed).toBe(21)
  })

  it('offers three moves at most', () => {
    const p = office(['a', 'b', 'c', 'd', 'e'].map((id) => team(id, 5, ['tue'])))
    const fixes = fixesFor(p, 'day-over-capacity|tue|-|-|-')
    expect(fixes.map((fix) => fix.label)).toEqual(['Move A to Monday', 'Move B to Monday', 'Move C to Monday'])
  })

  it('looks at the three best moves only, also when one of them cannot be offered', () => {
    // One agreed to Monday, which makes that the best move of all, but its seats are taken
    // on Monday. Four and Five could move just as well as Two and Three.
    const p = office([
      saying(team('one', 5, ['tue'], { a: 4, b: 1 }), { mon: 'can', wed: 'cannot', thu: 'cannot', fri: 'cannot' }),
      ...['two', 'three', 'four', 'five'].map((id) => team(id, 5, ['tue'])),
      holder('monday', ['mon'], { a: 4 }),
    ])
    expect(suggestDayMoves(p, 'tue', 3).map((move) => `${move.teamId}>${move.to}`)).toEqual([
      'one>mon',
      'two>wed',
      'three>wed',
    ])
    const fixes = fixesFor(p, 'day-over-capacity|tue|-|-|-')
    expect(fixes.map((fix) => fix.label)).toEqual(['Move Two to Wednesday', 'Move Three to Wednesday'])
  })

  it('offers nothing when every move would overfill another day', () => {
    const fillers = WEEKDAYS.filter((day) => day !== 'tue').map((day) => team(`filler-${day}`, 15, [day]))
    const p = office([team('alpha', 6, ['tue']), team('beta', 16, ['tue']), ...fillers])
    // 15 + 6 and 15 + 16 are both more than 20 desks, on every other day.
    expect(fixesFor(p, 'day-over-capacity|tue|-|-|-')).toEqual([])
  })

  it('offers nothing when no team can come on another day', () => {
    const p = office([
      saying(team('alpha', 12, ['tue']), NOWHERE_ELSE),
      saying(team('beta', 10, ['tue']), NOWHERE_ELSE),
    ])
    expect(fixesFor(p, 'day-over-capacity|tue|-|-|-')).toEqual([])
  })

  it('does not move a team onto seats that are taken on the other day', () => {
    // Wednesday is the only other day Beta can come, and Alpha cannot move at all.
    const plan = (wednesday: Seating) =>
      office([
        saying(team('alpha', 13, ['tue']), NOWHERE_ELSE),
        saying(team('beta', 8, ['tue'], { d: 4, e: 4 }), { mon: 'cannot', thu: 'cannot', fri: 'cannot' }),
        holder('gamma', ['wed'], wednesday),
      ])
    const free = plan({ a: 4 })
    expect(fixesFor(free, 'day-over-capacity|tue|-|-|-').map((fix) => fix.label)).toEqual([
      'Move Beta to Wednesday',
    ])
    // Gamma sits in D on Wednesday: Beta would bring its seats along and overfill D.
    const taken = plan({ d: 4 })
    expect(suggestDayMoves(taken, 'tue', 3).map((move) => `${move.teamId}>${move.to}`)).toEqual(['beta>wed'])
    expect(fixesFor(taken, 'day-over-capacity|tue|-|-|-')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Still to seat
// ---------------------------------------------------------------------------

describe('team-unseated and team-short', () => {
  it('offers to seat an unseated team automatically', () => {
    const p = project([floor4()], [claims(9, ['tue', 'thu'])])
    const fix = only(fixesFor(p, 'team-unseated|tue|-|-|claims'))
    expect(fix).toEqual(seatingFix(p, 'claims', 'Seat automatically', { restart: false }))
    expect(fix).toMatchObject({
      id: 'seat/replace|claims',
      label: 'Seat automatically',
      explanation: 'Seated in NE 1, NE 2 and NE 3 on Floor 4',
      action: { type: 'seat/replace', teamId: 'claims' },
    })
    // The normal seating applies on both days, so the fix for Thursday is the same one.
    expect(idsAfter(p, fix)).toEqual([])
    expect(fixesFor(p, 'team-unseated|thu|-|-|claims')).toEqual([fix])
  })

  it('completes a team that is short and keeps the seats it holds', () => {
    const p = project([floor4()], [claims(9, ['tue'], { ne3: 4, ne4: 3 })])
    const fix = only(fixesFor(p, 'team-short|tue|-|-|claims'))
    expect(fix).toEqual(seatingFix(p, 'claims', 'Seat automatically', { restart: false }))
    const seating = teamOf(apply(p, fix), 'claims').seating
    expect(seating).toMatchObject({ ne3: 4, ne4: 4 })
    expect(sumSeats(seating)).toBe(9)
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('offers two ways out of a short day exception: back to the normal seats, or complete it', () => {
    const p = project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { thu: { ne3: 2 } } })])
    const [normal, complete, ...more] = fixesFor(p, 'team-short|thu|-|-|claims')
    if (!normal || !complete) throw new Error('expected two fixes')
    expect(more).toEqual([])
    // The normal seats are free on Thursday, so the exception can simply go.
    expect(normal.label).toBe('Use the normal seating on Thursday')
    expect(teamOf(apply(p, normal), 'claims')).toMatchObject({ seating: { ne1: 4 }, daySeating: {} })
    expect(idsAfter(p, normal)).toEqual([])
    // Or the exception is completed, for that day only.
    expect(complete.label).toBe('Seat automatically')
    expect(teamOf(apply(p, complete), 'claims')).toMatchObject({ seating: { ne1: 4 }, daySeating: { thu: { ne3: 4 } } })
    expect(idsAfter(p, complete)).toEqual(['seat-differs|thu|-|-|claims'])
  })

  it('moves seats out of a room on the way', () => {
    const p = project([floor4()], [claims(4, ['tue'], { ne1: 3, room: 1 })])
    expect(ids(findIssues(p))).toEqual(['seats-in-room|tue|-|room|claims', 'team-short|tue|-|-|claims'])
    const fix = only(fixesFor(p, 'team-short|tue|-|-|claims'))
    expect(teamOf(apply(p, fix), 'claims').seating).toEqual({ ne1: 4 })
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('is offered when only this day gets seats, and not for the day that stays without', () => {
    // Thursday is full.
    const thursday = holder('crowd', ['thu'], { ne1: 4, ne2: 4, ne3: 4, ne4: 4 })
    const p = project([floor4()], [claims(9, ['tue', 'thu']), thursday])
    const fix = only(fixesFor(p, 'team-unseated|tue|-|-|claims'))
    expect(fix.explanation).toBe('Seated on Tuesday; no room on Thursday: needs 9 seats, no desk is free')
    expect(idsAfter(p, fix)).not.toContain('team-unseated|tue|-|-|claims')
    expect(idsAfter(p, fix)).toContain('team-unseated|thu|-|-|claims')
    expect(fixesFor(p, 'team-unseated|thu|-|-|claims')).toEqual([])
  })

  it('offers nothing when there is no room anywhere', () => {
    const tuesday = holder('crowd', ['tue'], { ne1: 4, ne2: 4, ne3: 4 })
    const unseated = project([floor4()], [claims(9, ['tue']), tuesday])
    expect(fixesFor(unseated, 'team-unseated|tue|-|-|claims')).toEqual([])
    const short = project([floor4()], [claims(9, ['tue'], { ne4: 4 }), tuesday])
    expect(fixesFor(short, 'team-short|tue|-|-|claims')).toEqual([])
  })

  it('keeps to the desks: overflow seats are for the planner to hand out', () => {
    // Six people, four free desks and a bench with three overflow seats.
    const tuesday = holder('crowd', ['tue'], { ne1: 4, ne2: 4, ne3: 4 })
    const p = project([floor4()], [claims(6, ['tue']), tuesday])
    expect(fixesFor(p, 'team-unseated|tue|-|-|claims')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Where a team sits
// ---------------------------------------------------------------------------

describe('team-split-floors and team-scattered', () => {
  it('offers to reseat a team that is split over floors in one place', () => {
    const p = project([floor3(), floor4()], [claims(9, ['tue'], { sw1: 4, sw2: 1, ne1: 4 })])
    const fix = only(fixesFor(p, 'team-split-floors|tue|-|-|claims'))
    expect(fix).toEqual(seatingFix(p, 'claims', 'Reseat in one place', { restart: true }))
    expect(fix.id).toBe('seat/replace|claims')
    // All nine seats on a single floor.
    expect(seatedOn(apply(p, fix), 'claims', 'tue')).toMatchObject({ seated: 9, floorIds: [expect.any(String)] })
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('offers to reseat a team that sits in separate places in one place', () => {
    const p = project([floor4()], [claims(8, ['tue'], { ne1: 4, ne3: 4 })])
    const fix = only(fixesFor(p, 'team-scattered|tue|4|-|claims'))
    expect(fix).toEqual(seatingFix(p, 'claims', 'Reseat in one place', { restart: true }))
    expect(fix.explanation).toBe('Seated in NE 1 and NE 2 on Floor 4')
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('offers nothing when no floor has room for the whole team', () => {
    // 14 people; floor 3 has 12 desks and floor 4 has 12 left.
    const p = project(
      [floor3(), floor4()],
      [claims(14, ['tue'], { sw1: 4, sw2: 4, sw3: 4, ne1: 2 }), holder('other', ['tue'], { ne4: 4 })],
    )
    expect(fixesFor(p, 'team-split-floors|tue|-|-|claims')).toEqual([])
  })

  it('offers nothing when the only free areas of the floor are apart', () => {
    const p = project(
      [floor4()],
      [
        claims(8, ['tue'], { ne1: 4, ne3: 4 }),
        holder('between', ['tue'], { ne2: 4 }),
        holder('end', ['tue'], { ne4: 4 }),
      ],
    )
    expect(fixesFor(p, 'team-scattered|tue|4|-|claims')).toEqual([])
  })

  it('offers nothing when the team would only be apart on another floor', () => {
    // Floor 3 has room for the eight as well, and again only in two areas that are apart.
    const p = project(
      [floor3(), floor4()],
      [
        claims(8, ['tue'], { ne1: 4, ne3: 4 }),
        holder('between', ['tue'], { ne2: 4, sw2: 4 }),
        holder('end', ['tue'], { ne4: 4 }),
      ],
    )
    // Automatic seating would move the team there: of two equal places it takes the lower floor.
    expect(teamOf(reseated(p, 'claims'), 'claims').seating).toEqual({ sw1: 4, sw3: 4 })
    expect(fixesFor(p, 'team-scattered|tue|4|-|claims')).toEqual([])
  })

  it('does not trade a split over floors for two places on one floor', () => {
    // One floor has room for all eight, but only in SW 1 and SW 3, with a team in between.
    const p = project(
      [floor3(), floor4()],
      [
        claims(8, ['tue'], { sw1: 4, ne1: 4 }),
        holder('between', ['tue'], { sw2: 4 }),
        holder('rest', ['tue'], { ne2: 4, ne3: 4, ne4: 4 }),
      ],
    )
    // Automatic seating would take that floor: it puts one floor before one place.
    expect(teamOf(reseated(p, 'claims'), 'claims').seating).toEqual({ sw1: 4, sw3: 4 })
    expect(fixesFor(p, 'team-split-floors|tue|-|-|claims')).toEqual([])
  })

  it('does not take away the seats the team holds on another day', () => {
    // On Thursday the team has four of its eight seats and the rest of the building is
    // taken. Seating it from scratch would find Tuesday one place and Thursday none.
    const thursday = holder('crowd', ['thu'], { sw2: 4, sw3: 4, ne1: 4, ne2: 4, ne3: 4, ne4: 4 })
    const p = project(
      [floor3(), floor4()],
      [claims(8, ['tue', 'thu'], { sw1: 4, ne1: 4 }, { daySeating: { thu: { sw1: 4 } } }), thursday],
    )
    const proposed = reseated(p, 'claims')
    expect(seatedOn(proposed, 'claims', 'tue')).toMatchObject({ seated: 8, floorIds: [expect.any(String)] })
    expect(seatedOn(proposed, 'claims', 'thu').seated).toBe(0)
    expect(fixesFor(p, 'team-split-floors|tue|-|-|claims')).toEqual([])
  })
})

describe('off-home-floor', () => {
  it('offers to reseat the team on the floor it prefers', () => {
    const p = project([floor3(), floor4()], [claims(4, ['tue'], { ne1: 4 }, { homeFloorId: '3' })])
    const fix = only(fixesFor(p, 'off-home-floor|tue|-|-|claims'))
    expect(fix).toEqual(seatingFix(p, 'claims', 'Reseat on Floor 3', { restart: true }))
    expect(fix.id).toBe('seat/replace|claims')
    expect(seatedOn(apply(p, fix), 'claims', 'tue')).toMatchObject({ seated: 4, floorIds: ['3'] })
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('names the floor as the planner named it', () => {
    const ground = floor('g', deskRow('gr', 2, 4), { name: 'Ground floor' })
    const p = project([ground, floor4()], [claims(4, ['tue'], { ne1: 4 }, { homeFloorId: 'g' })])
    expect(only(fixesFor(p, 'off-home-floor|tue|-|-|claims')).label).toBe('Reseat on Ground floor')
  })

  it('offers nothing when the preferred floor has no room for the team', () => {
    const p = project(
      [floor3(), floor4()],
      [claims(4, ['tue'], { ne1: 4 }, { homeFloorId: '3' }), holder('other', ['tue'], { sw1: 4, sw2: 4, sw3: 3 })],
    )
    expect(fixesFor(p, 'off-home-floor|tue|-|-|claims')).toEqual([])
  })

  it('offers nothing when the team would only move to another floor that is not its own', () => {
    const ground = floor('2', deskRow('gr', 2, 4))
    const p = project(
      [ground, floor3(), floor4()],
      [claims(4, ['tue'], { ne1: 4 }, { homeFloorId: '3' }), holder('other', ['tue'], { sw1: 4, sw2: 4, sw3: 4 })],
    )
    // Automatic seating would take the team down to floor 2: the lowest floor with room.
    expect(teamOf(reseated(p, 'claims'), 'claims').seating).toEqual({ gr1: 4 })
    expect(fixesFor(p, 'off-home-floor|tue|-|-|claims')).toEqual([])
  })
})

describe('overflow-used', () => {
  it('offers to move the team to desks', () => {
    const p = project([floor4()], [claims(7, ['tue'], { ne1: 4, bench: 3 })])
    const fix = only(fixesFor(p, 'overflow-used|tue|-|-|claims'))
    expect(fix).toEqual(seatingFix(p, 'claims', 'Move to desks', { restart: true }))
    expect(fix.id).toBe('seat/replace|claims')
    expect(seatedOn(apply(p, fix), 'claims', 'tue')).toMatchObject({ inDesks: 7, inOverflow: 0 })
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('offers nothing when the desks are full: the team keeps its overflow seats', () => {
    const p = project(
      [floor4()],
      [claims(7, ['tue'], { ne1: 4, bench: 3 }), holder('other', ['tue'], { ne2: 4, ne3: 4, ne4: 4 })],
    )
    // Seating the team from scratch would find it no place at all and take its seats away.
    expect(teamOf(reseated(p, 'claims'), 'claims').seating).toEqual({})
    expect(fixesFor(p, 'overflow-used|tue|-|-|claims')).toEqual([])
  })
})

describe('team-over-seated', () => {
  it('offers to release the seats the team does not need', () => {
    const p = project([floor4()], [claims(9, ['tue'], { ne1: 4, ne2: 4, ne3: 3 })])
    const fix = only(fixesFor(p, 'team-over-seated|tue|-|-|claims'))
    expect(fix).toEqual({
      id: 'batch|claims|all',
      label: 'Release 2 seats',
      explanation: 'Gives back the seats the team does not need',
      action: {
        type: 'batch',
        actions: [{ type: 'seat/set', teamId: 'claims', areaId: 'ne3', seats: 1, scope: 'all' }],
      },
    })
    expect(teamOf(apply(p, fix), 'claims').seating).toEqual({ ne1: 4, ne2: 4, ne3: 1 })
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('writes one seat in the singular', () => {
    const p = project([floor4()], [claims(9, ['tue'], { ne1: 4, ne2: 4, ne3: 2 })])
    expect(only(fixesFor(p, 'team-over-seated|tue|-|-|claims')).label).toBe('Release 1 seat')
  })

  it('starts with the last area of the highest floor and goes back from there', () => {
    // Five seats too many: both areas on floor 4 go, and one seat of SW 2.
    const p = project([floor3(), floor4()], [claims(6, ['tue'], { sw1: 4, sw2: 3, ne1: 2, ne3: 2 })])
    const fix = only(fixesFor(p, 'team-over-seated|tue|-|-|claims'))
    expect(fix.label).toBe('Release 5 seats')
    expect(fix.action).toEqual({
      type: 'batch',
      actions: [
        { type: 'seat/set', teamId: 'claims', areaId: 'ne3', seats: 0, scope: 'all' },
        { type: 'seat/set', teamId: 'claims', areaId: 'ne1', seats: 0, scope: 'all' },
        { type: 'seat/set', teamId: 'claims', areaId: 'sw2', seats: 2, scope: 'all' },
      ],
    })
    expect(teamOf(apply(p, fix), 'claims').seating).toEqual({ sw1: 4, sw2: 2 })
    // With the seats on floor 4 the split over two floors went as well.
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('releases them for one day when the team has an exception on that day', () => {
    const p = project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { tue: { ne1: 4, ne2: 2 } } })])
    const fix = only(fixesFor(p, 'team-over-seated|tue|-|-|claims'))
    expect(fix.id).toBe('batch|claims|tue')
    expect(fix.action).toEqual({
      type: 'batch',
      actions: [{ type: 'seat/set', teamId: 'claims', areaId: 'ne2', seats: 0, scope: 'tue' }],
    })
    // Tuesday is then like every other day: no exception is left.
    expect(teamOf(apply(p, fix), 'claims')).toMatchObject({ seating: { ne1: 4 }, daySeating: {} })
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('leaves seats in a room to the fix for the room', () => {
    // The room comes last on the floor, but its seats do not count as seats.
    const p = project([floor4()], [claims(4, ['tue'], { ne1: 4, ne2: 1, room: 2 })])
    const fix = only(fixesFor(p, 'team-over-seated|tue|-|-|claims'))
    expect(fix.label).toBe('Release 1 seat')
    expect(teamOf(apply(p, fix), 'claims').seating).toEqual({ ne1: 4, room: 2 })
    expect(idsAfter(p, fix)).toEqual(['seats-in-room|tue|-|room|claims'])
  })

  it('releases every seat of a team without people', () => {
    const p = project([floor4()], [team('new', 0, ['tue'], { ne1: 2, bench: 1 }, { name: 'New team' })])
    const fix = only(fixesFor(p, 'team-over-seated|tue|-|-|new'))
    expect(fix.label).toBe('Release 3 seats')
    expect(teamOf(apply(p, fix), 'new').seating).toEqual({})
    expect(idsAfter(p, fix)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Day exceptions, days and wishes
// ---------------------------------------------------------------------------

describe('seat-differs', () => {
  it('offers to use the normal seating on that day', () => {
    const p = project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { tue: { ne2: 4 } } })])
    const fix = only(fixesFor(p, 'seat-differs|tue|-|-|claims'))
    expect(fix).toEqual({
      id: 'seat/resetDay|claims|tue',
      label: 'Use the normal seating on Tuesday',
      explanation: 'Drops the exception for Tuesday',
      action: { type: 'seat/resetDay', teamId: 'claims', day: 'tue' },
    })
    expect(teamOf(apply(p, fix), 'claims')).toMatchObject({ seating: { ne1: 4 }, daySeating: {} })
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('is offered for the missing seats when the exception is why the team has none on that day', () => {
    // A day without any seat is listed as "still to seat" only; its first fix is the way back
    // to the normal seating.
    const p = project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { tue: {} } })])
    expect(ids(findIssues(p))).toEqual(['team-unseated|tue|-|-|claims'])
    const first = fixesFor(p, 'team-unseated|tue|-|-|claims')[0]
    if (!first) throw new Error('no fix offered')
    expect(first.label).toBe('Use the normal seating on Tuesday')
    expect(teamOf(apply(p, first), 'claims')).toMatchObject({ seating: { ne1: 4 }, daySeating: {} })
    expect(idsAfter(p, first)).toEqual([])
  })

  it('offers nothing when the normal seats are taken on that day', () => {
    // The exception is there for a reason: Underwriting sits in NE 1 on Tuesday.
    const p = project(
      [floor4()],
      [claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { tue: { ne2: 4 } } }), under(4, ['tue'], { ne1: 4 })],
    )
    expect(fixesFor(p, 'seat-differs|tue|-|-|claims')).toEqual([])
  })

  it('offers nothing when the team would have fewer seats without the exception', () => {
    // Seated for Tuesday only; the other days have no seats yet.
    const unseated = project([floor4()], [claims(4, ['tue', 'thu'], {}, { daySeating: { tue: { ne1: 4 } } })])
    expect(fixesFor(unseated, 'seat-differs|tue|-|-|claims')).toEqual([])
    // Complete on Tuesday, two seats short on the other days.
    const short = project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 2 }, { daySeating: { tue: { ne2: 4 } } })])
    expect(fixesFor(short, 'seat-differs|tue|-|-|claims')).toEqual([])
  })
})

describe('wish-unmet', () => {
  const wanting = wishes({ tue: 'want', wed: 'want', thu: 'want' })

  it('offers to plan the wanted day', () => {
    const p = project([floor4()], [claims(4, ['wed', 'thu'], { ne1: 4 }, { wishes: wanting })])
    const fix = only(fixesFor(p, 'wish-unmet|tue|-|-|claims'))
    expect(fix).toEqual({
      id: 'team/setPlanned|claims|tue',
      label: 'Plan Tuesday',
      explanation: 'Adds Tuesday as a team day for Claims Intake',
      action: { type: 'team/setPlanned', id: 'claims', day: 'tue', planned: true },
    })
    expect(teamOf(apply(p, fix), 'claims').days).toEqual(['tue', 'wed', 'thu'])
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('is offered for a team without seats: seating it is the next step, not a reason to wait', () => {
    const p = project([floor4()], [claims(4, ['thu'], {}, { wishes: wanting })])
    const fix = only(fixesFor(p, 'wish-unmet|tue|-|-|claims'))
    expect(idsAfter(p, fix)).toContain('team-unseated|tue|-|-|claims')
  })

  it('is offered when the day then eats into the reserve', () => {
    // 16 desks of which a quarter is kept free: 12 may be planned. Tuesday would need 14.
    const p = project(
      [floor4()],
      [claims(4, ['thu'], { ne1: 4 }, { wishes: wanting }), holder('other', ['tue'], { ne2: 4, ne3: 4, ne4: 2 })],
      { reserve: 0.25 },
    )
    const fix = only(fixesFor(p, 'wish-unmet|tue|-|-|claims'))
    expect(idsAfter(p, fix)).toContain('day-uses-reserve|tue|-|-|-')
  })

  it('offers nothing when the day would then need more seats than the building has desks', () => {
    // 14 seats are needed on Tuesday already. With four more the 16 desks are not enough,
    // although the three overflow seats would still take the day.
    const tuesday = team('other', 14, ['tue'], { ne2: 4, ne3: 4, ne4: 4 })
    const p = project([floor4()], [claims(4, ['thu'], { ne1: 4 }, { wishes: wanting }), tuesday])
    expect(dayLoad(reduce(p, { type: 'team/setPlanned', id: 'claims', day: 'tue', planned: true }), 'tue').level).toBe(
      'overflow',
    )
    expect(fixesFor(p, 'wish-unmet|tue|-|-|claims')).toEqual([])
  })

  it('offers nothing when the seats of the team are taken on that day', () => {
    const p = project([floor4()], [claims(4, ['thu'], { ne1: 4 }, { wishes: wanting }), under(4, ['tue'], { ne1: 4 })])
    expect(fixesFor(p, 'wish-unmet|tue|-|-|claims')).toEqual([])
  })

  it('offers nothing when its seats would add to an area that is too full already', () => {
    const p = project(
      [floor4()],
      [
        claims(2, ['thu'], { ne1: 2 }, { wishes: wanting }),
        under(3, ['tue'], { ne1: 3 }),
        team('policy', 3, ['tue'], { ne1: 3 }, { name: 'Policy Admin' }),
      ],
    )
    expect(ids(findIssues(p))).toContain('area-over-capacity|tue|-|ne1|-')
    expect(fixesFor(p, 'wish-unmet|tue|-|-|claims')).toEqual([])
  })

  it('offers nothing when the team would bring seats in a room along', () => {
    const p = project([floor4()], [claims(4, ['thu'], { ne1: 3, room: 1 }, { wishes: wanting })])
    expect(ids(findIssues(p))).toContain('seats-in-room|thu|-|room|claims')
    expect(fixesFor(p, 'wish-unmet|tue|-|-|claims')).toEqual([])
  })
})

describe('unwanted-day', () => {
  it('offers to take the day off the plan', () => {
    const p = project(
      [floor4()],
      [claims(4, ['tue', 'fri'], { ne1: 4 }, { wishes: wishes({ tue: 'want', fri: 'cannot' }) })],
    )
    const fix = only(fixesFor(p, 'unwanted-day|fri|-|-|claims'))
    expect(fix).toEqual({
      id: 'team/setPlanned|claims|fri',
      label: 'Take Friday off the plan',
      explanation: 'Claims Intake said it cannot come on Friday',
      action: { type: 'team/setPlanned', id: 'claims', day: 'fri', planned: false },
    })
    expect(teamOf(apply(p, fix), 'claims').days).toEqual(['tue'])
    expect(idsAfter(p, fix)).toEqual([])
  })

  it('is offered when the team leaves a conflict behind that was there before, and smaller now', () => {
    // NE 1 holds eight seats for four desks on Friday. Without Claims Intake it is still
    // too full: the same conflict with one team less, not a new one.
    const p = project(
      [floor4()],
      [
        claims(2, ['tue', 'fri'], { ne1: 2 }, { wishes: wishes({ tue: 'want', fri: 'cannot' }) }),
        under(3, ['fri'], { ne1: 3 }),
        team('policy', 3, ['fri'], { ne1: 3 }, { name: 'Policy Admin' }),
      ],
    )
    expect(ids(findIssues(p))).toContain('area-over-capacity|fri|-|ne1|-')
    const fix = only(fixesFor(p, 'unwanted-day|fri|-|-|claims'))
    expect(idsAfter(p, fix)).toEqual(['area-over-capacity|fri|-|ne1|-'])
  })

  it('is offered for the last team day as well: the note that follows says what is left to do', () => {
    const p = project([floor4()], [claims(4, ['fri'], { ne1: 4 }, { wishes: wishes({ fri: 'cannot' }) })])
    const fix = only(fixesFor(p, 'unwanted-day|fri|-|-|claims'))
    expect(idsAfter(p, fix)).toEqual(['no-team-days|-|-|-|claims'])
  })
})

describe('no-team-days', () => {
  it('has no fix: which day to plan is not for a button to decide', () => {
    const p = project([floor4()], [claims(9, [], {}, { wishes: wishes({ tue: 'want' }) })])
    expect(fixesFor(p, 'no-team-days|-|-|-|claims')).toEqual([])
    // The wish for Tuesday is an issue of its own, and that one has a fix.
    expect(only(fixesFor(p, 'wish-unmet|tue|-|-|claims')).label).toBe('Plan Tuesday')
  })
})

// ---------------------------------------------------------------------------
// Every result
// ---------------------------------------------------------------------------

describe('suggestFixes in general', () => {
  const crowded = () => project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 4 }), under(2, ['tue'], { ne1: 2 })])
  const crowdedId = 'area-over-capacity|tue|-|ne1|-'

  it('has nothing for an issue the project does not have', () => {
    const p = crowded()
    const elsewhere = issueOf(project([floor4()], [claims(9, ['mon'])]), 'team-unseated|mon|-|-|claims')
    expect(suggestFixes(p, elsewhere)).toEqual([])
    // The same conflict claimed for an area that is not over capacity.
    expect(suggestFixes(p, { ...issueOf(p, crowdedId), id: 'area-over-capacity|tue|-|ne2|-', areaId: 'ne2' })).toEqual([])
    expect(suggestFixes(project([]), issueOf(p, crowdedId))).toEqual([])
  })

  it('has nothing for an issue that a fix has just solved', () => {
    const p = crowded()
    const issue = issueOf(p, crowdedId)
    for (const fix of suggestFixes(p, issue)) expect(suggestFixes(apply(p, fix), issue)).toEqual([])
  })

  it('goes by the id of the issue and reads everything else from the project', () => {
    const p = crowded()
    const issue = issueOf(p, crowdedId)
    const garbled: Issue = { ...issue, rule: 'seat-differs', day: 'fri', areaId: null, teamIds: [], title: '' }
    expect(suggestFixes(p, garbled)).toEqual(suggestFixes(p, issue))
  })

  it('leaves the project alone and gives the same answer every time', () => {
    const p = crowded()
    const before = structuredClone(p)
    const issue = issueOf(p, crowdedId)
    const first = suggestFixes(deepFreeze(p), deepFreeze(issue))
    expect(first).toHaveLength(2)
    expect(p).toStrictEqual(before)
    expect(suggestFixes(p, issue)).toStrictEqual(first)
    expect(suggestFixes(structuredClone(before), structuredClone(issue))).toStrictEqual(first)
  })

  it('has a word for a team without a name', () => {
    // A team has no name for a moment while the planner retypes it.
    const nameless = (id: string, days: readonly Weekday[], seating: Seating, options: TeamOptions = {}) =>
      team(id, 2, days, seating, { name: '  ', ...options })

    const inRoom = project([floor4()], [nameless('new', ['tue'], { ne1: 2, room: 1 })])
    expect(only(fixesFor(inRoom, 'seats-in-room|tue|-|room|new')).explanation).toBe(
      "Takes this team's 1 seat out of Meeting room 4.1",
    )

    const crowd = project([floor4()], [nameless('new', ['tue'], { ne1: 2 }), claims(4, ['tue'], { ne1: 4 })])
    expect(fixesFor(crowd, 'area-over-capacity|tue|-|ne1|-').map((fix) => fix.label)).toEqual([
      'Reseat this team',
      'Reseat Claims Intake',
    ])

    const full = office([nameless('new', ['tue'], {}), team('rest', 20, ['tue'])])
    expect(fixesFor(full, 'day-over-capacity|tue|-|-|-').map((fix) => fix.label)).toContain(
      'Move this team to Monday',
    )

    const said = wishes({ tue: 'want', wed: 'want', fri: 'cannot' })
    const days = project([floor4()], [nameless('new', ['tue', 'fri'], { ne1: 2 }, { wishes: said })])
    expect(only(fixesFor(days, 'wish-unmet|wed|-|-|new')).explanation).toBe(
      'Adds Wednesday as a team day for this team',
    )
    expect(only(fixesFor(days, 'unwanted-day|fri|-|-|new')).explanation).toBe('The team said it cannot come on Friday')
  })
})

// ---------------------------------------------------------------------------
// A whole plan
// ---------------------------------------------------------------------------

/** A plan in which every rule fires at least once. 28 desks and 3 overflow seats on two
 *  floors; a quarter of the desks is kept free, which leaves 21 to plan with. */
function mixedProject(): Project {
  return project(
    [floor3(), floor4()],
    [
      // Tuesday (20 seats needed, fits).
      claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { thu: { ne2: 4 } } }),
      under(2, ['tue'], { ne1: 2 }),
      team('portal', 5, ['tue'], { ne2: 4, bench: 1 }, { name: 'Customer Portal' }),
      team('data', 3, ['tue'], { room: 3 }, { name: 'Data Platform' }),
      team('policy', 6, ['tue'], { ne3: 4 }, { name: 'Policy Admin' }),
      // Thursday (19 seats needed, fits).
      team('broker', 2, ['thu'], { ne3: 3 }, { name: 'Broker Channel' }),
      team('finance', 8, ['thu'], { sw1: 4, ne4: 4 }, { name: 'Finance Operations', homeFloorId: '4' }),
      team('risk', 5, ['thu'], { ne1: 4, ne3: 1 }, { name: 'Risk and Compliance' }),
      // Days and wishes.
      team('arch', 4, ['fri'], { sw2: 4 }, { name: 'Architecture', wishes: wishes({ fri: 'cannot' }) }),
      team('legal', 3, ['mon'], { sw3: 3 }, { name: 'Legal', wishes: wishes({ mon: 'want', wed: 'want' }) }),
      team('newbies', 2, [], {}, { name: 'Newcomers' }),
      // Three crowds: Monday cannot fit (35 seats), Wednesday needs overflow seats (30) and
      // Friday eats into the reserve (24).
      team('crowd1', 32, ['mon'], {}, { name: 'Monday crowd' }),
      team('crowd2', 30, ['wed'], {}, { name: 'Wednesday crowd' }),
      team('crowd3', 20, ['fri'], {}, { name: 'Friday crowd' }),
    ],
    { reserve: 0.25 },
  )
}

/** The same project with the keys of every seating record written in the opposite order. */
function withSeatingKeysReversed(p: Project): Project {
  const reversed = (seating: Seating): Seating => Object.fromEntries(Object.entries(seating).reverse())
  return {
    ...p,
    teams: p.teams.map((t) => {
      const daySeating: Partial<Record<Weekday, Seating>> = {}
      for (const day of [...WEEKDAYS].reverse()) {
        const exception = t.daySeating[day]
        if (exception !== undefined) daySeating[day] = reversed(exception)
      }
      return { ...t, seating: reversed(t.seating), daySeating }
    }),
  }
}

describe('a larger mixed project', () => {
  const p = mixedProject()
  const issues = findIssues(p)

  it('is a sound project in which every rule fires', () => {
    expect(violations(p)).toEqual([])
    const fired = new Set(issues.map((issue) => issue.rule))
    expect([...fired].sort()).toEqual(Object.keys(RULE_SEVERITY).sort())
  })

  it('gets the fixes that help, and none where nothing would', () => {
    const offered = issues.map((issue) => [issue.id, fixesFor(p, issue.id).map((fix) => fix.label)])
    expect(offered).toEqual([
      // Conflicts. The crowd of 32 fits on no day; Legal moving away is at least a step.
      ['day-over-capacity|mon|-|-|-', ['Move Legal to Thursday']],
      ['area-over-capacity|tue|-|ne1|-', ['Reseat Underwriting', 'Reseat Claims Intake']],
      ['seats-in-room|tue|-|room|data', ['Remove these seats']],
      // To-dos. The crowds of Monday and Wednesday are larger than the building has desks.
      ['team-unseated|mon|-|-|crowd1', []],
      ['team-short|tue|-|-|policy', ['Seat automatically']],
      ['team-unseated|tue|-|-|data', ['Seat automatically']],
      ['team-unseated|wed|-|-|crowd2', []],
      ['team-unseated|fri|-|-|crowd3', ['Seat automatically']],
      // Warnings. Wednesday is too full for Legal's wish, and its crowd fits nowhere else.
      ['overflow-used|tue|-|-|portal', ['Move to desks']],
      ['wish-unmet|wed|-|-|legal', []],
      ['day-needs-overflow|wed|-|-|-', []],
      ['team-split-floors|thu|-|-|finance', ['Reseat in one place']],
      ['unwanted-day|fri|-|-|arch', ['Take Friday off the plan']],
      ['day-uses-reserve|fri|-|-|-', ['Move Architecture to Thursday']],
      // Notes. Floor 4 has no room for all of Finance on Thursday, and the seats Claims
      // Intake has on its other day are taken then.
      ['off-home-floor|thu|-|-|finance', []],
      ['seat-differs|thu|-|-|claims', []],
      ['team-over-seated|thu|-|-|broker', ['Release 1 seat']],
      ['team-scattered|thu|4|-|risk', ['Reseat in one place']],
      ['no-team-days|-|-|-|newbies', []],
    ])
  })

  it('does not depend on the key order of seatings and exceptions', () => {
    const mirrored = withSeatingKeysReversed(p)
    for (const issue of issues) {
      const fixes = suggestFixes(mirrored, issue)
      expect(fixes).toStrictEqual(suggestFixes(p, issue))
      expect(JSON.stringify(fixes)).toBe(JSON.stringify(suggestFixes(p, issue)))
    }
  })
})

// ---------------------------------------------------------------------------
// Random offices
// ---------------------------------------------------------------------------

describe('random offices', () => {
  /** Numbers from 0 up to 1 that are the same on every run (mulberry32). */
  function generator(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** An office as a planner may leave it half way: one to three floors with desks, overflow
   *  seats and rooms, a reserve or none, and teams with wishes of every kind that are
   *  unseated, half seated, seated twice in the same place, or sitting in a room. */
  function randomOffice(seed: number): Project {
    const next = generator(seed)
    const upTo = (max: number) => Math.floor(next() * (max + 1))
    const chance = (share: number) => next() < share

    const areas: Area[] = []
    const floors: Floor[] = []
    for (let f = 0; f <= upTo(2); f += 1) {
      const onFloor: Area[] = []
      for (let i = 0; i <= upTo(6); i += 1) {
        const kind = chance(0.7) ? 'desks' : chance(0.5) ? 'overflow' : 'no-seating'
        const rect = { x: 0.05 + (i % 4) * 0.11, y: 0.1 + Math.floor(i / 4) * 0.3, w: 0.1, h: 0.2 }
        onFloor.push(area(`f${f}-${i}`, upTo(8), { kind, rect }))
      }
      areas.push(...onFloor)
      floors.push(floor(String(f + 1), onFloor))
    }

    const someSeating = (): Seating => {
      const seating: Seating = {}
      if (chance(0.3)) return seating
      for (let i = 0; i <= upTo(2); i += 1) {
        const picked = areas[upTo(areas.length - 1)]
        if (picked) seating[picked.id] = 1 + upTo(Math.min(picked.capacity, 5))
      }
      return seating
    }
    const someWish = (planned: boolean): DayWish => {
      if (planned) return chance(0.85) ? 'want' : chance(0.5) ? 'cannot' : 'can'
      return chance(0.2) ? 'want' : chance(0.3) ? 'can' : chance(0.3) ? 'cannot' : 'none'
    }
    const teams: Team[] = []
    for (let t = 0; t < upTo(7); t += 1) {
      const days = WEEKDAYS.filter(() => chance(0.4))
      const seating = someSeating()
      const daySeating: Partial<Record<Weekday, Seating>> = {}
      for (const day of days) {
        const own = someSeating()
        if (chance(0.25) && !sameSeating(own, seating)) daySeating[day] = own
      }
      const said = {} as Record<Weekday, DayWish>
      for (const day of WEEKDAYS) said[day] = someWish(days.includes(day))
      const homeFloor = chance(0.3) ? floors[upTo(floors.length - 1)] : undefined
      teams.push(
        // As the reducer would leave it: never a seating of its own on every team day.
        settleSeating(
          team(`t${t}`, upTo(10), days, seating, {
            daySeating,
            wishes: said,
            domainId: chance(0.5) ? `domain-${upTo(1)}` : null,
            homeFloorId: homeFloor?.id ?? null,
            attendance: chance(0.2) ? 0.6 : null,
          }),
        ),
      )
    }
    return project(floors, teams, { reserve: chance(0.5) ? 0.2 : 0 })
  }

  it('keeps its promise for every fix, whatever the office looks like', () => {
    const rulesWithFix = new Set<IssueRule>()
    const rulesWithout = new Set<IssueRule>()
    for (let seed = 1; seed <= 300; seed += 1) {
      const p = randomOffice(seed)
      for (const issue of findIssues(p)) {
        const where = `office ${seed}, ${issue.id}`
        const fixes = fixesFor(p, issue.id, where)
        const seen = fixes.length > 0 ? rulesWithFix : rulesWithout
        seen.add(issue.rule)
        // Once applied, the fix has nothing more to offer for the issue it solved. (A day
        // that is still too full keeps its issue, and with it further moves.)
        if (!DAY_RULES.includes(issue.rule)) {
          for (const fix of fixes) expect(suggestFixes(apply(p, fix), issue), where).toEqual([])
        }
      }
    }
    // The offices are varied enough to show every rule with a fix, and every rule that can
    // be beyond help without one.
    const allRules = Object.keys(RULE_SEVERITY) as IssueRule[]
    const alwaysFixable: IssueRule[] = ['seats-in-room', 'team-over-seated', 'unwanted-day']
    expect([...rulesWithFix].sort()).toEqual(allRules.filter((rule) => rule !== 'no-team-days').sort())
    expect([...rulesWithout].sort()).toEqual(allRules.filter((rule) => !alwaysFixable.includes(rule)).sort())
  })
})

// ---------------------------------------------------------------------------
// Found in review
// ---------------------------------------------------------------------------

describe('a team that moves to another day keeps its seats', () => {
  // Three areas of four desks; a quarter of the desks is kept free, so nine may be planned.
  const building = () => floor('1', row(['a', 'b', 'c'], 4))
  const filler = (id: string, days: readonly Weekday[], seating: Seating) =>
    team(id, Object.values(seating).reduce((sum, seats) => sum + seats, 0), days, seating)

  it('arrives on the new day with the seats it had, also when those were a seating for that day only', () => {
    // Monday is full, so Alpha has no seats then and sits in C on Tuesday only.
    const alpha = team('alpha', 4, ['mon', 'tue'], {}, { daySeating: { tue: { c: 4 } } })
    const p = project(
      [building()],
      [
        filler('m1', ['mon'], { a: 4 }),
        filler('m2', ['mon'], { b: 4 }),
        filler('m3', ['mon'], { c: 4 }),
        filler('t1', ['tue'], { a: 4 }),
        filler('t2', ['tue'], { b: 2 }),
        alpha,
      ],
      { reserve: 0.25 },
    )
    expect(violations(p)).toEqual([])
    const move = labelled(fixesFor(p, 'day-uses-reserve|tue|-|-|-'), 'Move Alpha to Wednesday')
    const moved = apply(p, move)
    expect(teamOf(moved, 'alpha').days).toEqual(['mon', 'wed'])
    // Four of four on Wednesday, in C, where it sat on Tuesday.
    expect(seatedOn(moved, 'alpha', 'wed')).toMatchObject({ seated: 4, needed: 4, areaIds: ['c'] })
  })
})

describe('"Use the normal seating" for a day without seats', () => {
  it('is not offered when the normal seating is short itself', () => {
    // A has two desks; B has four and is taken on both days. Alpha needs four.
    const p = project(
      [floor('1', [...row(['a'], 2), ...row(['b'], 4, 0.5)])],
      [
        team('alpha', 4, ['mon', 'tue'], { a: 2 }, { daySeating: { tue: {} } }),
        team('other', 4, ['mon', 'tue'], { b: 4 }),
      ],
    )
    expect(violations(p)).toEqual([])
    // Going back to the normal seating would leave Alpha two seats short on Tuesday.
    expect(fixesFor(p, 'team-unseated|tue|-|-|alpha').map((fix) => fix.label)).toEqual([])
  })
})
