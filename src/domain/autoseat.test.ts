import { describe, expect, it } from 'vitest'
import { autoSeat, type AutoSeatOptions, type AutoSeatResult } from './autoseat'
import { FLOOR4_AREAS, FLOOR4_PLAN_SIZE } from './floor4'
import { clusterAreas } from './geometry'
import { dayOccupancy, seatingOn, seatsNeeded, sumSeats, teamDayStatus } from './model'
import { area, floor, project, row, team, violations } from './testkit'
import {
  WEEKDAYS,
  type Area,
  type Floor,
  type Project,
  type Rect,
  type Seating,
  type Team,
  type Weekday,
} from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function teamOf(p: Project, id: string): Team {
  const found = p.teams.find((t) => t.id === id)
  if (!found) throw new Error(`no team ${id}`)
  return found
}

function floorOf(p: Project, id: string): Floor {
  const found = p.floors.find((f) => f.id === id)
  if (!found) throw new Error(`no floor ${id}`)
  return found
}

function outcomeOf(result: AutoSeatResult, teamId: string) {
  const found = result.outcomes.find((o) => o.teamId === teamId)
  if (!found) throw new Error(`no outcome for ${teamId}`)
  return found
}

/** Areas that hold more seats than they have, as "area on day". */
function overbooked(p: Project): string[] {
  const out: string[] = []
  for (const day of WEEKDAYS) {
    for (const occupancy of dayOccupancy(p, day).values()) {
      if (occupancy.used > occupancy.area.capacity) out.push(`${occupancy.area.id} on ${day}`)
    }
  }
  return out
}

/** Team days on which a team holds fewer seats than it needs, as "team on day". */
function shortDays(p: Project): string[] {
  const out: string[] = []
  for (const t of p.teams) {
    for (const day of t.days) {
      const status = teamDayStatus(p, t, day)
      if (status.seated < status.needed) out.push(`${t.id} on ${day}`)
    }
  }
  return out
}

/** Seats held in rooms, as "team on day". */
function seatsInRooms(p: Project): string[] {
  const out: string[] = []
  for (const t of p.teams) {
    for (const day of t.days) if (teamDayStatus(p, t, day).inNoSeating > 0) out.push(`${t.id} on ${day}`)
  }
  return out
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** Runs autoSeat and checks what must hold for EVERY run: the input is left alone, the
 *  proposal breaks no invariant, the teams keep their order, and the same input gives the
 *  same output again. */
function seat(p: Project, options?: AutoSeatOptions): AutoSeatResult {
  const before = structuredClone(p)
  // Frozen, so that any attempt to write to the input throws.
  const result = autoSeat(deepFreeze(p), options)
  expect(p).toStrictEqual(before)
  expect(violations(result.project)).toEqual([])
  expect(result.project.teams.map((t) => t.id)).toEqual(p.teams.map((t) => t.id))
  expect(result.project.floors).toBe(p.floors)
  expect(autoSeat(structuredClone(before), options)).toStrictEqual(result)
  for (const outcome of result.outcomes) expect(outcome.message).toMatch(/^[A-Z].*[^.]$/)
  return result
}

/** A rectangle below the rows that `row()` makes, far enough to be no neighbour of them. */
function below(column: number): Rect {
  return { x: 0.05 + column * 0.11, y: 0.6, w: 0.1, h: 0.2 }
}

// ---------------------------------------------------------------------------
// One team, one floor
// ---------------------------------------------------------------------------

describe('autoSeat: a team on an empty floor', () => {
  it('seats a team that fits in one area in the first such area', () => {
    const p = project([floor('4', row(['a', 'b', 'c'], 6))], [team('alpha', 5, ['tue', 'thu'])])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 5 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({})
    expect(result.outcomes).toEqual([{ teamId: 'alpha', result: 'seated', message: 'Seated in A on Floor 4' }])
  })

  it('gives a team that is larger than an area the neighbouring area too, with the remainder there', () => {
    const p = project([floor('4', row(['a', 'b'], 4))], [team('alpha', 6, ['mon'])])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4, b: 2 })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in A and B on Floor 4')
  })

  it('keeps a large team in one run of neighbouring areas', () => {
    const p = project([floor('4', row(['a', 'b', 'c', 'd', 'e'], 4))], [team('alpha', 10, ['mon'])])
    const seating = teamOf(seat(p).project, 'alpha').seating
    expect(sumSeats(seating)).toBe(10)
    // Two areas in full and the remainder in a third, all next to each other.
    expect(Object.values(seating).sort()).toEqual([2, 4, 4])
    expect(clusterAreas(floorOf(p, '4'), Object.keys(seating))).toHaveLength(1)
  })

  it('seats the people expected in, not the whole team, when attendance is below 1', () => {
    const p = project([floor('4', row(['a', 'b'], 10))], [team('alpha', 10, ['mon'], {}, { attendance: 0.8 })])
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ a: 8 })
  })

  it('prefers one large area over several small ones', () => {
    const areas = [...row(['a', 'b', 'c'], 2), area('big', 6, { rect: below(0) })]
    const p = project([floor('4', areas)], [team('alpha', 6, ['mon'])])
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ big: 6 })
  })

  it('prefers few areas to many, even when the many lie closer together', () => {
    // Three small desks in a tight row, then two large ones side by side. The large ones
    // are further apart from centre to centre, but they are two areas instead of three.
    const small = (id: string, x: number) => area(id, 2, { rect: { x, y: 0.1, w: 0.04, h: 0.1 } })
    const large = (id: string, x: number) => area(id, 3, { rect: { x, y: 0.5, w: 0.15, h: 0.3 } })
    const areas = [small('s1', 0.05), small('s2', 0.095), small('s3', 0.14), large('g1', 0.4), large('g2', 0.56)]
    const p = project([floor('4', areas)], [team('alpha', 6, ['mon'])])
    expect(clusterAreas(floorOf(p, '4'), ['s1', 's2', 's3'])).toHaveLength(1)
    expect(clusterAreas(floorOf(p, '4'), ['g1', 'g2'])).toHaveLength(1)
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ g1: 3, g2: 3 })
  })

  it('prefers areas that lie close together', () => {
    // A and B are neighbours with some air between them; C and D touch.
    const at = (id: string, x: number) => area(id, 4, { rect: { x, y: 0.1, w: 0.1, h: 0.2 } })
    const areas = [at('a', 0.05), at('b', 0.21), at('c', 0.5), at('d', 0.61)]
    const p = project([floor('4', areas)], [team('alpha', 8, ['mon'])])
    expect(clusterAreas(floorOf(p, '4'), ['a', 'b'])).toHaveLength(1)
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ c: 4, d: 4 })
  })

  it('avoids leaving a single seat over in an area', () => {
    const areas = [area('a', 4, { rect: below(0) }), area('b', 5, { rect: below(3) })]
    const p = project([floor('4', areas)], [team('alpha', 3, ['mon'])])
    // A would be left with one seat nobody can use for a team; B keeps two.
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ b: 3 })
  })

  it('sees nothing wrong with filling an area exactly', () => {
    // A is filled to the last seat, B would keep two: both are fine, so the first one it is.
    const areas = [area('a', 4, { rect: below(0) }), area('b', 6, { rect: below(3) })]
    const p = project([floor('4', areas)], [team('alpha', 4, ['mon'])])
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ a: 4 })
  })
})

