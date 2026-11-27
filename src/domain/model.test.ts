import { describe, expect, it } from 'vitest'
import { TEAM_COLORS } from './color'
import { FLOOR4_AREAS, FLOOR4_PLAN_SIZE } from './floor4'
import {
  MIN_RECT_SIZE,
  clampRect,
  copyFloor,
  dayLevel,
  dayLoad,
  dayOccupancy,
  describeSeating,
  emptyProject,
  findFloor,
  findTeam,
  floorCapacity,
  floorLabelFromName,
  floorLoad,
  freeOnDays,
  hasDayException,
  indexAreas,
  isSeatable,
  isTeamDay,
  makeArea,
  makeFloor,
  makeTeam,
  newId,
  nextAreaName,
  planAspect,
  plannableDesks,
  projectCapacity,
  sameSeating,
  seatingOn,
  seatsNeeded,
  sortDays,
  sumSeats,
  teamCode,
  teamDayStatus,
  wishesFromDays,
  type AreaOccupancy,
} from './model'
import { area, floor, project, team, violations } from './testkit'
import {
  DEFAULT_SETTINGS,
  WEEKDAYS,
  type Area,
  type AreaKind,
  type Floor,
  type Project,
  type Rect,
  type Seating,
  type Settings,
  type Team,
  type Weekday,
} from './types'

/** The building of the examples, lowest floor first:
 *    Floor 1: desks A1 (4), A2 (4) and A3 (2), an overflow bench (3) and a meeting room (6)
 *    Floor 2: desks B1 (6) and B2 (4)
 *  20 desks and 3 overflow seats in all. */
function building(): Floor[] {
  return [
    floor('1', [
      area('a1', 4),
      area('a2', 4),
      area('a3', 2),
      area('bench', 3, { kind: 'overflow' }),
      area('room', 6, { kind: 'no-seating' }),
    ]),
    floor('2', [area('b1', 6), area('b2', 4)]),
  ]
}

function plan(teams: Team[] = [], settings: Partial<Settings> = {}): Project {
  return project(building(), teams, settings)
}

function floorOf(p: Project, id: string): Floor {
  const found = findFloor(p, id)
  if (!found) throw new Error(`no floor ${id}`)
  return found
}

function occupancyOf(p: Project, day: Weekday, areaId: string): AreaOccupancy {
  const found = dayOccupancy(p, day).get(areaId)
  if (!found) throw new Error(`no occupancy for area ${areaId}`)
  return found
}

/** One floor with a single desk area of the given size, to study building-wide numbers. */
function hall(desks: number, settings: Partial<Settings> = {}, teams: Team[] = []): Project {
  return project([floor('1', [area('hall', desks)])], teams, settings)
}

/** A small seeded pseudo random generator (mulberry32). The same seed gives the same run,
 *  so a failure can be repeated. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

describe('seatsNeeded', () => {
  const at = (attendance: number): Settings => ({ attendance, reserve: 0 })
  const sized = (size: number, attendance: number | null = null) => team('t', size, [], {}, { attendance })

  it('is 0 for a team without people, whatever the attendance', () => {
    expect(seatsNeeded(sized(0), at(1))).toBe(0)
    expect(seatsNeeded(sized(0), at(0.1))).toBe(0)
    expect(seatsNeeded(sized(0, 0.5), at(1))).toBe(0)
  })

  it('is 0 for a size that makes no sense', () => {
    expect(seatsNeeded(sized(-3), at(1))).toBe(0)
    expect(seatsNeeded(sized(Number.NaN), at(1))).toBe(0)
  })

  it('gives everyone a seat at full attendance', () => {
    for (const size of [1, 2, 7, 12, 66, 250]) expect(seatsNeeded(sized(size), at(1))).toBe(size)
  })

  it('gives a team with people at least one seat', () => {
    expect(seatsNeeded(sized(1), at(0.1))).toBe(1)
    expect(seatsNeeded(sized(2), at(0.1))).toBe(1)
    expect(seatsNeeded(sized(4), at(0.1))).toBe(1)
    expect(seatsNeeded(sized(1), at(0.5))).toBe(1)
    // Also with an attendance of next to nothing, or (wrongly) of nothing at all.
    expect(seatsNeeded(sized(5, 0.000000001), at(1))).toBe(1)
    expect(seatsNeeded(sized(5, 0), at(1))).toBe(1)
  })

  it('rounds up to whole seats', () => {
    expect(seatsNeeded(sized(9), at(0.8))).toBe(8) // 7.2
    expect(seatsNeeded(sized(3), at(0.34))).toBe(2) // 1.02
    expect(seatsNeeded(sized(11), at(0.5))).toBe(6) // 5.5
    expect(seatsNeeded(sized(7), at(0.9))).toBe(7) // 6.3
  })

  it.each([
    // size, attendance, seats. The product in floating point is noted where it is not exact.
    [100, 0.55, 55], // 55.00000000000001
    [25, 0.28, 7], // 7.000000000000001
    [100, 0.07, 7], // 7.000000000000001
    [100, 0.14, 14], // 14.000000000000002
    [10, 0.1 + 0.2, 3], // an attendance of 0.30000000000000004
    [10, 0.8, 8],
    [9, 0.8, 8],
    [3, 0.34, 2],
    [10, 0.7, 7],
    [20, 0.15, 3],
    [50, 0.58, 29], // 28.999999999999996
  ])('does not trip over floating point: %d people at %f need %d seats', (size, attendance, expected) => {
    expect(seatsNeeded(sized(size), at(attendance))).toBe(expected)
    expect(seatsNeeded(sized(size, attendance), at(1))).toBe(expected)
  })

  it('agrees with whole-number arithmetic for every size up to 300 at every whole percentage', () => {
    const wrong: string[] = []
    for (let size = 1; size <= 300; size += 1) {
      for (let percent = 1; percent <= 100; percent += 1) {
        const hundredths = size * percent
        const expected = Math.max(1, Math.floor(hundredths / 100) + (hundredths % 100 === 0 ? 0 : 1))
        const actual = seatsNeeded(sized(size), at(percent / 100))
        if (actual !== expected) wrong.push(`${size} people at ${percent}%: ${actual} instead of ${expected}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it("lets the team's own attendance beat the setting, in both directions", () => {
    expect(seatsNeeded(sized(10, 0.5), at(1))).toBe(5)
    expect(seatsNeeded(sized(10, 1), at(0.5))).toBe(10)
    expect(seatsNeeded(sized(10, null), at(0.5))).toBe(5)
  })
})

describe('isTeamDay and hasDayException', () => {
  const alpha = team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: {} } })

  it('knows the planned days', () => {
    expect(WEEKDAYS.filter((day) => isTeamDay(alpha, day))).toEqual(['tue', 'thu'])
  })

  it('sees an exception wherever a day has its own seating, also an empty one', () => {
    expect(hasDayException(alpha, 'tue')).toBe(false)
    expect(hasDayException(alpha, 'thu')).toBe(true)
    expect(hasDayException(alpha, 'mon')).toBe(false)
  })
})

describe('seatingOn', () => {
  it('gives nothing on a day that is not a team day', () => {
    const alpha = team('alpha', 8, ['tue', 'thu'], { a1: 4, a2: 4 })
    for (const day of ['mon', 'wed', 'fri'] as const) expect(seatingOn(alpha, day)).toEqual({})
  })

  it('gives the normal seating on a team day without exception', () => {
    const alpha = team('alpha', 8, ['tue', 'thu'], { a1: 4, a2: 4 })
    expect(seatingOn(alpha, 'tue')).toBe(alpha.seating)
    expect(seatingOn(alpha, 'thu')).toBe(alpha.seating)
  })

  it('lets an exception replace the normal seating completely, without mixing the two', () => {
    const alpha = team('alpha', 8, ['tue', 'thu'], { a1: 4, a2: 4 }, { daySeating: { thu: { b1: 6 } } })
    expect(seatingOn(alpha, 'thu')).toEqual({ b1: 6 })
    expect(seatingOn(alpha, 'tue')).toEqual({ a1: 4, a2: 4 })
  })

  it('gives nothing for an empty exception', () => {
    const alpha = team('alpha', 8, ['tue', 'thu'], { a1: 4, a2: 4 }, { daySeating: { thu: {} } })
    expect(seatingOn(alpha, 'thu')).toEqual({})
  })

  it('gives nothing on a day that is not a team day even when a seating is left over for it', () => {
    const alpha: Team = { ...team('alpha', 8, ['tue'], { a1: 4 }), daySeating: { wed: { a2: 4 } } }
    expect(seatingOn(alpha, 'wed')).toEqual({})
  })

  it('does not hand out an empty seating that could be filled by accident', () => {
    const alpha = team('alpha', 8, ['tue'], { a1: 4 })
    expect(Object.isFrozen(seatingOn(alpha, 'mon'))).toBe(true)
  })
})

describe('sortDays and wishesFromDays', () => {
  it('puts days in week order and drops repeats', () => {
    expect(sortDays(['thu', 'mon', 'thu', 'tue'])).toEqual(['mon', 'tue', 'thu'])
    expect(sortDays([])).toEqual([])
    expect(sortDays(new Set<Weekday>(['fri', 'wed']))).toEqual(['wed', 'fri'])
    expect(sortDays([...WEEKDAYS].reverse())).toEqual([...WEEKDAYS])
  })

  it('wants the given days and says nothing about the others', () => {
    expect(wishesFromDays(['thu', 'tue'])).toEqual({ mon: 'none', tue: 'want', wed: 'none', thu: 'want', fri: 'none' })
    expect(wishesFromDays([])).toEqual({ mon: 'none', tue: 'none', wed: 'none', thu: 'none', fri: 'none' })
  })
})

describe('sumSeats and sameSeating', () => {
  it('adds up the seats of a seating', () => {
    expect(sumSeats({})).toBe(0)
    expect(sumSeats({ a1: 4 })).toBe(4)
    expect(sumSeats({ a1: 4, b1: 2, bench: 1 })).toBe(7)
  })

  it('calls two seatings the same when they hold the same seats in the same areas', () => {
    expect(sameSeating({}, {})).toBe(true)
    expect(sameSeating({ a1: 4, a2: 2 }, { a2: 2, a1: 4 })).toBe(true)
  })

  it('tells seatings apart by count, by area and by size', () => {
    expect(sameSeating({ a1: 4 }, { a1: 3 })).toBe(false)
    expect(sameSeating({ a1: 4 }, { a2: 4 })).toBe(false)
    expect(sameSeating({ a1: 4 }, { a1: 4, a2: 1 })).toBe(false)
    expect(sameSeating({ a1: 4, a2: 1 }, { a1: 4 })).toBe(false)
    expect(sameSeating({}, { a1: 1 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Floors and areas
// ---------------------------------------------------------------------------

describe('indexAreas, findTeam and findFloor', () => {
  const p = plan([team('alpha', 4), team('beta', 2)])

  it('finds every area of every floor, with the floor it is on', () => {
    const index = indexAreas(p)
    expect([...index.keys()]).toEqual(['a1', 'a2', 'a3', 'bench', 'room', 'b1', 'b2'])
    for (const f of p.floors) {
      for (const a of f.areas) {
        expect(index.get(a.id)?.area).toBe(a)
        expect(index.get(a.id)?.floor).toBe(f)
      }
    }
    expect(index.get('ghost')).toBeUndefined()
  })

  it('finds a team or a floor by id', () => {
    expect(findTeam(p, 'beta')?.id).toBe('beta')
    expect(findFloor(p, '2')?.id).toBe('2')
  })

  it('finds nothing for an unknown or missing id', () => {
    for (const id of ['ghost', '', null, undefined]) {
      expect(findTeam(p, id)).toBeUndefined()
      expect(findFloor(p, id)).toBeUndefined()
    }
  })
})

describe('isSeatable', () => {
  it('allows seating at desks and in overflow areas, never in rooms', () => {
    expect(isSeatable('desks')).toBe(true)
    expect(isSeatable('overflow')).toBe(true)
    expect(isSeatable('no-seating')).toBe(false)
  })
})

describe('floorCapacity and projectCapacity', () => {
  it('counts desks and overflow seats apart and leaves the chairs in rooms out', () => {
    const p = plan()
    expect(floorCapacity(floorOf(p, '1'))).toEqual({ desks: 10, overflow: 3 })
    expect(floorCapacity(floorOf(p, '2'))).toEqual({ desks: 10, overflow: 0 })
  })

  it('adds up the floors for the building', () => {
    expect(projectCapacity(plan())).toEqual({ desks: 20, overflow: 3 })
  })

  it('is zero for a floor without areas and for an empty project', () => {
    expect(floorCapacity(floor('empty', []))).toEqual({ desks: 0, overflow: 0 })
    expect(projectCapacity(emptyProject())).toEqual({ desks: 0, overflow: 0 })
  })
})

describe('planAspect', () => {
  it('is the width of the drawing divided by its height', () => {
    const drawn: Floor = { ...floor('4', []), plan: { src: '', ...FLOOR4_PLAN_SIZE } }
    expect(planAspect(drawn)).toBeCloseTo(2000 / 710, 12)
  })

  it('is 2 for a floor without a drawing, or with a drawing whose size is unknown', () => {
    expect(planAspect(floor('1', []))).toBe(2)
    expect(planAspect({ ...floor('1', []), plan: { src: '', width: 0, height: 710 } })).toBe(2)
    expect(planAspect({ ...floor('1', []), plan: { src: '', width: 2000, height: 0 } })).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

describe('dayOccupancy', () => {
  // Alpha sits in A1 and A2, but on Thursday in B1. Beta joins A2 on Tuesday and holds seats
  // in an area that no longer exists. Gamma has A1 on Monday.
  const p = plan([
    team('alpha', 8, ['tue', 'thu'], { a1: 4, a2: 4 }, { daySeating: { thu: { b1: 6 } } }),
    team('beta', 3, ['tue'], { a2: 2, ghost: 5 }),
    team('gamma', 4, ['mon'], { a1: 4 }),
  ])

  it('has an entry for every area, also for empty ones and for rooms', () => {
    for (const day of WEEKDAYS) {
      expect([...dayOccupancy(p, day).keys()]).toEqual(['a1', 'a2', 'a3', 'bench', 'room', 'b1', 'b2'])
    }
    const empty = occupancyOf(p, 'wed', 'room')
    expect(empty).toEqual({ area: indexAreas(p).get('room')?.area, floorId: '1', teams: [], used: 0, free: 6 })
  })

  it('lists who holds how many seats, in team order', () => {
    expect(occupancyOf(p, 'tue', 'a1')).toMatchObject({ floorId: '1', teams: [{ teamId: 'alpha', seats: 4 }], used: 4, free: 0 })
    expect(occupancyOf(p, 'tue', 'a2').teams).toEqual([
      { teamId: 'alpha', seats: 4 },
      { teamId: 'beta', seats: 2 },
    ])
  })

  it('lets free go below zero when an area holds more than it has', () => {
    expect(occupancyOf(p, 'tue', 'a2')).toMatchObject({ used: 6, free: -2 })
  })

  it('counts a team with an exception at the exception and not at its normal seating', () => {
    expect(occupancyOf(p, 'thu', 'b1')).toMatchObject({ teams: [{ teamId: 'alpha', seats: 6 }], used: 6, free: 0 })
    expect(occupancyOf(p, 'thu', 'a1')).toMatchObject({ teams: [], used: 0, free: 4 })
    expect(occupancyOf(p, 'thu', 'a2')).toMatchObject({ teams: [], used: 0, free: 4 })
  })

  it('does not count a team on days that are not its team days', () => {
    expect(occupancyOf(p, 'mon', 'a1').teams).toEqual([{ teamId: 'gamma', seats: 4 }])
    expect(occupancyOf(p, 'mon', 'a2').teams).toEqual([])
    for (const occupancy of dayOccupancy(p, 'wed').values()) expect(occupancy.used).toBe(0)
    for (const occupancy of dayOccupancy(p, 'fri').values()) expect(occupancy.used).toBe(0)
  })

  it('ignores seats in areas that do not exist', () => {
    expect(dayOccupancy(p, 'tue').has('ghost')).toBe(false)
    let used = 0
    for (const occupancy of dayOccupancy(p, 'tue').values()) used += occupancy.used
    expect(used).toBe(4 + 4 + 2)
  })

  it('conserves seats: what the areas hold is what the teams hold in existing areas, on every day', () => {
    const random = seededRandom(20261127)
    for (let run = 0; run < 300; run += 1) {
      const candidate = randomProject(random)
      const areas = indexAreas(candidate)
      for (const day of WEEKDAYS) {
        const occupancy = dayOccupancy(candidate, day)
        expect(occupancy.size).toBe(areas.size)

        let heldByTeams = 0
        for (const t of candidate.teams) {
          const seating = seatingOn(t, day)
          for (const areaId of Object.keys(seating)) if (areas.has(areaId)) heldByTeams += seating[areaId] ?? 0
        }

        let usedInAreas = 0
        for (const occ of occupancy.values()) {
          usedInAreas += occ.used
          expect(occ.used).toBe(occ.teams.reduce((total, entry) => total + entry.seats, 0))
          expect(occ.free).toBe(occ.area.capacity - occ.used)
          expect(freeOnDays(candidate, occ.area.id, [day])).toBe(Math.max(0, occ.free))
        }
        expect(usedInAreas, `run ${run} on ${day}`).toBe(heldByTeams)
      }
    }
  })
})

/** A project with anything in it: areas of every kind, teams with any days, seatings that
 *  overbook areas or point at areas that do not exist, exceptions on any day. */