// ---------------------------------------------------------------------------
// Several teams
// ---------------------------------------------------------------------------

describe('autoSeat: several teams', () => {
  it('lets teams on different days share the same area', () => {
    const p = project([floor('4', row(['a', 'b'], 4))], [team('alpha', 4, ['mon']), team('beta', 4, ['tue'])])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'beta').seating).toEqual({ a: 4 })
    expect(overbooked(result.project)).toEqual([])
  })

  it('keeps teams on the same day apart', () => {
    const p = project([floor('4', row(['a', 'b'], 4))], [team('alpha', 4, ['mon']), team('beta', 4, ['mon'])])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'beta').seating).toEqual({ b: 4 })
    expect(overbooked(result.project)).toEqual([])
  })

  it('only uses seats that are free on all days of a team', () => {
    const blocker = team('blocker', 4, ['thu'], { a: 4 })
    const p = project([floor('4', row(['a', 'b'], 4))], [blocker, team('alpha', 4, ['tue', 'thu'])])
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ b: 4 })
  })

  it('seats the larger team first, whatever the list order', () => {
    // A (6 desks) and B (4 desks) are not next to each other. In list order the small team
    // would take seats in A and the large one would end up in two places.
    const areas = [area('a', 6, { rect: below(0) }), area('b', 4, { rect: below(3) })]
    const p = project([floor('4', areas)], [team('small', 4, ['mon']), team('large', 6, ['mon'])])
    const result = seat(p)
    expect(teamOf(result.project, 'large').seating).toEqual({ a: 6 })
    expect(teamOf(result.project, 'small').seating).toEqual({ b: 4 })
    expect(result.outcomes.map((o) => o.teamId)).toEqual(['small', 'large'])
  })

  it('seats the team with more days first among equally large teams', () => {
    // B is taken on Tuesday. If the one-day team went first it would sit in A, and the
    // two-day team would have no area that is free on both of its days.
    const blocker = team('blocker', 4, ['tue'], { b: 4 })
    const p = project(
      [floor('4', row(['a', 'b'], 4))],
      [blocker, team('oneday', 4, ['mon']), team('twodays', 4, ['mon', 'tue'])],
    )
    const result = seat(p)
    expect(teamOf(result.project, 'twodays').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'twodays').daySeating).toEqual({})
    expect(teamOf(result.project, 'oneday').seating).toEqual({ b: 4 })
  })

  it('seats a team next to a team of its group that is in on the same day', () => {
    const areas = row(['a', 'b', 'c', 'd', 'e'], 4)
    const claims = team('intake', 4, ['mon'], { e: 4 }, { group: 'Claims' })
    const together = project([floor('4', areas)], [claims, team('handling', 4, ['mon'], {}, { group: 'Claims' })])
    expect(teamOf(seat(together).project, 'handling').seating).toEqual({ d: 4 })

    const spaces = project([floor('4', areas)], [claims, team('handling', 4, ['mon'], {}, { group: ' Claims ' })])
    expect(teamOf(seat(spaces).project, 'handling').seating).toEqual({ d: 4 })

    const otherGroup = project([floor('4', areas)], [claims, team('handling', 4, ['mon'], {}, { group: 'Policy' })])
    expect(teamOf(seat(otherGroup).project, 'handling').seating).toEqual({ a: 4 })

    const noGroup = project(
      [floor('4', areas)],
      [{ ...claims, group: '' }, team('handling', 4, ['mon'], {}, { group: '' })],
    )
    expect(teamOf(seat(noGroup).project, 'handling').seating).toEqual({ a: 4 })

    // A team of the group that is in on another day is nobody to sit next to.
    const otherDay = project(
      [floor('4', areas)],
      [{ ...claims, days: ['tue'] }, team('handling', 4, ['mon'], {}, { group: 'Claims' })],
    )
    expect(teamOf(seat(otherDay).project, 'handling').seating).toEqual({ a: 4 })
  })
})

// ---------------------------------------------------------------------------
// Seats a team already holds
// ---------------------------------------------------------------------------

describe('autoSeat: a team that is half seated', () => {
  const areas = row(['a', 'b', 'c', 'd'], 4)

  it('keeps its seats and grows from there', () => {
    const p = project([floor('4', areas)], [team('alpha', 8, ['mon'], { d: 4 })])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ c: 4, d: 4 })
    // Listed as on the plan, not in the order in which the seats were found.
    expect(Object.keys(teamOf(result.project, 'alpha').seating)).toEqual(['c', 'd'])
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in C and D on Floor 4')
  })

  it('fills the area it sits in before it takes a new one', () => {
    const p = project([floor('4', areas)], [team('alpha', 6, ['mon'], { a: 2 })])
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ a: 4, b: 2 })
  })

  it('discards the seats on a restart', () => {
    const p = project([floor('4', areas)], [team('alpha', 8, ['mon'], { d: 4 })])
    const result = seat(p, { restart: true })
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4, b: 4 })
  })

  it('discards day exceptions on a restart', () => {
    const alpha = team('alpha', 4, ['mon', 'tue'], { d: 4 }, { daySeating: { tue: { c: 2 } } })
    const result = seat(project([floor('4', areas)], [alpha]), { restart: true })
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({})
  })

  it('stays on its floor, also when another floor is the preferred one', () => {
    const p = project(
      [floor('3', row(['a', 'b'], 4)), floor('4', row(['c', 'd'], 4))],
      [team('alpha', 8, ['mon'], { c: 4 }, { homeFloorId: '3' })],
    )
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ c: 4, d: 4 })
  })

  it('leaves a complete day exception alone and completes the normal seating', () => {
    const alpha = team('alpha', 4, ['tue', 'thu'], { a: 2 }, { daySeating: { thu: { d: 4 } } })
    const result = seat(project([floor('4', areas)], [alpha]))
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({ thu: { d: 4 } })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in A on Floor 4, and on Thursday in D')
  })

  it('does not rearrange day exceptions the planner made', () => {
    // Two days share an exception. Completing Monday must not turn that into the normal seating.
    const alpha = team('alpha', 4, ['mon', 'tue', 'wed'], { a: 2 }, { daySeating: { tue: { d: 4 }, wed: { d: 4 } } })
    const result = seat(project([floor('4', areas)], [alpha]))
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({ tue: { d: 4 }, wed: { d: 4 } })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in A on Floor 4, and on Tuesday and Wednesday in D')
  })

  it('completes a day exception that is short for that day only', () => {
    const alpha = team('alpha', 4, ['tue', 'thu'], { a: 4 }, { daySeating: { thu: { d: 1 } } })
    const result = seat(project([floor('4', areas)], [alpha]))
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({ thu: { d: 4 } })
  })

  it('gives a team that was seated day by day a normal seating again', () => {
    // Seated "for this day only" on each of its days: the normal seating is empty.
    const daySeating = { mon: { a: 4 }, tue: { b: 2 }, wed: { a: 4 } }
    const alpha = team('alpha', 4, ['mon', 'tue', 'wed'], {}, { daySeating })
    const result = seat(project([floor('4', areas)], [alpha]))
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({ tue: { b: 4 } })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in A on Floor 4, and on Tuesday in B')
  })

  it('does not count seats in a room and does not keep them', () => {
    const withRoom = [...areas, area('room', 8, { kind: 'no-seating', rect: below(0) })]
    const p = project([floor('4', withRoom)], [team('alpha', 4, ['mon'], { room: 4 })])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(seatsInRooms(result.project)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

describe('autoSeat: several floors', () => {
  const floors = () => [floor('3', row(['a', 'b'], 4)), floor('4', row(['c', 'd', 'e'], 4))]

  it('takes the lowest floor that has room', () => {
    const p = project(floors(), [team('alpha', 4, ['mon'])])
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ a: 4 })
  })

  it('takes the preferred floor when the team fits there', () => {
    const p = project(floors(), [team('alpha', 4, ['mon'], {}, { homeFloorId: '4' })])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ c: 4 })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in C on Floor 4')
  })

  it('leaves the preferred floor when the team does not fit there', () => {
    const blocker = team('blocker', 12, ['mon'], { c: 4, d: 4, e: 4 })
    const p = project(floors(), [blocker, team('alpha', 4, ['mon'], {}, { homeFloorId: '4' })])
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ a: 4 })
  })

  it('does not split a team that fits on one floor', () => {
    // Floor 3 comes first but has 8 desks; floor 4 has 12.
    const p = project(floors(), [team('alpha', 10, ['mon'])])
    const result = seat(p)
    const status = teamDayStatus(result.project, teamOf(result.project, 'alpha'), 'mon')
    expect(status.seated).toBe(10)
    expect(status.floorIds).toEqual(['4'])
  })

  it('splits a team over floors when no floor has room for it, the floor with the most free seats first', () => {
    const p = project(floors(), [team('alpha', 14, ['mon'])])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 2, c: 4, d: 4, e: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({})
    expect(outcomeOf(result, 'alpha')).toEqual({
      teamId: 'alpha',
      result: 'seated',
      message: 'Split over Floor 3 and Floor 4 on Monday: no floor has 14 free desks',
    })
  })

  it('names all days that are split in the same way together', () => {
    const p = project(floors(), [team('alpha', 14, ['tue', 'thu'])])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 2, c: 4, d: 4, e: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({})
    expect(outcomeOf(result, 'alpha').message).toBe(
      'Split over Floor 3 and Floor 4 on Tuesday and Thursday: no floor has 14 free desks',
    )
  })

  it('puts the rest of a half seated team on another floor only when its own floor is full', () => {
    const blocker = team('blocker', 4, ['mon'], { b: 4 })
    const p = project(floors(), [blocker, team('alpha', 8, ['mon'], { a: 4 })])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4, c: 4 })
    expect(outcomeOf(result, 'alpha').message).toBe(
      'Split over Floor 3 and Floor 4 on Monday: Floor 3 has no room for the 4 seats still missing',
    )
  })

  it('adds seats where a team sits rather than opening one more area', () => {
    // The team sits on both floors. Floor 3 has two seats left in B, an area it sits in;
    // floor 4 has a free area right next to its seats there, which would be a third area.
    const at = (id: string, x: number, capacity: number) => area(id, capacity, { rect: { x, y: 0.1, w: 0.1, h: 0.2 } })
    const p = project(
      [floor('3', [at('a', 0.05, 4), at('b', 0.21, 4)]), floor('4', [at('c', 0.05, 4), at('d', 0.16, 4)])],
      [team('alpha', 12, ['mon'], { a: 4, b: 2, c: 4 })],
    )
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ a: 4, b: 4, c: 4 })
  })

  it('names every floor that is full when a team that sits on two floors needs a third', () => {
    const p = project(
      [floor('3', [area('a', 4)]), floor('4', [area('b', 4)]), floor('5', [area('c', 4)])],
      [team('alpha', 9, ['mon'], { a: 4, b: 4 })],
    )
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4, b: 4, c: 1 })
    expect(outcomeOf(result, 'alpha').message).toBe(
      'Split over Floor 3, Floor 4 and Floor 5 on Monday: ' +
        'Floor 3 and Floor 4 have no room for the 1 seat still missing',
    )
  })
})