function randomProject(random: () => number): Project {
  const below = (n: number) => Math.floor(random() * n)
  const kinds: AreaKind[] = ['desks', 'desks', 'overflow', 'no-seating']
  const areaIds = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3']
  const randomArea = (id: string) => area(id, below(7), { kind: kinds[below(kinds.length)] })
  const floors = [floor('1', areaIds.slice(0, 4).map(randomArea)), floor('2', areaIds.slice(4).map(randomArea))]

  const places = [...areaIds, 'ghost-1', 'ghost-2']
  const randomSeating = (): Seating => {
    const seating: Seating = {}
    for (let i = below(4); i > 0; i -= 1) seating[places[below(places.length)] ?? 'ghost-1'] = 1 + below(5)
    return seating
  }

  const teams: Team[] = []
  for (let i = below(8); i > 0; i -= 1) {
    const days = WEEKDAYS.filter(() => random() < 0.4)
    const daySeating: Partial<Record<Weekday, Seating>> = {}
    for (const day of WEEKDAYS) if (random() < 0.2) daySeating[day] = randomSeating()
    teams.push(team(`team-${i}`, below(12), days, randomSeating(), { daySeating }))
  }
  return project(floors, teams)
}

describe('freeOnDays', () => {
  // A1 has 4 desks. Alpha holds 3 of them on Tuesday and Thursday, Beta 1 on Thursday.
  const p = plan([team('alpha', 3, ['tue', 'thu'], { a1: 3 }), team('beta', 1, ['thu'], { a1: 1 })])

  it('is what is left of the capacity on one day', () => {
    expect(freeOnDays(p, 'a1', ['mon'])).toBe(4)
    expect(freeOnDays(p, 'a1', ['tue'])).toBe(1)
    expect(freeOnDays(p, 'a1', ['thu'])).toBe(0)
  })

  it('is what is free on ALL the days when several are given', () => {
    expect(freeOnDays(p, 'a1', ['mon', 'tue'])).toBe(1)
    expect(freeOnDays(p, 'a1', ['tue', 'thu'])).toBe(0)
    expect(freeOnDays(p, 'a1', ['thu', 'tue'])).toBe(0)
    expect(freeOnDays(p, 'a1', [...WEEKDAYS])).toBe(0)
    expect(freeOnDays(p, 'a2', [...WEEKDAYS])).toBe(4)
  })

  it('is the capacity when no day is given', () => {
    expect(freeOnDays(p, 'a1', [])).toBe(4)
    expect(freeOnDays(p, 'b1', [])).toBe(6)
  })

  it('is 0 for an area that does not exist', () => {
    expect(freeOnDays(p, 'ghost', ['tue'])).toBe(0)
    expect(freeOnDays(p, 'ghost', [])).toBe(0)
  })

  it("counts a team's own seats as free when that team is ignored", () => {
    expect(freeOnDays(p, 'a1', ['tue'], 'alpha')).toBe(4)
    expect(freeOnDays(p, 'a1', ['thu'], 'alpha')).toBe(3)
    expect(freeOnDays(p, 'a1', ['tue', 'thu'], 'alpha')).toBe(3)
    expect(freeOnDays(p, 'a1', ['tue', 'thu'], 'beta')).toBe(1)
  })

  it('changes nothing when the ignored team does not sit there', () => {
    expect(freeOnDays(p, 'a1', ['tue'], 'beta')).toBe(1)
    expect(freeOnDays(p, 'a1', ['thu'], 'ghost')).toBe(0)
  })

  it('is never below zero, also when the area is overbooked', () => {
    const overbooked = plan([team('alpha', 4, ['tue'], { a3: 4 }), team('beta', 3, ['tue'], { a3: 3 })])
    expect(occupancyOf(overbooked, 'tue', 'a3').free).toBe(-5)
    expect(freeOnDays(overbooked, 'a3', ['tue'])).toBe(0)
    expect(freeOnDays(overbooked, 'a3', ['tue'], 'alpha')).toBe(0)
    expect(freeOnDays(overbooked, 'a3', ['mon', 'tue'])).toBe(0)
  })
})