// ---------------------------------------------------------------------------
// Day exceptions
// ---------------------------------------------------------------------------

describe('autoSeat: days that need their own seating', () => {
  it('seats three teams that pairwise share a day on two areas', () => {
    const p = project(
      [floor('1', row(['p', 'q'], 4))],
      [team('a', 4, ['mon', 'tue']), team('b', 4, ['tue', 'wed']), team('c', 4, ['mon', 'wed'])],
    )
    const result = seat(p)
    expect(shortDays(result.project)).toEqual([])
    expect(overbooked(result.project)).toEqual([])
    expect(teamOf(result.project, 'a')).toMatchObject({ seating: { p: 4 }, daySeating: {} })
    expect(teamOf(result.project, 'b')).toMatchObject({ seating: { q: 4 }, daySeating: {} })
    // No area is free on both of C's days: Q on Monday, P on Wednesday.
    expect(teamOf(result.project, 'c').seating).toEqual({ q: 4 })
    expect(teamOf(result.project, 'c').daySeating).toEqual({ wed: { p: 4 } })
    expect(result.outcomes).toEqual([
      { teamId: 'a', result: 'seated', message: 'Seated in P on Floor 1' },
      { teamId: 'b', result: 'seated', message: 'Seated in Q on Floor 1' },
      { teamId: 'c', result: 'seated', message: 'Seated in Q on Floor 1, and on Wednesday in P' },
    ])
  })

  it('names the floor of an exception that is on another floor', () => {
    const tuesdayOn3 = team('blocker', 4, ['tue'], { a: 4 })
    const mondayOn4 = team('other', 4, ['mon'], { b: 4 })
    const p = project(
      [floor('3', [area('a', 4)]), floor('4', [area('b', 4)])],
      [tuesdayOn3, mondayOn4, team('alpha', 4, ['mon', 'tue'])],
    )
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({ tue: { b: 4 } })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in A on Floor 3, and on Tuesday in B on Floor 4')
  })

  it('makes what most days share the normal seating and the odd day the exception', () => {
    // Tuesday is full. Monday and Wednesday end up in the same area.
    const tuesday = [team('x', 4, ['tue'], { a: 4 }), team('y', 4, ['tue'], { b: 4 })]
    const p = project([floor('4', row(['a', 'b'], 4))], [...tuesday, team('alpha', 4, ['mon', 'tue', 'wed'])])
    const result = seat(p)
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({ tue: {} })
    expect(outcomeOf(result, 'alpha')).toEqual({
      teamId: 'alpha',
      result: 'partly',
      message: 'Seated on Monday and Wednesday; no room on Tuesday: needs 4 seats, no desk is free',
    })
    expect(overbooked(result.project)).toEqual([])
  })

  it('gives days that are full in different ways each their own seating', () => {
    // No area is free on all three days, but every day has one free area.
    const others = [
      team('x', 8, ['mon'], { a: 4, b: 4 }),
      team('y', 8, ['tue'], { b: 4, c: 4 }),
      team('z', 8, ['wed'], { a: 4, c: 4 }),
    ]
    const p = project([floor('4', row(['a', 'b', 'c'], 4))], [...others, team('alpha', 4, ['mon', 'tue', 'wed'])])
    const result = seat(p)
    const alpha = teamOf(result.project, 'alpha')
    expect(seatingOn(alpha, 'mon')).toEqual({ c: 4 })
    expect(seatingOn(alpha, 'tue')).toEqual({ a: 4 })
    expect(seatingOn(alpha, 'wed')).toEqual({ b: 4 })
    // The first day's seating is the normal one.
    expect(alpha.seating).toEqual({ c: 4 })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in C on Floor 4, on Tuesday in A, and on Wednesday in B')
  })
})

// ---------------------------------------------------------------------------
// No room
// ---------------------------------------------------------------------------

describe('autoSeat: not enough room', () => {
  it('leaves the team untouched and says the numbers', () => {
    const blocker = team('blocker', 4, ['thu'], { a: 4 })
    const p = project([floor('4', row(['a', 'b'], 4))], [blocker, team('alpha', 12, ['tue', 'thu'])])
    const result = seat(p)
    expect(result.project).toBe(p)
    expect(result.outcomes).toEqual([
      {
        teamId: 'alpha',
        result: 'unseated',
        message: 'No room on Tuesday and Thursday: needs 12 seats, at most 8 desks are free',
      },
    ])
  })

  it('does not place a part of the team', () => {
    const p = project([floor('4', row(['a', 'b'], 4))], [team('alpha', 9, ['thu'])])
    const result = seat(p)
    expect(result.project).toBe(p)
    expect(outcomeOf(result, 'alpha')).toEqual({
      teamId: 'alpha',
      result: 'unseated',
      message: 'No room on Thursday: needs 9 seats, 8 desks are free',
    })
  })

  it('seats the days that work and reports the day that does not', () => {
    const blocker = team('blocker', 5, ['thu'], { a: 5 })
    const p = project([floor('4', row(['a', 'b'], 5))], [blocker, team('alpha', 9, ['tue', 'thu'])])
    const result = seat(p)
    const alpha = teamOf(result.project, 'alpha')
    expect(seatingOn(alpha, 'tue')).toEqual({ a: 5, b: 4 })
    expect(seatingOn(alpha, 'thu')).toEqual({})
    expect(outcomeOf(result, 'alpha')).toEqual({
      teamId: 'alpha',
      result: 'partly',
      message: 'Seated on Tuesday; no room on Thursday: needs 9 seats, 5 desks are free',
    })
    expect(overbooked(result.project)).toEqual([])
  })

  it('keeps the seats a team holds on a day it cannot complete, and counts only what is missing', () => {
    const blocker = team('blocker', 3, ['mon'], { b: 3 })
    const alpha = team('alpha', 8, ['mon'], { a: 4 })
    const p = project([floor('4', row(['a', 'b'], 4))], [blocker, alpha])
    const result = seat(p)
    expect(result.project).toBe(p)
    expect(outcomeOf(result, 'alpha')).toEqual({
      teamId: 'alpha',
      result: 'unseated',
      message: 'No room on Monday: needs 4 more seats, 1 desk is free',
    })
  })

  it('has an answer for a building without floors or without desks', () => {
    const noFloors = project([], [team('alpha', 4, ['mon'])])
    expect(seat(noFloors)).toEqual({
      project: noFloors,
      outcomes: [{ teamId: 'alpha', result: 'unseated', message: 'No room on Monday: needs 4 seats, no desk is free' }],
    })
    const noDesks = project([floor('4', [])], [team('alpha', 1, ['mon', 'fri'])])
    expect(outcomeOf(seat(noDesks, { useOverflow: true }), 'alpha').message).toBe(
      'No room on Monday and Friday: needs 1 seat, no desk or overflow seat is free',
    )
  })

  it('leaves a team it cannot help exactly as it is, mistakes included', () => {
    const room = area('room', 8, { kind: 'no-seating', rect: below(0) })
    // Two of six seats, three more in a room, and no desk left.
    const inRoom = team('alpha', 6, ['mon'], { a: 2, room: 3 })
    const p = project([floor('4', [...row(['a'], 2), room])], [inRoom])
    expect(seat(p).project).toBe(p)

    // Seated day by day and short on Tuesday, with Tuesday full.
    const dayByDay = team('beta', 4, ['mon', 'tue'], {}, { daySeating: { mon: { a: 4 }, tue: { b: 2 } } })
    const blocker = team('blocker', 2, ['tue'], { b: 2 })
    const q = project([floor('4', [...row(['a', 'b'], 4)])], [dayByDay, blocker, team('other', 4, ['tue'], { a: 4 })])
    const result = seat(q)
    expect(result.project).toBe(q)
    expect(outcomeOf(result, 'beta').message).toBe(
      'Seated on Monday; no room on Tuesday: needs 2 more seats, no desk is free',
    )
  })

  it('gives the largest numbers when days are short in different ways', () => {
    // Monday: 4 of 8 seats in A, 2 desks free. Tuesday: 2 of 8 seats in B, 4 desks free.
    const blocker = team('blocker', 2, ['mon', 'tue'], { b: 2 })
    const alpha = team('alpha', 8, ['mon', 'tue'], { a: 4 }, { daySeating: { tue: { b: 2 } } })
    const p = project([floor('4', row(['a', 'b'], 4))], [blocker, alpha])
    const result = seat(p)
    expect(result.project).toBe(p)
    expect(outcomeOf(result, 'alpha').message).toBe(
      'No room on Monday and Tuesday: needs up to 6 more seats, at most 4 desks are free',
    )
  })

  it('takes the seats away on a restart that finds no room', () => {
    const p = project([floor('4', row(['a', 'b'], 4))], [team('alpha', 9, ['mon'], { a: 4 })])
    const result = seat(p, { restart: true })
    expect(teamOf(result.project, 'alpha').seating).toEqual({})
    expect(outcomeOf(result, 'alpha').result).toBe('unseated')
  })
})

// ---------------------------------------------------------------------------
// Overflow seats and rooms
// ---------------------------------------------------------------------------