describe('teamDayStatus', () => {
  const status = (t: Team, day: Weekday, settings: Partial<Settings> = {}) => teamDayStatus(plan([t], settings), t, day)

  it('is off on a day that is not a team day, whatever the team holds', () => {
    const alpha = team('alpha', 4, ['tue'], { a1: 4 })
    expect(status(alpha, 'mon')).toEqual({
      teamId: 'alpha',
      day: 'mon',
      planned: false,
      needed: 0,
      seated: 0,
      inDesks: 0,
      inOverflow: 0,
      inNoSeating: 0,
      areaIds: [],
      floorIds: [],
      state: 'off',
    })
  })

  it('is unseated on a team day without any seat', () => {
    expect(status(team('alpha', 4, ['tue']), 'tue')).toMatchObject({ planned: true, needed: 4, seated: 0, state: 'unseated' })
  })

  it('is short with fewer seats than needed', () => {
    expect(status(team('alpha', 4, ['tue'], { a1: 3 }), 'tue')).toMatchObject({ needed: 4, seated: 3, state: 'short' })
    expect(status(team('alpha', 4, ['tue'], { a1: 1 }), 'tue')).toMatchObject({ seated: 1, state: 'short' })
  })

  it('is seated with exactly the seats needed', () => {
    expect(status(team('alpha', 4, ['tue'], { a1: 4 }), 'tue')).toMatchObject({ needed: 4, seated: 4, state: 'seated' })
    expect(status(team('alpha', 6, ['tue'], { a1: 4, a3: 2 }), 'tue')).toMatchObject({ seated: 6, state: 'seated' })
  })

  it('is over with more seats than needed', () => {
    expect(status(team('alpha', 4, ['tue'], { a1: 4, a2: 1 }), 'tue')).toMatchObject({ needed: 4, seated: 5, state: 'over' })
  })

  it('counts a team without people as seated when it holds nothing, and as over when it holds seats', () => {
    expect(status(team('alpha', 0, ['tue']), 'tue')).toMatchObject({ planned: true, needed: 0, seated: 0, state: 'seated' })
    expect(status(team('alpha', 0, ['tue'], { a1: 1 }), 'tue')).toMatchObject({ needed: 0, seated: 1, state: 'over' })
  })

  it('counts desks and overflow seats apart, and both as seated', () => {
    expect(status(team('alpha', 5, ['tue'], { a1: 4, bench: 1 }), 'tue')).toMatchObject({
      seated: 5,
      inDesks: 4,
      inOverflow: 1,
      inNoSeating: 0,
      state: 'seated',
    })
  })

  it('does not count seats in a room as seated', () => {
    expect(status(team('alpha', 4, ['tue'], { room: 4 }), 'tue')).toMatchObject({
      needed: 4,
      seated: 0,
      inNoSeating: 4,
      state: 'unseated',
      areaIds: ['room'],
      floorIds: ['1'],
    })
    expect(status(team('alpha', 4, ['tue'], { a1: 2, room: 2 }), 'tue')).toMatchObject({
      seated: 2,
      inDesks: 2,
      inNoSeating: 2,
      state: 'short',
    })
  })

  it('lists areas and floors in building order, whatever the order in the seating', () => {
    const scattered = team('alpha', 4, ['tue'], { b2: 1, a3: 1, b1: 1, a1: 1 })
    expect(status(scattered, 'tue')).toMatchObject({ areaIds: ['a1', 'a3', 'b1', 'b2'], floorIds: ['1', '2'] })
    const upstairs = team('alpha', 4, ['tue'], { b2: 2, b1: 2 })
    expect(status(upstairs, 'tue')).toMatchObject({ areaIds: ['b1', 'b2'], floorIds: ['2'] })
  })

  it('looks at the exception on its day and at the normal seating on the other days', () => {
    const alpha = team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { b1: 2 } } })
    expect(status(alpha, 'tue')).toMatchObject({ seated: 4, state: 'seated', areaIds: ['a1'], floorIds: ['1'] })
    expect(status(alpha, 'thu')).toMatchObject({ seated: 2, state: 'short', areaIds: ['b1'], floorIds: ['2'] })
  })

  it('ignores seats in areas that do not exist', () => {
    const lost = status(team('alpha', 4, ['tue'], { ghost: 4 }), 'tue')
    expect(lost).toMatchObject({ seated: 0, state: 'unseated', areaIds: [], floorIds: [] })
  })

  it('needs seats according to the attendance', () => {
    expect(status(team('alpha', 10, ['tue'], { b1: 5 }), 'tue', { attendance: 0.5 })).toMatchObject({ needed: 5, state: 'seated' })
    const own = team('alpha', 10, ['tue'], { b1: 5 }, { attendance: 0.8 })
    expect(status(own, 'tue', { attendance: 0.5 })).toMatchObject({ needed: 8, seated: 5, state: 'short' })
  })
})

// ---------------------------------------------------------------------------
// How full a day or a floor is
// ---------------------------------------------------------------------------

describe('plannableDesks', () => {
  it('leaves 59 of 66 desks at a reserve of 10% and all 66 without a reserve', () => {
    expect(plannableDesks(hall(66, { reserve: 0.1 }))).toBe(59)
    expect(plannableDesks(hall(66, { reserve: 0 }))).toBe(66)
  })

  it('rounds down, not to the nearest desk', () => {
    expect(plannableDesks(hall(66, { reserve: 0.25 }))).toBe(49) // 49.5
    expect(plannableDesks(hall(66, { reserve: 0.5 }))).toBe(33)
    expect(plannableDesks(hall(7, { reserve: 0.1 }))).toBe(6) // 6.3
    expect(plannableDesks(hall(1, { reserve: 0.5 }))).toBe(0)
  })

  it('counts regular desks only, on all floors', () => {
    expect(plannableDesks(plan([], { reserve: 0 }))).toBe(20)
    expect(plannableDesks(plan([], { reserve: 0.2 }))).toBe(16)
  })

  it('agrees with whole-number arithmetic for every number of desks up to 200 at every whole percentage', () => {
    const wrong: string[] = []
    for (let desks = 0; desks <= 200; desks += 1) {
      for (let percent = 0; percent <= 50; percent += 1) {
        const expected = Math.floor((desks * (100 - percent)) / 100)
        const actual = plannableDesks(hall(desks, { reserve: percent / 100 }))
        if (actual !== expected) wrong.push(`${desks} desks at ${percent}%: ${actual} instead of ${expected}`)
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('dayLevel', () => {
  // 10 desks of which 8 may be planned, and 4 overflow seats.
  const capacity = { desks: 10, overflow: 4 }

  it.each([
    [0, 'fits'],
    [8, 'fits'],
    [9, 'reserve'],
    [10, 'reserve'],
    [11, 'overflow'],
    [14, 'overflow'],
    [15, 'over'],
    [100, 'over'],
  ] as const)('puts %d seats needed at "%s"', (needed, level) => {
    expect(dayLevel(needed, capacity, 8)).toBe(level)
  })

  it('never says "reserve" when no reserve is kept', () => {
    expect(dayLevel(10, capacity, 10)).toBe('fits')
    expect(dayLevel(11, capacity, 10)).toBe('overflow')
  })

  it('goes straight from the desks to "over" in a building without overflow seats', () => {
    expect(dayLevel(10, { desks: 10, overflow: 0 }, 8)).toBe('reserve')
    expect(dayLevel(11, { desks: 10, overflow: 0 }, 8)).toBe('over')
  })

  it('says "fits" for an empty day in an empty building', () => {
    expect(dayLevel(0, { desks: 0, overflow: 0 }, 0)).toBe('fits')
    expect(dayLevel(1, { desks: 0, overflow: 0 }, 0)).toBe('over')
  })
})

describe('dayLoad', () => {
  it('adds up the teams that are in on the day', () => {
    const p = plan([
      team('alpha', 8, ['tue', 'thu'], { a1: 4, a2: 4 }),
      team('beta', 5, ['tue'], { b1: 3 }),
      team('gamma', 4, ['wed'], { a1: 4 }),
      team('nobody', 0, ['tue']),
    ])
    expect(dayLoad(p, 'tue')).toEqual({
      day: 'tue',
      teams: 3,
      people: 13,
      needed: 13,
      seated: 11,
      capacity: { desks: 20, overflow: 3 },
      plannableDesks: 20,
      level: 'fits',
    })
    expect(dayLoad(p, 'wed')).toMatchObject({ teams: 1, people: 4, needed: 4, seated: 4 })
    expect(dayLoad(p, 'fri')).toMatchObject({ teams: 0, people: 0, needed: 0, seated: 0, level: 'fits' })
  })

  it('needs seats according to the attendance, but counts all the people', () => {
    const p = plan([team('alpha', 10, ['tue']), team('beta', 10, ['tue'], {}, { attendance: 1 })], { attendance: 0.5 })
    expect(dayLoad(p, 'tue')).toMatchObject({ people: 20, needed: 15 })
  })

  it('never counts a team for more seats than it needs, so one team cannot hide another', () => {
    // Alpha needs 4 and holds 6; Beta needs 5 and holds 2.
    const p = plan([team('alpha', 4, ['tue'], { b1: 6 }), team('beta', 5, ['tue'], { a1: 2 })])
    expect(dayLoad(p, 'tue')).toMatchObject({ needed: 9, seated: 6 })
  })

  it('does not count seats in a room or in a missing area as seated', () => {
    const p = plan([team('alpha', 4, ['tue'], { room: 2, ghost: 2, a1: 1 })])
    expect(dayLoad(p, 'tue')).toMatchObject({ needed: 4, seated: 1 })
  })

  it('uses the exception of the day', () => {
    const p = plan([team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: {} } })])
    expect(dayLoad(p, 'tue').seated).toBe(4)
    expect(dayLoad(p, 'thu')).toMatchObject({ teams: 1, needed: 4, seated: 0 })
  })

  describe('on the real floor with 66 desks and 32 overflow seats', () => {
    const building4 = (reserve: number, people: number): Project =>
      project(
        [{ id: 'floor-4', name: 'Floor 4', label: '4', plan: { src: '', ...FLOOR4_PLAN_SIZE }, areas: FLOOR4_AREAS }],
        [team('everyone', people, ['tue'])],
        { reserve },
      )

    it.each([
      [59, 'fits'],
      [60, 'reserve'],
      [66, 'reserve'],
      [67, 'overflow'],
      [98, 'overflow'],
      [99, 'over'],
    ] as const)('puts %d people at "%s" with a reserve of 10%%', (people, level) => {
      expect(dayLoad(building4(0.1, people), 'tue')).toMatchObject({
        needed: people,
        capacity: { desks: 66, overflow: 32 },
        plannableDesks: 59,
        level,
      })
    })

    it.each([
      [66, 'fits'],
      [67, 'overflow'],
      [98, 'overflow'],
      [99, 'over'],
    ] as const)('puts %d people at "%s" without a reserve', (people, level) => {
      expect(dayLoad(building4(0, people), 'tue')).toMatchObject({ plannableDesks: 66, level })
    })
  })
})

describe('floorLoad', () => {
  const p = plan([
    team('alpha', 6, ['tue'], { a1: 4, b1: 2 }),
    team('beta', 3, ['tue'], { bench: 2, room: 1 }),
    team('gamma', 3, ['wed'], { a2: 3 }),
  ])

  it('counts the seats held at desks and in overflow areas of that floor on that day', () => {
    expect(floorLoad(p, floorOf(p, '1'), 'tue')).toEqual({
      floorId: '1',
      day: 'tue',
      capacity: { desks: 10, overflow: 3 },
      usedDesks: 4,
      usedOverflow: 2,
      teamIds: ['alpha', 'beta'],
    })
    expect(floorLoad(p, floorOf(p, '2'), 'tue')).toMatchObject({ usedDesks: 2, usedOverflow: 0, teamIds: ['alpha'] })
    expect(floorLoad(p, floorOf(p, '1'), 'wed')).toMatchObject({ usedDesks: 3, usedOverflow: 0, teamIds: ['gamma'] })
    expect(floorLoad(p, floorOf(p, '2'), 'wed')).toMatchObject({ usedDesks: 0, usedOverflow: 0, teamIds: [] })
  })

  it('lists the teams in team order, not in the order of the areas they sit in', () => {
    const swapped = plan([team('alpha', 4, ['tue'], { a2: 4 }), team('beta', 4, ['tue'], { a1: 4 })])
    expect(floorLoad(swapped, floorOf(swapped, '1'), 'tue').teamIds).toEqual(['alpha', 'beta'])
  })

  it('does not count seats in a room as used, but still lists the team as being on the floor', () => {
    const inRoom = plan([team('alpha', 2, ['tue'], { room: 2 })])
    expect(floorLoad(inRoom, floorOf(inRoom, '1'), 'tue')).toMatchObject({ usedDesks: 0, usedOverflow: 0, teamIds: ['alpha'] })
  })

  it('shows an overbooked floor as it is', () => {
    const overbooked = plan([team('alpha', 9, ['tue'], { a3: 9 })])
    const load = floorLoad(overbooked, floorOf(overbooked, '1'), 'tue')
    expect(load).toMatchObject({ usedDesks: 9, capacity: { desks: 10, overflow: 3 } })
  })
})

describe('describeSeating', () => {
  it('names the areas per floor, in building order', () => {
    const alpha = team('alpha', 8, ['tue'], { b1: 2, a2: 2, a1: 4 })
    expect(describeSeating(plan([alpha]), alpha, 'tue')).toBe('Floor 1: A1, A2; Floor 2: B1')
  })

  it('uses the names of the floor and of the areas: "Floor 4: NE 1, NE 2"', () => {
    const floor4 = floor('4', [area('ne1', 4, { name: 'NE 1' }), area('ne2', 2, { name: 'NE 2' }), area('ne3', 4, { name: 'NE 3' })])
    const alpha = team('alpha', 6, ['tue'], { ne2: 2, ne1: 4 })
    expect(describeSeating(project([floor4], [alpha]), alpha, 'tue')).toBe('Floor 4: NE 1, NE 2')
  })

  it('is empty when the team has no seats or is not in', () => {
    const unseated = team('alpha', 4, ['tue'])
    expect(describeSeating(plan([unseated]), unseated, 'tue')).toBe('')
    const seated = team('alpha', 4, ['tue'], { a1: 4 })
    expect(describeSeating(plan([seated]), seated, 'wed')).toBe('')
  })

  it('describes the exception on its day', () => {
    const alpha = team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { b2: 4 } } })
    expect(describeSeating(plan([alpha]), alpha, 'tue')).toBe('Floor 1: A1')
    expect(describeSeating(plan([alpha]), alpha, 'thu')).toBe('Floor 2: B2')
  })

  it('leaves out areas that do not exist', () => {
    const alpha = team('alpha', 4, ['tue'], { ghost: 2, b1: 2 })
    expect(describeSeating(plan([alpha]), alpha, 'tue')).toBe('Floor 2: B1')
  })
})

// ---------------------------------------------------------------------------
// Making new things
// ---------------------------------------------------------------------------