describe('autoSeat: overflow seats and rooms', () => {
  const bench = (): Area => area('bench', 4, { kind: 'overflow', rect: { x: 0.16, y: 0.1, w: 0.1, h: 0.2 } })
  const room = (): Area => area('room', 12, { kind: 'no-seating', rect: below(0) })

  it('does not use overflow seats unless asked to', () => {
    const p = project([floor('4', [...row(['a'], 4), bench()])], [team('alpha', 6, ['mon'])])
    const result = seat(p)
    expect(result.project).toBe(p)
    expect(outcomeOf(result, 'alpha').message).toBe('No room on Monday: needs 6 seats, 4 desks are free')
  })

  it('uses overflow seats next to the desks with useOverflow', () => {
    const p = project([floor('4', [...row(['a'], 4), bench()])], [team('alpha', 6, ['mon'])])
    const result = seat(p, { useOverflow: true })
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4, bench: 2 })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in A and BENCH on Floor 4')
    expect(outcomeOf(result, 'alpha').result).toBe('seated')
  })

  it('fills the desks before the overflow seats next to them', () => {
    // The table comes first on the floor and could hold the whole team on its own.
    const table = area('table', 6, { kind: 'overflow', rect: { x: 0.16, y: 0.1, w: 0.1, h: 0.2 } })
    const p = project([floor('4', [table, ...row(['a'], 4)])], [team('alpha', 6, ['mon'])])
    expect(teamOf(seat(p, { useOverflow: true }).project, 'alpha').seating).toEqual({ a: 4, table: 2 })
  })

  it('keeps the team together at an overflow table rather than spreading it over odd desks', () => {
    // Two desks at either end of the floor, and a table for six that is next to neither.
    const table = area('table', 6, { kind: 'overflow', rect: { x: 0.4, y: 0.1, w: 0.1, h: 0.2 } })
    const areas = [area('a', 2, { rect: below(0) }), area('b', 2, { rect: below(7) }), table]
    const p = project([floor('4', areas)], [team('alpha', 6, ['mon'])])
    expect(teamOf(seat(p, { useOverflow: true }).project, 'alpha').seating).toEqual({ table: 6 })
  })

  it('leaves overflow seats alone while there are desks', () => {
    const p = project([floor('4', [bench(), ...row(['a'], 4)])], [team('alpha', 4, ['mon'])])
    expect(teamOf(seat(p, { useOverflow: true }).project, 'alpha').seating).toEqual({ a: 4 })
  })

  it('uses overflow seats only on the day that is too busy for desks', () => {
    const blocker = team('blocker', 4, ['tue'], { a: 4 })
    const p = project([floor('4', [...row(['a'], 4), bench()])], [blocker, team('alpha', 4, ['mon', 'tue'])])
    const result = seat(p, { useOverflow: true })
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'alpha').daySeating).toEqual({ tue: { bench: 4 } })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in A on Floor 4, and on Tuesday in BENCH')
  })

  it('counts overflow seats in the numbers when they may be used', () => {
    const p = project([floor('4', [...row(['a'], 4), bench()])], [team('alpha', 9, ['mon'])])
    expect(outcomeOf(seat(p, { useOverflow: true }), 'alpha').message).toBe(
      'No room on Monday: needs 9 seats, 8 desks and overflow seats are free',
    )
  })

  it('prefers one floor with overflow seats to a split over floors', () => {
    const p = project(
      [floor('3', [...row(['a'], 4), bench()]), floor('4', row(['c'], 4))],
      [team('alpha', 8, ['mon'])],
    )
    const result = seat(p, { useOverflow: true })
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4, bench: 4 })
    expect(outcomeOf(result, 'alpha').message).toBe('Seated in A and BENCH on Floor 3')
    // Without overflow seats the split is all that is left.
    expect(teamOf(seat(p).project, 'alpha').seating).toEqual({ a: 4, c: 4 })
  })

  it('splits over floors with overflow seats when the desks of all floors are not enough', () => {
    const p = project(
      [floor('3', [...row(['a'], 4), bench()]), floor('4', row(['c'], 4))],
      [team('alpha', 10, ['mon'])],
    )
    const result = seat(p, { useOverflow: true })
    expect(teamOf(result.project, 'alpha').seating).toEqual({ a: 4, bench: 4, c: 2 })
    expect(outcomeOf(result, 'alpha').message).toBe(
      'Split over Floor 3 and Floor 4 on Monday: no floor has 10 free seats',
    )
  })

  it('never seats a team in a room', () => {
    const p = project([floor('4', [...row(['a'], 2), room()])], [team('alpha', 4, ['mon'])])
    for (const options of [{}, { useOverflow: true }, { restart: true, useOverflow: true }]) {
      const result = seat(p, options)
      expect(result.project).toBe(p)
      expect(outcomeOf(result, 'alpha').result).toBe('unseated')
    }
    expect(outcomeOf(seat(p), 'alpha').message).toBe('No room on Monday: needs 4 seats, 2 desks are free')
  })
})

// ---------------------------------------------------------------------------
// Which teams, and what is left alone
// ---------------------------------------------------------------------------