describe('newId', () => {
  it('starts with the prefix and continues with characters that are safe anywhere', () => {
    expect(newId('team')).toMatch(/^team-[0-9a-z]+$/)
    expect(newId('area')).toMatch(/^area-[0-9a-z]+$/)
  })

  it('never looks like a number, so it keeps its place as an object key', () => {
    // Seats are stored in objects keyed by id; keys that look like numbers are re-ordered.
    for (const prefix of ['team', '', '7']) {
      for (let i = 0; i < 200; i += 1) expect(newId(prefix)).not.toMatch(/^\d+$/)
    }
  })

  it('does not repeat itself over thousands of calls', () => {
    const made = new Set<string>()
    for (let i = 0; i < 5000; i += 1) made.add(newId('area'))
    expect(made.size).toBe(5000)
  })
})

describe('teamCode', () => {
  it('takes the initials of the first three words', () => {
    expect(teamCode('Claims Alpha', [])).toBe('CA')
    expect(teamCode('Risk and Compliance', [])).toBe('RAC')
    expect(teamCode('One Two Three Four', [])).toBe('OTT')
  })

  it('takes the first three letters of a single word', () => {
    expect(teamCode('Underwriting', [])).toBe('UND')
    expect(teamCode('Architecture', [])).toBe('ARC')
    expect(teamCode('IT', [])).toBe('IT')
    expect(teamCode('x', [])).toBe('X')
  })

  it('writes capitals', () => {
    expect(teamCode('claims alpha', [])).toBe('CA')
    expect(teamCode('équipe élan', [])).toBe('ÉÉ')
  })

  it('sees anything that is not a letter or a digit as a gap between words', () => {
    expect(teamCode('claims-alpha', [])).toBe('CA')
    expect(teamCode('  Claims   Alpha  ', [])).toBe('CA')
    expect(teamCode('R&D', [])).toBe('RD')
    expect(teamCode('Claims/Alpha (BE)', [])).toBe('CAB')
    expect(teamCode('🚀 Rockets', [])).toBe('ROC')
  })

  it('keeps a number whole, so numbered teams get the codes one expects', () => {
    expect(teamCode('Team 7', [])).toBe('T7')
    expect(teamCode('Team 12', [])).toBe('T12')
    expect(teamCode('Squad 12 North', [])).toBe('S12N')
    expect(teamCode('42', [])).toBe('42')
    expect(teamCode('2024', [])).toBe('2024')
    const taken: string[] = []
    for (let n = 1; n <= 12; n += 1) taken.push(teamCode(`Team ${n}`, taken))
    expect(taken).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'])
  })

  it('gives "T" to a name without letters or digits', () => {
    expect(teamCode('', [])).toBe('T')
    expect(teamCode('   ', [])).toBe('T')
    expect(teamCode('---', [])).toBe('T')
    expect(teamCode('', ['T'])).toBe('T2')
  })

  it('adds a number when the code is in use', () => {
    expect(teamCode('Claims Alpha', ['CA'])).toBe('CA2')
    expect(teamCode('Claims Alpha', ['CA', 'CA2'])).toBe('CA3')
    expect(teamCode('Claims Alpha', ['CA', 'CA3'])).toBe('CA2')
    expect(teamCode('Claims Alpha', ['CI', 'CH'])).toBe('CA')
  })

  it('compares codes without regard to capitals', () => {
    expect(teamCode('Claims Alpha', ['ca'])).toBe('CA2')
    expect(teamCode('Claims Alpha', ['Ca', 'cA2'])).toBe('CA3')
  })

  it('shortens the letters to make room for the number', () => {
    expect(teamCode('Underwriting', ['UND'])).toBe('UND2')
    const untilNine = ['UND', 'UND2', 'UND3', 'UND4', 'UND5', 'UND6', 'UND7', 'UND8', 'UND9']
    expect(teamCode('Underwriting', untilNine)).toBe('UN10')
  })

  it('stays within four characters and never repeats a code, however many teams share a name', () => {
    for (const name of ['New team', 'Underwriting', 'Team 12', '']) {
      const taken: string[] = []
      for (let i = 0; i < 150; i += 1) {
        const code = teamCode(name, taken)
        expect(code.length, `code ${i + 1} for "${name}": ${code}`).toBeGreaterThan(0)
        expect(code.length, `code ${i + 1} for "${name}": ${code}`).toBeLessThanOrEqual(4)
        expect(taken, `code ${i + 1} for "${name}"`).not.toContain(code)
        taken.push(code)
      }
    }
  })

  it('stays within four characters for names of any shape', () => {
    const names = [
      'A very long name of many many words',
      'Supercalifragilistic',
      'A B C D E F',
      '1234567 89',
      'Team 123456',
      'Straße Fuß Maß',
      'ß ß ß',
      'x'.repeat(200),
    ]
    for (const name of names) expect(teamCode(name, []).length, name).toBeLessThanOrEqual(4)
  })
})

describe('makeTeam', () => {
  it('plans the wanted days and records them as wishes', () => {
    const made = makeTeam(plan(), { name: 'Claims Alpha', size: 9, days: ['thu', 'tue', 'thu'] })
    expect(made.days).toEqual(['tue', 'thu'])
    expect(made.wishes).toEqual({ mon: 'none', tue: 'want', wed: 'none', thu: 'want', fri: 'none' })
  })

  it('makes a team without days when none are given', () => {
    const made = makeTeam(plan(), { name: 'Claims Alpha', size: 9 })
    expect(made.days).toEqual([])
    expect(made.wishes).toEqual({ mon: 'none', tue: 'none', wed: 'none', thu: 'none', fri: 'none' })
  })

  it('starts unseated, with nothing filled in that was not given', () => {
    const made = makeTeam(plan(), { name: 'Claims Alpha', size: 9 })
    expect(made).toMatchObject({ name: 'Claims Alpha', size: 9, domainId: null, artId: null, attendance: null, homeFloorId: null, notes: '' })
    expect(made.seating).toEqual({})
    expect(made.daySeating).toEqual({})
    expect(made.id).toMatch(/^team-/)
  })

  it('takes over what was given', () => {
    const withOrg = { ...plan(), domains: [{ id: 'nonlife', name: 'Non-Life' }], arts: [{ id: 'claims', name: 'Claims ART', domainId: 'nonlife' }] }
    const made = makeTeam(withOrg, {
      name: 'Claims Alpha',
      size: 9,
      artId: 'claims',
      color: '#123456',
      code: 'ALFA',
      attendance: 0.8,
      homeFloorId: '2',
      notes: 'Needs a wall for the board',
    })
    expect(made).toMatchObject({
      // The ART decides the domain.
      domainId: 'nonlife',
      artId: 'claims',
      color: '#123456',
      code: 'ALFA',
      attendance: 0.8,
      homeFloorId: '2',
      notes: 'Needs a wall for the board',
    })
  })

  it('puts a team only in a domain or on an ART that exists', () => {
    const withOrg = { ...plan(), domains: [{ id: 'mgmt', name: 'Management' }], arts: [] }
    expect(makeTeam(withOrg, { name: 'Board', size: 3, domainId: 'mgmt' })).toMatchObject({ domainId: 'mgmt', artId: null })
    expect(makeTeam(withOrg, { name: 'Lost', size: 3, domainId: 'ghost', artId: 'ghost' })).toMatchObject({ domainId: null, artId: null })
  })

  it('picks a colour that is not in use yet', () => {
    const [first, second, third] = TEAM_COLORS
    expect(makeTeam(plan(), { name: 'New', size: 1 }).color).toBe(first)
    const p = plan([team('alpha', 4, [], {}, { color: first }), team('beta', 4, [], {}, { color: second })])
    expect(makeTeam(p, { name: 'New', size: 1 }).color).toBe(third)
  })

  it('derives a code from the name that is not in use yet', () => {
    const p = plan([team('alpha', 4, [], {}, { code: 'CA' })])
    expect(makeTeam(p, { name: 'Claims Alpha', size: 1 }).code).toBe('CA2')
    expect(makeTeam(p, { name: 'Claims Intake', size: 1 }).code).toBe('CI')
  })

  it('cuts a given code to four characters', () => {
    expect(makeTeam(plan(), { name: 'Claims Alpha', size: 1, code: 'CLAIMS' }).code).toBe('CLAI')
  })

  it.each([
    [9, 9],
    [0, 0],
    [7.4, 7],
    [7.5, 8],
    [-3, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])('makes the size a whole number of zero or more: %d becomes %d', (given, expected) => {
    expect(makeTeam(plan(), { name: 'Claims Alpha', size: given }).size).toBe(expected)
  })

  it('gives every team a new id', () => {
    const p = plan()
    expect(makeTeam(p, { name: 'A', size: 1 }).id).not.toBe(makeTeam(p, { name: 'A', size: 1 }).id)
  })

  it('gives twenty teams added one after the other their own code, and the first sixteen their own colour', () => {
    let p = plan()
    for (let n = 1; n <= 20; n += 1) {
      p = { ...p, teams: [...p.teams, makeTeam(p, { name: n % 2 === 0 ? 'New team' : `Team ${n}`, size: 5, days: ['tue'] })] }
    }
    expect(new Set(p.teams.map((t) => t.code)).size).toBe(20)
    expect(new Set(p.teams.slice(0, 16).map((t) => t.color)).size).toBe(16)
    expect(violations(p)).toEqual([])
  })
})

describe('floorLabelFromName', () => {
  it.each([
    ['Floor 4', '4'],
    ['Ground floor', 'G'],
    ['4th floor', '4'],
    ['Level 12', '12'],
    ['Floor -1', '-1'],
    ['Verdieping 3', '3'],
    ['basement', 'B'],
    ['étage', 'É'],
    ['  mezzanine', 'M'],
  ])('makes %j into %j', (name, label) => {
    expect(floorLabelFromName(name)).toBe(label)
  })

  it('never makes a label of more than three characters', () => {
    expect(floorLabelFromName('Floor 12345')).toBe('123')
    expect(floorLabelFromName('Floor -123')).toBe('-12')
  })

  it('answers "?" when the name has neither a digit nor a letter', () => {
    expect(floorLabelFromName('')).toBe('?')
    expect(floorLabelFromName(' -- ')).toBe('?')
  })
})

describe('makeFloor', () => {
  it('makes an empty floor without a drawing, labelled after its name', () => {
    const made = makeFloor({ name: 'Floor 5' })
    expect(made).toMatchObject({ name: 'Floor 5', label: '5', plan: null, areas: [] })
    expect(made.id).toMatch(/^floor-/)
  })

  it('takes over a label, a drawing and areas, and cuts the label to three characters', () => {
    const drawing = { src: 'data:image/png;base64,AAAA', width: 800, height: 400 }
    const areas = [area('x1', 4)]
    expect(makeFloor({ name: 'Annex', label: 'AX', plan: drawing, areas })).toMatchObject({ label: 'AX', plan: drawing, areas })
    expect(makeFloor({ name: 'Annex', label: 'ANNEX' }).label).toBe('ANN')
  })

  it('gives every floor a new id', () => {
    expect(makeFloor({ name: 'Floor 5' }).id).not.toBe(makeFloor({ name: 'Floor 5' }).id)
  })
})

describe('copyFloor', () => {
  const original: Floor = { ...floorOf(plan(), '1'), plan: { src: 'data:image/png;base64,AAAA', width: 800, height: 400 } }

  it('gives the copy a new id, the new name and a label that fits the name', () => {
    const copy = copyFloor(original, 'Floor 5')
    expect(copy.id).toMatch(/^floor-/)
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('Floor 5')
    expect(copy.label).toBe('5')
  })

  it('uses a given label, cut to three characters', () => {
    expect(copyFloor(original, 'Annex', 'AX').label).toBe('AX')
    expect(copyFloor(original, 'Annex', 'ANNEX').label).toBe('ANN')
  })

  it('gives every area a new id', () => {
    const copy = copyFloor(original, 'Floor 5')
    const copiedIds = copy.areas.map((a) => a.id)
    expect(new Set(copiedIds).size).toBe(original.areas.length)
    for (const id of copiedIds) {
      expect(id).toMatch(/^area-/)
      expect(original.areas.map((a) => a.id)).not.toContain(id)
    }
    expect(copyFloor(original, 'Floor 6').areas.map((a) => a.id)).not.toEqual(copiedIds)
  })

  it('keeps the layout: the same drawing and the same areas in the same places', () => {
    const copy = copyFloor(original, 'Floor 5')
    expect(copy.plan).toEqual(original.plan)
    const layout = (areas: readonly Area[]) => areas.map(({ name, kind, capacity, rect }) => ({ name, kind, capacity, rect }))
    expect(layout(copy.areas)).toEqual(layout(original.areas))
  })

  it('does not share rectangles or areas with the original', () => {
    const copy = copyFloor(original, 'Floor 5')
    copy.areas.forEach((copied, i) => {
      expect(copied).not.toBe(original.areas[i])
      expect(copied.rect).not.toBe(original.areas[i]?.rect)
    })
    expect(copy.areas).not.toBe(original.areas)
  })

  it('leaves the original as it was', () => {
    const before = structuredClone(original)
    copyFloor(original, 'Floor 5')
    expect(original).toEqual(before)
  })
})

describe('nextAreaName', () => {
  const named = (...names: string[]) => floor('1', names.map((name, i) => area(`x${i}`, 4, { name })))

  it('starts at "Area 1" on an empty floor', () => {
    expect(nextAreaName(floor('1', []))).toBe('Area 1')
  })

  it('counts on from the number of areas', () => {
    expect(nextAreaName(named('Area 1', 'Area 2'))).toBe('Area 3')
    expect(nextAreaName(named('NE 1', 'NE 2', 'Lounge'))).toBe('Area 4')
  })

  it('skips names that are in use, however they are written', () => {
    expect(nextAreaName(named('Area 3', 'Lounge'))).toBe('Area 4')
    expect(nextAreaName(named(' AREA 3 ', 'area 4'))).toBe('Area 5')
  })

  it('never suggests a name that is in use', () => {
    const f = named('Area 2', 'Area 4', 'Area 3', 'Area 6', 'Area 5')
    expect(f.areas.map((a) => a.name)).not.toContain(nextAreaName(f))
  })
})

describe('makeArea', () => {
  const f = floorOf(plan(), '2')
  const anywhere: Rect = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }

  it('makes four desks with the next free name unless told otherwise', () => {
    const made = makeArea(f, anywhere)
    expect(made).toMatchObject({ name: 'Area 3', kind: 'desks', capacity: 4, rect: anywhere })
    expect(made.id).toMatch(/^area-/)
  })

  it('takes over a name, a kind and a number of seats', () => {
    expect(makeArea(f, anywhere, { name: 'Lounge', kind: 'no-seating', capacity: 9 })).toMatchObject({
      name: 'Lounge',
      kind: 'no-seating',
      capacity: 9,
    })
    expect(makeArea(f, anywhere, { capacity: 0 }).capacity).toBe(0)
  })

  it.each([
    [2.4, 2],
    [2.5, 3],
    [-2, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('makes the seats a whole number of zero or more: %d becomes %d', (given, expected) => {
    expect(makeArea(f, anywhere, { capacity: given }).capacity).toBe(expected)
  })

  it('keeps the rectangle inside the plan', () => {
    expect(makeArea(f, { x: 0.9, y: -0.5, w: 0.5, h: 0.25 }).rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.25 })
  })

  it('gives every area a new id', () => {
    expect(makeArea(f, anywhere).id).not.toBe(makeArea(f, anywhere).id)
  })
})

describe('clampRect', () => {
  it('leaves a rectangle inside the plan as it is', () => {
    for (const rect of [
      { x: 0.2, y: 0.3, w: 0.4, h: 0.5 },
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.75, y: 0.5, w: 0.25, h: 0.5 },
      { x: 0, y: 0, w: MIN_RECT_SIZE, h: MIN_RECT_SIZE },
    ]) {
      expect(clampRect(rect)).toEqual(rect)
    }
  })

  it('moves a rectangle that sticks out back inside, keeping its size', () => {
    expect(clampRect({ x: 0.9, y: 0.875, w: 0.25, h: 0.25 })).toEqual({ x: 0.75, y: 0.75, w: 0.25, h: 0.25 })
    expect(clampRect({ x: -0.3, y: -2, w: 0.25, h: 0.25 })).toEqual({ x: 0, y: 0, w: 0.25, h: 0.25 })
  })

  it('cuts a rectangle that is larger than the plan to the plan', () => {
    expect(clampRect({ x: 0.5, y: 0.5, w: 3, h: 1.5 })).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('makes a rectangle at least the minimum size', () => {
    expect(clampRect({ x: 0.5, y: 0.5, w: 0, h: 0.001 })).toEqual({ x: 0.5, y: 0.5, w: MIN_RECT_SIZE, h: MIN_RECT_SIZE })
    expect(clampRect({ x: 0.5, y: 0.5, w: -0.2, h: -1 })).toEqual({ x: 0.5, y: 0.5, w: MIN_RECT_SIZE, h: MIN_RECT_SIZE })
  })

  it('makes something usable of values that are not numbers', () => {
    const nan = Number.NaN
    expect(clampRect({ x: nan, y: nan, w: nan, h: nan })).toEqual({ x: 0, y: 0, w: MIN_RECT_SIZE, h: MIN_RECT_SIZE })
    const clamped = clampRect({ x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY, w: Number.POSITIVE_INFINITY, h: 0.5 })
    expect(Object.values(clamped).every((n) => Number.isFinite(n))).toBe(true)
    expect(clamped.h).toBe(0.5)
  })

  it('always answers with a rectangle inside the plan, and answers the same when asked again', () => {
    const notNumbers = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
    const values = [-1, -0.1, 0, 0.005, 0.01, 0.3, 0.5, 0.99, 1, 1.5, 100, ...notNumbers]
    const outside: Rect[] = []
    for (const x of values) {
      for (const y of values) {
        for (const w of values) {
          for (const h of values) {
            const r = clampRect({ x, y, w, h })
            const inside =
              [r.x, r.y, r.w, r.h].every((n) => Number.isFinite(n)) &&
              r.x >= 0 &&
              r.y >= 0 &&
              r.w >= MIN_RECT_SIZE &&
              r.h >= MIN_RECT_SIZE &&
              r.x + r.w <= 1 &&
              r.y + r.h <= 1
            const again = clampRect(r)
            const stable = again.x === r.x && again.y === r.y && again.w === r.w && again.h === r.h
            if (!inside || !stable) outside.push({ x, y, w, h })
          }
        }
      }
    }
    expect(outside).toEqual([])
  })

  it('does not change the rectangle it is given', () => {
    const rect = Object.freeze({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 })
    expect(clampRect(rect)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })
})

describe('emptyProject', () => {
  it('is a sound project without floors or teams', () => {
    const empty = emptyProject()
    expect(empty).toEqual({
      schemaVersion: 2,
      name: 'Office plan',
      floors: [],
      domains: [],
      arts: [],
      teams: [],
      settings: DEFAULT_SETTINGS,
      accepted: {},
    })
    expect(violations(empty)).toEqual([])
    expect(emptyProject('Head office').name).toBe('Head office')
  })

  it('does not share its settings with the defaults or with another empty project', () => {
    expect(emptyProject().settings).not.toBe(DEFAULT_SETTINGS)
    expect(emptyProject().settings).not.toBe(emptyProject().settings)
  })
})

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe('cached results', () => {
  const start = () => plan([team('alpha', 4, ['tue'], { a1: 4 })])

  it('are the same objects when asked again for the same project', () => {
    const p = start()
    expect(indexAreas(p)).toBe(indexAreas(p))
    expect(projectCapacity(p)).toBe(projectCapacity(p))
    expect(dayOccupancy(p, 'tue')).toBe(dayOccupancy(p, 'tue'))
    expect(dayLoad(p, 'tue')).toBe(dayLoad(p, 'tue'))
  })

  it('are kept apart per day', () => {
    const p = start()
    expect(dayOccupancy(p, 'tue')).not.toBe(dayOccupancy(p, 'wed'))
    expect(occupancyOf(p, 'tue', 'a1').used).toBe(4)
    expect(occupancyOf(p, 'wed', 'a1').used).toBe(0)
    expect(dayLoad(p, 'tue').teams).toBe(1)
    expect(dayLoad(p, 'wed').teams).toBe(0)
    // Asking for another day in between does not disturb the first.
    expect(dayOccupancy(p, 'tue')).toBe(dayOccupancy(p, 'tue'))
  })

  it('are fresh for a changed project, while the old project keeps its own', () => {
    const before = start()
    const occupancyBefore = dayOccupancy(before, 'tue')
    const loadBefore = dayLoad(before, 'tue')
    const capacityBefore = projectCapacity(before)
    const indexBefore = indexAreas(before)

    // The way the reducer changes a project: a new object that shares what did not change.
    const after: Project = {
      ...before,
      floors: [...before.floors, floor('3', [area('c1', 8)])],
      teams: [...before.teams, team('beta', 2, ['tue'], { a2: 2 })],
    }

    expect(dayOccupancy(after, 'tue')).not.toBe(occupancyBefore)
    expect(occupancyOf(after, 'tue', 'a2').used).toBe(2)
    expect(dayLoad(after, 'tue')).toMatchObject({ teams: 2, needed: 6 })
    expect(projectCapacity(after)).toEqual({ desks: 28, overflow: 3 })
    expect(indexAreas(after).has('c1')).toBe(true)

    expect(dayOccupancy(before, 'tue')).toBe(occupancyBefore)
    expect(occupancyOf(before, 'tue', 'a2').used).toBe(0)
    expect(dayLoad(before, 'tue')).toBe(loadBefore)
    expect(loadBefore).toMatchObject({ teams: 1, needed: 4 })
    expect(projectCapacity(before)).toBe(capacityBefore)
    expect(capacityBefore).toEqual({ desks: 20, overflow: 3 })
    expect(indexAreas(before)).toBe(indexBefore)
    expect(indexBefore.has('c1')).toBe(false)
  })

  it('are not shared between two projects that merely look the same', () => {
    const one = start()
    const other = start()
    expect(dayOccupancy(one, 'tue')).not.toBe(dayOccupancy(other, 'tue'))
    expect(dayLoad(one, 'tue')).not.toBe(dayLoad(other, 'tue'))
    expect(dayLoad(one, 'tue')).toEqual(dayLoad(other, 'tue'))
  })
})