describe('autoSeat: which teams are seated', () => {
  const areas = row(['a', 'b', 'c', 'd'], 4)

  it('seats every team that is short on one of its days when no teams are named', () => {
    const p = project(
      [floor('4', areas)],
      [team('done', 4, ['mon'], { a: 4 }), team('open', 4, ['mon']), team('half', 4, ['mon'], { d: 2 })],
    )
    const result = seat(p)
    expect(result.outcomes.map((o) => o.teamId)).toEqual(['open', 'half'])
    expect(shortDays(result.project)).toEqual([])
  })

  it('seats only the teams that are named and leaves every other team the same object', () => {
    const teams = [team('alpha', 4, ['mon']), team('beta', 4, ['mon']), team('gamma', 4, ['mon'])]
    const p = project([floor('4', areas)], teams)
    const result = seat(p, { teamIds: ['beta'] })
    expect(result.outcomes.map((o) => o.teamId)).toEqual(['beta'])
    expect(teamOf(result.project, 'beta').seating).toEqual({ a: 4 })
    expect(teamOf(result.project, 'alpha')).toBe(teamOf(p, 'alpha'))
    expect(teamOf(result.project, 'gamma')).toBe(teamOf(p, 'gamma'))
  })

  it('reports teams in list order and ignores ids that match no team', () => {
    const teams = [team('alpha', 2, ['mon']), team('beta', 4, ['mon']), team('gamma', 3, ['mon'])]
    const p = project([floor('4', areas)], teams)
    const result = seat(p, { teamIds: ['gamma', 'nobody', 'alpha', 'gamma'] })
    expect(result.outcomes.map((o) => o.teamId)).toEqual(['alpha', 'gamma'])
  })

  it('does nothing for an empty list of teams', () => {
    const p = project([floor('4', areas)], [team('alpha', 4, ['mon'])])
    const result = seat(p, { teamIds: [] })
    expect(result).toEqual({ project: p, outcomes: [] })
    expect(result.project).toBe(p)
  })

  it('reports teams that need nothing as unchanged and leaves them alone', () => {
    const p = project(
      [floor('4', areas)],
      [
        team('nodays', 4, [], { a: 1 }),
        team('nobody', 0, ['mon']),
        team('done', 4, ['mon'], { b: 4 }),
        team('roomy', 2, ['mon'], { c: 4 }),
      ],
    )
    const result = seat(p, { teamIds: ['nodays', 'nobody', 'done', 'roomy'] })
    expect(result.project).toBe(p)
    expect(result.outcomes).toEqual([
      { teamId: 'nodays', result: 'unchanged', message: 'Has no team day' },
      { teamId: 'nobody', result: 'unchanged', message: 'Needs no seats' },
      { teamId: 'done', result: 'unchanged', message: 'Already has all its seats' },
      { teamId: 'roomy', result: 'unchanged', message: 'Already has all its seats' },
    ])
    // Not even a restart touches a team without a team day or without people.
    const restarted = seat(p, { teamIds: ['nodays', 'nobody'], restart: true })
    expect(restarted.project).toBe(p)
    expect(restarted.outcomes.map((o) => o.result)).toEqual(['unchanged', 'unchanged'])
  })

  it('returns the same project when nothing is to be done', () => {
    const p = project([floor('4', areas)], [team('alpha', 4, ['mon'], { a: 4 })])
    expect(seat(p)).toEqual({ project: p, outcomes: [] })
    expect(seat(p).project).toBe(p)
  })

  it('returns the same project when a restart ends where the team already sat', () => {
    const p = project([floor('4', areas)], [team('alpha', 4, ['mon'], { a: 4 })])
    const result = seat(p, { restart: true, teamIds: ['alpha'] })
    expect(result.project).toBe(p)
    expect(outcomeOf(result, 'alpha')).toEqual({ teamId: 'alpha', result: 'seated', message: 'Seated in A on Floor 4' })
  })

  it('restarts the named teams together: their seats are free for each other', () => {
    // Small sits in the middle. Large can only sit in one run when Small gives way.
    const p = project(
      [floor('4', row(['a', 'b', 'c'], 4))],
      [team('small', 4, ['mon'], { b: 4 }), team('large', 8, ['mon'])],
    )
    const result = seat(p, { restart: true, teamIds: ['small', 'large'] })
    expect(teamOf(result.project, 'large').seating).toEqual({ a: 4, b: 4 })
    expect(teamOf(result.project, 'small').seating).toEqual({ c: 4 })
  })

  it('does not move a team that is not restarted, even when it is in the way', () => {
    const p = project(
      [floor('4', row(['a', 'b', 'c'], 4))],
      [team('small', 4, ['mon'], { b: 4 }), team('large', 8, ['mon'])],
    )
    const result = seat(p, { restart: true, teamIds: ['large'] })
    expect(teamOf(result.project, 'small')).toBe(teamOf(p, 'small'))
    expect(teamOf(result.project, 'large').seating).toEqual({ a: 4, c: 4 })
  })

  it('finds nothing more to do in its own proposal', () => {
    const p = project(
      [floor('4', row(['a', 'b'], 4))],
      [
        team('a', 4, ['mon', 'tue']),
        team('b', 4, ['tue', 'wed']),
        team('c', 4, ['mon', 'wed']),
        team('late', 4, ['tue']),
      ],
    )
    const first = seat(p)
    expect(outcomeOf(first, 'late').result).toBe('unseated')
    const second = seat(first.project)
    expect(second.project).toBe(first.project)
    expect(second.outcomes).toEqual([outcomeOf(first, 'late')])
  })

  it('does not depend on the key order of seatings, wishes or exceptions', () => {
    const build = (seating: Seating, daySeating: Partial<Record<Weekday, Seating>>) =>
      project([floor('4', row(['a', 'b', 'c', 'd'], 4))], [team('alpha', 11, ['tue', 'thu'], seating, { daySeating })])
    const one = seat(build({ a: 2, c: 1 }, { tue: { d: 1, b: 2 }, thu: { a: 1 } }))
    const other = seat(build({ c: 1, a: 2 }, { thu: { a: 1 }, tue: { b: 2, d: 1 } }))
    expect(other).toStrictEqual(one)
    expect(JSON.stringify(other)).toBe(JSON.stringify(one))
    expect(shortDays(one.project)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// A whole office
// ---------------------------------------------------------------------------

describe('autoSeat: a whole office', () => {
  /** The real floor 4 (66 desks, 32 overflow seats, rooms) and a smaller floor 3. */
  function office(): Floor[] {
    const floor4: Floor = {
      id: 'f4',
      name: 'Floor 4',
      label: '4',
      plan: { src: '', width: FLOOR4_PLAN_SIZE.width, height: FLOOR4_PLAN_SIZE.height },
      areas: FLOOR4_AREAS,
    }
    const floor3 = floor('3', [
      ...row(['f3-a', 'f3-b', 'f3-c', 'f3-d'], 6),
      area('f3-table', 6, { kind: 'overflow', rect: below(0) }),
      area('f3-room', 10, { kind: 'no-seating', rect: below(3) }),
    ])
    return [floor3, floor4]
  }

  /** Invented teams; Tuesday needs 114 seats and the two floors have 90 desks. */
  function teams(): Team[] {
    const list: [string, number, Weekday[], string][] = [
      ['intake', 9, ['tue', 'thu'], 'Claims'],
      ['handling', 12, ['tue', 'thu'], 'Claims'],
      ['underwriting', 10, ['tue', 'wed'], 'Policy'],
      ['admin', 8, ['mon', 'wed'], 'Policy'],
      ['portal', 7, ['tue', 'thu'], 'Digital'],
      ['data', 6, ['tue', 'wed'], 'Digital'],
      ['broker', 8, ['tue', 'thu'], 'Digital'],
      ['finance', 11, ['tue', 'fri'], 'Corporate'],
      ['risk', 6, ['mon', 'tue'], 'Corporate'],
      ['architecture', 4, ['wed'], 'Corporate'],
      ['platform', 30, ['mon', 'tue', 'wed', 'thu', 'fri'], ''],
      ['sales', 15, ['tue', 'wed', 'thu'], ''],
    ]
    return list.map(([id, size, days, group]) => team(id, size, days, {}, { group }))
  }

  const variants: AutoSeatOptions[] = [
    {},
    { useOverflow: true },
    { restart: true },
    { restart: true, useOverflow: true },
  ]

  it('never books an area beyond its seats and never uses a room', () => {
    for (const options of variants) {
      const result = seat(project(office(), teams()), options)
      expect(overbooked(result.project)).toEqual([])
      expect(seatsInRooms(result.project)).toEqual([])
    }
  })

  it('never uses overflow seats without useOverflow', () => {
    const result = seat(project(office(), teams()))
    for (const t of result.project.teams) {
      for (const day of t.days) expect(teamDayStatus(result.project, t, day).inOverflow).toBe(0)
    }
  })

  it('seats every team day completely or not at all, and reports it truthfully', () => {
    for (const options of variants) {
      const result = seat(project(office(), teams()), options)
      expect(result.outcomes).toHaveLength(12)
      for (const outcome of result.outcomes) {
        const t = teamOf(result.project, outcome.teamId)
        const needed = seatsNeeded(t, result.project.settings)
        const seated = t.days.map((day) => teamDayStatus(result.project, t, day).seated)
        // A team was unseated when it came in, so a day is complete or empty.
        for (const seats of seated) expect([0, needed]).toContain(seats)
        const complete = seated.filter((seats) => seats === needed).length
        const expected = complete === t.days.length ? 'seated' : complete === 0 ? 'unseated' : 'partly'
        expect(outcome.result).toBe(expected)
      }
    }
  })

  it('seats more of the office with overflow seats than without', () => {
    const without = seat(project(office(), teams()))
    const withOverflow = seat(project(office(), teams()), { useOverflow: true })
    expect(shortDays(without.project).length).toBeGreaterThan(0)
    expect(shortDays(withOverflow.project).length).toBeLessThan(shortDays(without.project).length)
  })

  it('adds to a plan that is half made without touching the teams that are done', () => {
    const first = seat(project(office(), teams()), { teamIds: ['platform', 'handling', 'finance'] })
    expect(shortDays(first.project).filter((entry) => /^(platform|handling|finance) /.test(entry))).toEqual([])
    const second = seat(first.project)
    for (const id of ['platform', 'handling', 'finance']) {
      expect(teamOf(second.project, id)).toBe(teamOf(first.project, id))
    }
    expect(second.outcomes.map((o) => o.teamId)).not.toContain('platform')
    expect(overbooked(second.project)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Random offices
// ---------------------------------------------------------------------------

describe('autoSeat: random offices', () => {
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
   *  seats and rooms, and teams that are unseated, half seated, seated twice in the same
   *  place, or sitting in a room. */
  function randomOffice(seed: number): { p: Project; options: AutoSeatOptions } {
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
      if (chance(0.5)) return seating
      for (let i = 0; i <= upTo(2); i += 1) {
        const picked = areas[upTo(areas.length - 1)]
        if (picked) seating[picked.id] = 1 + upTo(picked.capacity)
      }
      return seating
    }
    const teams: Team[] = []
    for (let t = 0; t < upTo(7); t += 1) {
      const days = WEEKDAYS.filter(() => chance(0.4))
      const seating = someSeating()
      const daySeating: Partial<Record<Weekday, Seating>> = {}
      for (const day of days) {
        const own = someSeating()
        if (chance(0.25) && JSON.stringify(own) !== JSON.stringify(seating)) daySeating[day] = own
      }
      const homeFloor = chance(0.3) ? floors[upTo(floors.length - 1)] : undefined
      teams.push(
        team(`t${t}`, upTo(14), days, seating, {
          daySeating,
          group: chance(0.5) ? `group ${upTo(1)}` : '',
          homeFloorId: homeFloor?.id ?? null,
          attendance: chance(0.2) ? 0.6 : null,
        }),
      )
    }

    const options: AutoSeatOptions = { restart: chance(0.4), useOverflow: chance(0.4) }
    if (chance(0.4)) options.teamIds = [...teams.filter(() => chance(0.6)).map((t) => t.id), 'nobody']
    return { p: project(floors, teams), options }
  }

  it('keeps its promises whatever the office looks like', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const { p, options } = randomOffice(seed)
      const where = `office ${seed} with ${JSON.stringify(options)}`
      expect(violations(p), where).toEqual([])
      const result = seat(p, options)
      const kindOf = new Map(p.floors.flatMap((f) => f.areas).map((a) => [a.id, a.kind]))

      for (const before of p.teams) {
        const after = teamOf(result.project, before.id)
        const outcome = result.outcomes.find((o) => o.teamId === before.id)
        // A team that was not asked for, or that needed nothing, is the very same object.
        if (!outcome || outcome.result === 'unchanged') {
          expect(after, where).toBe(before)
          continue
        }
        const needed = seatsNeeded(before, p.settings)
        let complete = 0
        for (const day of before.days) {
          const had = options.restart ? {} : seatingOn(before, day)
          const has = seatingOn(after, day)
          const seatedBefore = options.restart ? 0 : teamDayStatus(p, before, day).seated
          const seatedAfter = teamDayStatus(result.project, after, day).seated
          if (seatedAfter >= needed) complete += 1
          // A day is completed or left as it was: never half a team.
          const allowed = [seatedBefore, Math.max(seatedBefore, needed)]
          expect(allowed, `${where}: ${before.id} on ${day}`).toContain(seatedAfter)
          for (const areaId of Object.keys({ ...had, ...has })) {
            const kind = kindOf.get(areaId)
            const gained = (has[areaId] ?? 0) - (had[areaId] ?? 0)
            const here = `${where}: ${before.id} in ${areaId} on ${day}`
            // Seats in desk and overflow areas are never taken away,
            if (kind !== 'no-seating') expect(gained, here).toBeGreaterThanOrEqual(0)
            if (gained <= 0) continue
            // and seats are only added where that is allowed and where there is room.
            expect(kind, here).toBe(options.useOverflow && kind === 'overflow' ? 'overflow' : 'desks')
            expect(dayOccupancy(result.project, day).get(areaId)?.free, here).toBeGreaterThanOrEqual(0)
          }
        }
        const expected = complete === before.days.length ? 'seated' : complete === 0 ? 'unseated' : 'partly'
        expect(outcome.result, `${where}: ${before.id}, "${outcome.message}"`).toBe(expected)
      }
      // Nothing changed means the same project, not a copy.
      const changed = result.project.teams.some((t, i) => t !== p.teams[i])
      expect(result.project === p, where).toBe(!changed)
    }
  })
})
