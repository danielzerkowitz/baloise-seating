import { describe, expect, it } from 'vitest'
import { TEAM_COLORS } from './color'
import { copyFloor, findFloor, findTeam, indexAreas, seatingOn } from './model'
import { MAX_RESERVE, MIN_ATTENDANCE, reduce, type Action, type AreaPatch, type FloorPatch, type TeamPatch } from './reducer'
import { area, floor, project, team, violations } from './testkit'
import {
  WEEKDAYS,
  type Area,
  type AreaKind,
  type DayWish,
  type Floor,
  type PlanImage,
  type Project,
  type Rect,
  type Seating,
  type SeatingScope,
  type Settings,
  type Team,
  type Weekday,
} from './types'

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/** Freezes a value all the way down, so that any attempt to change it throws. Parts that
 *  are frozen already are skipped: projects share most of their structure. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

/** `reduce` on a frozen project with a frozen action. A reducer that changed its input
 *  would throw here, so every test that uses this also proves the reducer is pure. */
function apply(p: Project, action: Action): Project {
  return reduce(deepFreeze(p), deepFreeze(action))
}

/** The building of the examples, lowest floor first:
 *    Floor 1: desks A1 (4), A2 (4) and A3 (2), an overflow bench (3) and a meeting room (6)
 *    Floor 2: desks B1 (6) and B2 (4) */
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

function teamOf(p: Project, id: string): Team {
  const found = findTeam(p, id)
  if (!found) throw new Error(`no team ${id}`)
  return found
}

function floorOf(p: Project, id: string): Floor {
  const found = findFloor(p, id)
  if (!found) throw new Error(`no floor ${id}`)
  return found
}

function areaOf(p: Project, id: string): Area {
  const found = indexAreas(p).get(id)
  if (!found) throw new Error(`no area ${id}`)
  return found.area
}

/** The seats of a team, normal and per day, for an exact comparison. (`toMatchObject`
 *  would not notice an exception too many.) */
function seatsOf(p: Project, id: string): Pick<Team, 'seating' | 'daySeating'> {
  const { seating, daySeating } = teamOf(p, id)
  return { seating, daySeating }
}

const setSeats = (teamId: string, areaId: string, seats: number, scope: SeatingScope = 'all'): Action => ({
  type: 'seat/set',
  teamId,
  areaId,
  seats,
  scope,
})

describe('the test harness', () => {
  it('notices a change to a frozen project at every depth', () => {
    const p = deepFreeze(plan([team('alpha', 4, ['tue'], { a1: 4 }, { daySeating: { tue: { a2: 4 } } })]))
    expect(() => {
      p.name = 'Changed'
    }).toThrow(TypeError)
    expect(() => {
      p.teams.push(team('beta', 1))
    }).toThrow(TypeError)
    expect(() => {
      teamOf(p, 'alpha').seating.a2 = 1
    }).toThrow(TypeError)
    expect(() => {
      delete teamOf(p, 'alpha').daySeating.tue
    }).toThrow(TypeError)
    expect(() => {
      areaOf(p, 'a1').rect.x = 0.5
    }).toThrow(TypeError)
    expect(() => {
      p.settings.reserve = 0.5
    }).toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// Project and settings
// ---------------------------------------------------------------------------

describe('project/rename', () => {
  it('renames the project and shares everything else', () => {
    const p = plan([team('alpha', 4)])
    const next = apply(p, { type: 'project/rename', name: 'Head office' })
    expect(next.name).toBe('Head office')
    expect(next.floors).toBe(p.floors)
    expect(next.teams).toBe(p.teams)
    expect(next.settings).toBe(p.settings)
  })

  it('changes nothing for the name the project already has', () => {
    const p = plan()
    expect(apply(p, { type: 'project/rename', name: p.name })).toBe(p)
  })
})

describe('project/replace', () => {
  it('swaps in the given project', () => {
    const other = plan([team('beta', 2)])
    expect(apply(plan(), { type: 'project/replace', project: other })).toBe(other)
  })

  it('changes nothing when given the project itself', () => {
    const p = plan()
    expect(apply(p, { type: 'project/replace', project: p })).toBe(p)
  })
})

describe('settings/update', () => {
  const update = (p: Project, patch: Partial<Settings>) => apply(p, { type: 'settings/update', patch })

  it('sets the attendance and the reserve, each on its own', () => {
    const p = plan()
    expect(update(p, { attendance: 0.75 }).settings).toEqual({ attendance: 0.75, reserve: 0 })
    expect(update(p, { reserve: 0.2 }).settings).toEqual({ attendance: 1, reserve: 0.2 })
    expect(update(p, { attendance: 0.6, reserve: 0.1 }).settings).toEqual({ attendance: 0.6, reserve: 0.1 })
  })

  it('shares floors and teams with the project before', () => {
    const p = plan([team('alpha', 4)])
    const next = update(p, { reserve: 0.2 })
    expect(next.floors).toBe(p.floors)
    expect(next.teams).toBe(p.teams)
  })

  it.each([
    [0, MIN_ATTENDANCE],
    [-1, MIN_ATTENDANCE],
    [0.05, MIN_ATTENDANCE],
    [MIN_ATTENDANCE, MIN_ATTENDANCE],
    [3, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])('keeps the attendance between a tenth and one: %d becomes %d', (given, expected) => {
    expect(update(plan([], { attendance: 0.5 }), { attendance: given }).settings.attendance).toBe(expected)
  })

  it.each([
    [-0.2, 0],
    [0.9, MAX_RESERVE],
    [MAX_RESERVE, MAX_RESERVE],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('keeps the reserve between nothing and a half: %d becomes %d', (given, expected) => {
    expect(update(plan([], { reserve: 0.25 }), { reserve: given }).settings.reserve).toBe(expected)
  })

  it('changes nothing when nothing would be different', () => {
    const p = plan([], { attendance: 1, reserve: 0.5 })
    expect(update(p, {})).toBe(p)
    expect(update(p, { attendance: 1 })).toBe(p)
    expect(update(p, { attendance: 1, reserve: 0.5 })).toBe(p)
    // Out of range, and clamped to what is already set.
    expect(update(p, { attendance: 7, reserve: 0.8 })).toBe(p)
  })
})

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

describe('team/add', () => {
  it('adds the team at the end of the list', () => {
    const p = plan([team('alpha', 4)])
    const beta = team('beta', 6, ['tue', 'thu'], { b1: 6 })
    const next = apply(p, { type: 'team/add', team: beta })
    expect(next.teams.map((t) => t.id)).toEqual(['alpha', 'beta'])
    expect(next.teams[0]).toBe(p.teams[0])
    expect(next.floors).toBe(p.floors)
  })

  it('stores a sound team as the object it was given', () => {
    const beta = team('beta', 6, ['tue', 'thu'], { b1: 6 }, { daySeating: { thu: { a1: 4 } }, homeFloorId: '2', attendance: 0.8 })
    const next = apply(plan(), { type: 'team/add', team: beta })
    expect(teamOf(next, 'beta')).toBe(beta)
  })

  it('refuses a team whose id is in use', () => {
    const p = plan([team('alpha', 4)])
    expect(apply(p, { type: 'team/add', team: team('alpha', 9, ['mon']) })).toBe(p)
  })

  it('makes a team fit the project before adding it', () => {
    // A team as a careless caller might build it by hand.
    const odd: Team = {
      ...team('odd', 7.6),
      code: 'TOOLONG',
      color: '#ABC',
      days: ['thu', 'fri', 'tue', 'thu'],
      attendance: 4,
      homeFloorId: 'ghost',
      seating: { a1: 2.4, ghost: 3, a2: 0 },
      daySeating: { tue: { a1: 2 }, wed: { a2: 1 }, thu: { a2: 3, ghost: 1 }, fri: undefined },
    }
    const next = apply(plan(), { type: 'team/add', team: odd })
    expect(teamOf(next, 'odd')).toMatchObject({
      size: 8,
      code: 'TOOL',
      color: '#aabbcc',
      days: ['tue', 'thu', 'fri'],
      attendance: 1,
      homeFloorId: null,
    })
    expect(seatsOf(next, 'odd')).toStrictEqual({
      // Seats in the area that does not exist and the empty entry are gone.
      seating: { a1: 2 },
      // Tuesday was no exception, Wednesday is no team day and Friday had nothing in it;
      // Thursday loses the missing area.
      daySeating: { thu: { a2: 3 } },
    })
    expect(violations(next)).toEqual([])
  })

  it('gives a team without a usable colour a palette colour that is still free', () => {
    const p = plan([team('alpha', 4, [], {}, { color: TEAM_COLORS[0] })])
    const next = apply(p, { type: 'team/add', team: team('beta', 2, [], {}, { color: 'red' }) })
    expect(teamOf(next, 'beta').color).toBe(TEAM_COLORS[1])
  })

  it('keeps what is merely a conflict: seats in a room, and more seats than an area has', () => {
    const beta = team('beta', 12, ['tue'], { room: 2, a3: 10 })
    const next = apply(plan(), { type: 'team/add', team: beta })
    expect(teamOf(next, 'beta').seating).toEqual({ room: 2, a3: 10 })
    expect(violations(next)).toEqual([])
  })
})

describe('team/addMany', () => {
  it('adds the teams in the order given', () => {
    const p = plan([team('alpha', 4)])
    const next = apply(p, { type: 'team/addMany', teams: [team('beta', 2), team('gamma', 3)] })
    expect(next.teams.map((t) => t.id)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('skips ids that are in use and ids that come twice in the list', () => {
    const p = plan([team('alpha', 4)])
    const next = apply(p, {
      type: 'team/addMany',
      teams: [team('alpha', 9), team('beta', 2), team('beta', 7), team('gamma', 3)],
    })
    expect(next.teams.map((t) => `${t.id} ${t.size}`)).toEqual(['alpha 4', 'beta 2', 'gamma 3'])
  })

  it('changes nothing when there is nothing new', () => {
    const p = plan([team('alpha', 4)])
    expect(apply(p, { type: 'team/addMany', teams: [] })).toBe(p)
    expect(apply(p, { type: 'team/addMany', teams: [team('alpha', 9)] })).toBe(p)
  })

  it('makes every team fit, and gives teams without a usable colour different free colours', () => {
    const p = plan([team('alpha', 4, [], {}, { color: TEAM_COLORS[0] })])
    const next = apply(p, {
      type: 'team/addMany',
      teams: [
        team('beta', 2.5, [], { ghost: 2 }, { color: 'red' }),
        team('gamma', -3, [], {}, { color: '' }),
        team('delta', 5, [], {}, { color: TEAM_COLORS[1] }),
      ],
    })
    expect(next.teams.map((t) => t.size)).toEqual([4, 3, 0, 5])
    expect(teamOf(next, 'beta').seating).toEqual({})
    expect(teamOf(next, 'beta').color).toBe(TEAM_COLORS[1])
    expect(teamOf(next, 'gamma').color).toBe(TEAM_COLORS[2])
    expect(violations(next)).toEqual([])
  })
})

describe('team/update', () => {
  const start = () => plan([team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { b1: 4 } } }), team('beta', 2)])
  const update = (p: Project, patch: TeamPatch, id = 'alpha') => apply(p, { type: 'team/update', id, patch })

  it('changes name, code, size, colour and notes', () => {
    const next = update(start(), {
      name: 'Claims Alpha',
      code: 'CA',
      size: 9,
      color: '#2f6fde',
      notes: 'Near the window',
    })
    expect(teamOf(next, 'alpha')).toMatchObject({
      name: 'Claims Alpha',
      code: 'CA',
      size: 9,
      color: '#2f6fde',
      notes: 'Near the window',
    })
  })

  it('leaves the other teams, the days, the wishes and the seats alone, also when the team shrinks', () => {
    const p = start()
    const next = update(p, { size: 1 })
    const before = teamOf(p, 'alpha')
    const after = teamOf(next, 'alpha')
    expect(after.days).toBe(before.days)
    expect(after.wishes).toBe(before.wishes)
    expect(after.seating).toBe(before.seating)
    expect(after.daySeating).toBe(before.daySeating)
    expect(teamOf(next, 'beta')).toBe(teamOf(p, 'beta'))
    expect(next.floors).toBe(p.floors)
  })

  it('cuts the code to four characters', () => {
    expect(teamOf(update(start(), { code: 'CLAIMS' }), 'alpha').code).toBe('CLAI')
    expect(teamOf(update(start(), { code: '' }), 'alpha').code).toBe('')
  })

  it.each([
    [7.4, 7],
    [7.5, 8],
    [0, 0],
    [-2, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('makes the size a whole number of zero or more: %d becomes %d', (given, expected) => {
    expect(teamOf(update(start(), { size: given }), 'alpha').size).toBe(expected)
  })

  it('writes the colour in the normal form', () => {
    expect(teamOf(update(start(), { color: '#2F6FDE' }), 'alpha').color).toBe('#2f6fde')
    expect(teamOf(update(start(), { color: 'abc' }), 'alpha').color).toBe('#aabbcc')
  })

  it('sets, clamps and clears the attendance of the team', () => {
    expect(teamOf(update(start(), { attendance: 0.75 }), 'alpha').attendance).toBe(0.75)
    expect(teamOf(update(start(), { attendance: 0.01 }), 'alpha').attendance).toBe(MIN_ATTENDANCE)
    expect(teamOf(update(start(), { attendance: 4 }), 'alpha').attendance).toBe(1)
    const withOwn = update(start(), { attendance: 0.75 })
    expect(teamOf(update(withOwn, { attendance: null }), 'alpha').attendance).toBeNull()
  })

  it('sets the preferred floor, and clears it when the floor does not exist', () => {
    const preferred = update(start(), { homeFloorId: '2' })
    expect(teamOf(preferred, 'alpha').homeFloorId).toBe('2')
    expect(teamOf(update(preferred, { homeFloorId: 'ghost' }), 'alpha').homeFloorId).toBeNull()
    expect(teamOf(update(preferred, { homeFloorId: null }), 'alpha').homeFloorId).toBeNull()
  })

  it('changes nothing when nothing would be different', () => {
    const p = start()
    const alpha = teamOf(p, 'alpha')
    expect(update(p, {})).toBe(p)
    expect(update(p, { name: alpha.name, code: alpha.code, size: alpha.size, color: alpha.color })).toBe(p)
    expect(update(p, { domainId: null, artId: null, notes: '', attendance: null, homeFloorId: null })).toBe(p)
    expect(update(p, { domainId: 'ghost', artId: 'ghost' })).toBe(p)
    // Values that come out the same once they are cleaned up.
    expect(update(p, { size: 4.2 })).toBe(p)
    expect(update(p, { color: alpha.color.toUpperCase() })).toBe(p)
    expect(update(p, { homeFloorId: 'ghost' })).toBe(p)
  })

  it('keeps the colour it has when the new one is not a colour', () => {
    const p = start()
    expect(update(p, { color: 'red' })).toBe(p)
    expect(teamOf(update(p, { color: 'red', size: 5 }), 'alpha')).toMatchObject({ color: teamOf(p, 'alpha').color, size: 5 })
  })

  it('changes nothing for a team that does not exist', () => {
    const p = start()
    expect(update(p, { name: 'Nobody' }, 'ghost')).toBe(p)
  })
})

describe('team/remove', () => {
  it('removes the team with its seats and leaves the others as they were', () => {
    const p = plan([team('alpha', 4, ['tue'], { a1: 4 }), team('beta', 2, ['tue'], { a2: 2 })])
    const next = apply(p, { type: 'team/remove', id: 'alpha' })
    expect(next.teams.map((t) => t.id)).toEqual(['beta'])
    expect(teamOf(next, 'beta')).toBe(teamOf(p, 'beta'))
    expect(next.floors).toBe(p.floors)
  })

  it('changes nothing for a team that does not exist', () => {
    const p = plan([team('alpha', 4)])
    expect(apply(p, { type: 'team/remove', id: 'ghost' })).toBe(p)
  })
})

describe('team/setWish', () => {
  const WISHES: DayWish[] = ['want', 'can', 'none', 'cannot']
  const setWish = (p: Project, wish: DayWish, id = 'alpha') => apply(p, { type: 'team/setWish', id, day: 'tue', wish })

  /** Alpha with the given wish for Tuesday. Thursday is a wanted and planned day on which
   *  the team sits in B1; when Tuesday is planned, the team sits in A2 on that day. */
  function alphaSaying(wish: DayWish, tuesdayPlanned: boolean): Team {
    // Friday is a team day with the normal seating (A1), so that seating is in use and
    // stays the normal one whatever happens to Tuesday.
    return team('alpha', 4, tuesdayPlanned ? ['tue', 'thu', 'fri'] : ['thu', 'fri'], { a1: 4 }, {
      wishes: { mon: 'none', tue: wish, wed: 'none', thu: 'want', fri: 'want' },
      daySeating: tuesdayPlanned ? { tue: { a2: 4 }, thu: { b1: 4 } } : { thu: { b1: 4 } },
    })
  }

  /** The rule as the action describes it: `want` plans the day, `cannot` unplans it, `can`
   *  and `none` unplan it only when it was a wanted day before. */
  function plannedAfter(from: DayWish, to: DayWish, plannedBefore: boolean): boolean {
    if (to === 'want') return true
    if (to === 'cannot') return false
    return from === 'want' ? false : plannedBefore
  }

  for (const from of WISHES) {
    for (const to of WISHES) {
      for (const plannedBefore of [true, false]) {
        const situation = `from "${from}" to "${to}" with Tuesday ${plannedBefore ? 'planned' : 'not planned'}`

        if (from === to) {
          it(`${situation}: nothing changes`, () => {
            const p = plan([alphaSaying(from, plannedBefore)])
            expect(setWish(p, to)).toBe(p)
          })
          continue
        }

        const planned = plannedAfter(from, to, plannedBefore)
        it(`${situation}: Tuesday is ${planned ? 'planned' : 'not planned'} afterwards`, () => {
          const next = setWish(plan([alphaSaying(from, plannedBefore)]), to)
          const alpha = teamOf(next, 'alpha')
          expect(alpha.wishes).toEqual({ mon: 'none', tue: to, wed: 'none', thu: 'want', fri: 'want' })
          expect(alpha.days).toEqual(planned ? ['tue', 'thu', 'fri'] : ['thu', 'fri'])
          // Tuesday keeps its own seating only while it stays planned. A day that is newly
          // planned starts with the normal seating, and Thursday is never touched.
          expect(alpha.daySeating).toEqual(planned && plannedBefore ? { tue: { a2: 4 }, thu: { b1: 4 } } : { thu: { b1: 4 } })
          expect(alpha.seating).toEqual({ a1: 4 })
          expect(violations(next)).toEqual([])
        })
      }
    }
  }

  it('keeps the planned days in week order when a wanted day is added', () => {
    const p = plan([team('alpha', 4, ['mon', 'fri'])])
    const next = apply(p, { type: 'team/setWish', id: 'alpha', day: 'wed', wish: 'want' })
    expect(teamOf(next, 'alpha').days).toEqual(['mon', 'wed', 'fri'])
  })

  it('leaves the other teams as they were', () => {
    const p = plan([alphaSaying('none', false), team('beta', 2, ['tue'])])
    expect(teamOf(setWish(p, 'want'), 'beta')).toBe(teamOf(p, 'beta'))
  })

  it('changes nothing for a team that does not exist', () => {
    const p = plan([alphaSaying('none', false)])
    expect(setWish(p, 'want', 'ghost')).toBe(p)
  })
})

describe('team/setPlanned', () => {
  const start = () =>
    plan([
      team('alpha', 4, ['tue', 'thu'], { a1: 4 }, {
        wishes: { mon: 'cannot', tue: 'want', wed: 'none', thu: 'want', fri: 'can' },
        daySeating: { thu: { b1: 4 } },
      }),
      team('beta', 2, ['tue']),
    ])
  const setPlanned = (p: Project, day: Weekday, planned: boolean, id = 'alpha') =>
    apply(p, { type: 'team/setPlanned', id, day, planned })

  it('plans a day, in week order, without touching wishes or seats', () => {
    const p = start()
    const next = setPlanned(p, 'wed', true)
    expect(teamOf(next, 'alpha').days).toEqual(['tue', 'wed', 'thu'])
    expect(teamOf(next, 'alpha').wishes).toBe(teamOf(p, 'alpha').wishes)
    expect(teamOf(next, 'alpha').seating).toBe(teamOf(p, 'alpha').seating)
    expect(teamOf(next, 'alpha').daySeating).toBe(teamOf(p, 'alpha').daySeating)
    expect(teamOf(next, 'beta')).toBe(teamOf(p, 'beta'))
    expect(teamOf(setPlanned(p, 'mon', true), 'alpha').days).toEqual(['mon', 'tue', 'thu'])
    expect(teamOf(setPlanned(p, 'fri', true), 'alpha').days).toEqual(['tue', 'thu', 'fri'])
  })

  it('unplans a day and drops the seating that day had of its own', () => {
    const next = setPlanned(start(), 'thu', false)
    expect(teamOf(next, 'alpha').days).toEqual(['tue'])
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 4 }, daySeating: {} })
    expect(violations(next)).toEqual([])
  })

  it('makes the seating of the only day left the normal one, when that day had its own', () => {
    const next = setPlanned(start(), 'tue', false)
    expect(teamOf(next, 'alpha').days).toEqual(['thu'])
    // Thursday is now every team day there is: where the team sits then IS its seating. The
    // old normal seating (A1) would otherwise stay behind unseen and come back with the next
    // day that is planned.
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { b1: 4 }, daySeating: {} })
    expect(violations(next)).toEqual([])
    expect(seatingOn(teamOf(setPlanned(next, 'fri', true), 'alpha'), 'fri')).toEqual({ b1: 4 })
  })

  it("is the planner's decision: it goes against the wishes and leaves them as they are", () => {
    const p = start()
    const against = setPlanned(setPlanned(p, 'mon', true), 'tue', false)
    expect(teamOf(against, 'alpha').days).toEqual(['mon', 'thu'])
    expect(teamOf(against, 'alpha').wishes).toEqual(teamOf(p, 'alpha').wishes)
  })

  it('changes nothing when the day is already as asked, or the team does not exist', () => {
    const p = start()
    expect(setPlanned(p, 'tue', true)).toBe(p)
    expect(setPlanned(p, 'wed', false)).toBe(p)
    expect(setPlanned(p, 'wed', true, 'ghost')).toBe(p)
  })
})

describe('team/moveDay', () => {
  const start = () =>
    plan([
      team('alpha', 4, ['tue', 'thu'], { a1: 4 }, {
        wishes: { mon: 'none', tue: 'want', wed: 'cannot', thu: 'want', fri: 'none' },
        daySeating: { tue: { a2: 4 } },
      }),
    ])
  const move = (p: Project, from: Weekday, to: Weekday, id = 'alpha') => apply(p, { type: 'team/moveDay', id, from, to })

  it('plans the new day instead of the old one, in week order', () => {
    expect(teamOf(move(start(), 'tue', 'fri'), 'alpha').days).toEqual(['thu', 'fri'])
    expect(teamOf(move(start(), 'thu', 'mon'), 'alpha').days).toEqual(['mon', 'tue'])
  })

  it('leaves the wishes as they are, also when the team said it cannot come', () => {
    const p = start()
    const next = move(p, 'tue', 'wed')
    expect(teamOf(next, 'alpha').days).toEqual(['wed', 'thu'])
    expect(teamOf(next, 'alpha').wishes).toBe(teamOf(p, 'alpha').wishes)
  })

  it('takes the seats of the old day along: a seating of its own moves to the new day', () => {
    const next = move(start(), 'tue', 'wed')
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 4 }, daySeating: { wed: { a2: 4 } } })
    expect(seatingOn(teamOf(next, 'alpha'), 'wed')).toEqual({ a2: 4 })
    expect(violations(next)).toEqual([])
  })

  it('moves a team with one day together with the seats it has on that day', () => {
    // A team in on Tuesday only, moved on Tuesday with "only Tuesday": that is its seating.
    const p = plan([team('solo', 4, ['tue'], { a1: 4 })])
    const reseated = apply(apply(p, setSeats('solo', 'a1', 0, 'tue')), setSeats('solo', 'a2', 4, 'tue'))
    expect(seatsOf(reseated, 'solo')).toStrictEqual({ seating: { a2: 4 }, daySeating: {} })
    const moved = apply(reseated, { type: 'team/moveDay', id: 'solo', from: 'tue', to: 'wed' })
    expect(seatingOn(teamOf(moved, 'solo'), 'wed')).toEqual({ a2: 4 })
    expect(violations(moved)).toEqual([])
  })

  it('keeps the seating another day has of its own', () => {
    const next = move(start(), 'thu', 'fri')
    expect(teamOf(next, 'alpha').days).toEqual(['tue', 'fri'])
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 4 }, daySeating: { tue: { a2: 4 } } })
  })

  it('just gives up the old day when the new day is a team day already', () => {
    const next = move(start(), 'tue', 'thu')
    expect(teamOf(next, 'alpha').days).toEqual(['thu'])
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 4 }, daySeating: {} })
    const other = move(start(), 'thu', 'tue')
    expect(teamOf(other, 'alpha').days).toEqual(['tue'])
    // Tuesday is the only day left and has its own seating: that becomes the normal one.
    expect(seatsOf(other, 'alpha')).toStrictEqual({ seating: { a2: 4 }, daySeating: {} })
    expect(violations(next)).toEqual([])
    expect(violations(other)).toEqual([])
  })

  it('changes nothing when there is nothing to move', () => {
    const p = start()
    expect(move(p, 'tue', 'tue')).toBe(p)
    expect(move(p, 'wed', 'fri')).toBe(p)
    expect(move(p, 'wed', 'tue')).toBe(p)
    expect(move(p, 'tue', 'wed', 'ghost')).toBe(p)
  })
})

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

describe('seat/set for every team day', () => {
  it('gives seats, changes their number and takes them away', () => {
    const p = plan([team('alpha', 8, ['tue', 'thu']), team('beta', 2)])
    const given = apply(p, setSeats('alpha', 'a1', 4))
    expect(teamOf(given, 'alpha').seating).toEqual({ a1: 4 })
    const more = apply(given, setSeats('alpha', 'a2', 3))
    expect(teamOf(more, 'alpha').seating).toEqual({ a1: 4, a2: 3 })
    const changed = apply(more, setSeats('alpha', 'a2', 1))
    expect(teamOf(changed, 'alpha').seating).toEqual({ a1: 4, a2: 1 })
    const taken = apply(changed, setSeats('alpha', 'a1', 0))
    expect(teamOf(taken, 'alpha').seating).toEqual({ a2: 1 })
    expect(teamOf(taken, 'alpha').daySeating).toEqual({})
    expect(teamOf(taken, 'beta')).toBe(teamOf(p, 'beta'))
    expect(taken.floors).toBe(p.floors)
  })

  it('seats in overflow areas like at desks', () => {
    const next = apply(plan([team('alpha', 3, ['tue'])]), setSeats('alpha', 'bench', 3))
    expect(teamOf(next, 'alpha').seating).toEqual({ bench: 3 })
  })

  it('does not stop at the capacity: an overbooked area is shown as a conflict, not prevented', () => {
    const p = plan([team('alpha', 9, ['tue']), team('beta', 4, ['tue'], { a1: 4 })])
    const next = apply(p, setSeats('alpha', 'a1', 9))
    expect(teamOf(next, 'alpha').seating).toEqual({ a1: 9 })
    expect(violations(next)).toEqual([])
  })

  it('leaves the days with a seating of their own alone', () => {
    const p = plan([team('alpha', 8, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { b1: 6 } } })])
    const next = apply(p, setSeats('alpha', 'a2', 4))
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 4, a2: 4 }, daySeating: { thu: { b1: 6 } } })
  })

  it('drops an exception that is no exception any more', () => {
    // On Thursday the team had A1 and A2; now that is what it has every day.
    const p = plan([team('alpha', 8, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { a1: 4, a2: 4 } } })])
    const next = apply(p, setSeats('alpha', 'a2', 4))
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 4, a2: 4 }, daySeating: {} })
    expect(violations(next)).toEqual([])
  })

  it('also works for a team without team days yet', () => {
    const next = apply(plan([team('alpha', 4)]), setSeats('alpha', 'a1', 4))
    expect(teamOf(next, 'alpha').seating).toEqual({ a1: 4 })
  })

  it.each([
    [2.4, { a1: 2 }],
    [2.5, { a1: 3 }],
    [0.4, {}],
    [-1, {}],
    [-0.6, {}],
  ])('makes the number of seats whole and never negative: %d', (given, expected) => {
    const p = plan([team('alpha', 4, ['tue'], { a1: 1 })])
    expect(teamOf(apply(p, setSeats('alpha', 'a1', given)), 'alpha').seating).toEqual(expected)
  })

  it('changes nothing when nothing would be different', () => {
    const p = plan([team('alpha', 4, ['tue'], { a1: 4 })])
    expect(apply(p, setSeats('alpha', 'a1', 4))).toBe(p)
    expect(apply(p, setSeats('alpha', 'a1', 4.3))).toBe(p)
    expect(apply(p, setSeats('alpha', 'a2', 0))).toBe(p)
    expect(apply(p, setSeats('alpha', 'a2', -3))).toBe(p)
  })

  it('changes nothing for an area or a team that does not exist', () => {
    const p = plan([team('alpha', 4, ['tue'], { a1: 4 })])
    expect(apply(p, setSeats('alpha', 'ghost', 2))).toBe(p)
    expect(apply(p, setSeats('alpha', 'ghost', 0))).toBe(p)
    expect(apply(p, setSeats('ghost', 'a1', 2))).toBe(p)
    expect(apply(p, setSeats('ghost', 'a1', 2, 'tue'))).toBe(p)
  })
})

describe('seat/set for one day', () => {
  const start = () => plan([team('alpha', 8, ['tue', 'thu'], { a1: 4 }), team('beta', 2)])

  it('makes an exception that starts as a copy of the normal seating', () => {
    const p = start()
    const next = apply(p, setSeats('alpha', 'a2', 2, 'thu'))
    const alpha = teamOf(next, 'alpha')
    expect(alpha.daySeating).toEqual({ thu: { a1: 4, a2: 2 } })
    expect(alpha.seating).toBe(teamOf(p, 'alpha').seating)
    expect(seatingOn(alpha, 'tue')).toEqual({ a1: 4 })
    expect(teamOf(next, 'beta')).toBe(teamOf(p, 'beta'))
    expect(violations(next)).toEqual([])
  })

  it('edits the exception once the day has one', () => {
    const withException = apply(start(), setSeats('alpha', 'a2', 2, 'thu'))
    const next = apply(withException, setSeats('alpha', 'a1', 1, 'thu'))
    expect(teamOf(next, 'alpha').daySeating).toEqual({ thu: { a1: 1, a2: 2 } })
    expect(teamOf(next, 'alpha').seating).toEqual({ a1: 4 })
  })

  it('keeps the exceptions of other days as they are', () => {
    const p = plan([team('alpha', 8, ['tue', 'wed', 'thu'], { a1: 4 }, { daySeating: { tue: { b1: 6 } } })])
    const next = apply(p, setSeats('alpha', 'a2', 2, 'thu'))
    expect(teamOf(next, 'alpha').daySeating).toEqual({ tue: { b1: 6 }, thu: { a1: 4, a2: 2 } })
  })

  it('lets an exception that becomes equal to the normal seating disappear', () => {
    const withException = apply(start(), setSeats('alpha', 'a2', 2, 'thu'))
    const back = apply(withException, setSeats('alpha', 'a2', 0, 'thu'))
    expect(teamOf(back, 'alpha').daySeating).toEqual({})
    expect(teamOf(back, 'alpha').seating).toEqual({ a1: 4 })
    expect(violations(back)).toEqual([])
  })

  it('can leave the team without seats on that day: the empty exception stays', () => {
    const next = apply(start(), setSeats('alpha', 'a1', 0, 'thu'))
    expect(teamOf(next, 'alpha').daySeating).toEqual({ thu: {} })
    expect(seatingOn(teamOf(next, 'alpha'), 'thu')).toEqual({})
    expect(seatingOn(teamOf(next, 'alpha'), 'tue')).toEqual({ a1: 4 })
    expect(violations(next)).toEqual([])
  })

  it('makes the number of seats whole and never negative', () => {
    const p = start()
    expect(teamOf(apply(p, setSeats('alpha', 'a2', 2.5, 'thu')), 'alpha').daySeating).toEqual({ thu: { a1: 4, a2: 3 } })
    expect(teamOf(apply(p, setSeats('alpha', 'a1', -2, 'thu')), 'alpha').daySeating).toEqual({ thu: {} })
  })

  it('changes nothing on a day that is not a team day', () => {
    const p = start()
    expect(apply(p, setSeats('alpha', 'a2', 2, 'wed'))).toBe(p)
    expect(apply(p, setSeats('alpha', 'a1', 0, 'mon'))).toBe(p)
  })

  it('changes nothing when the day already has those seats', () => {
    const p = start()
    expect(apply(p, setSeats('alpha', 'a1', 4, 'thu'))).toBe(p)
    expect(apply(p, setSeats('alpha', 'a2', 0, 'thu'))).toBe(p)
    const withException = apply(p, setSeats('alpha', 'a2', 2, 'thu'))
    expect(apply(withException, setSeats('alpha', 'a2', 2, 'thu'))).toBe(withException)
  })
})

describe('seat/set in a room', () => {
  // A1 was changed into a room after Alpha was seated there: it still holds 4 seats, and on
  // Thursday only 1.
  const start = () => {
    const seated = plan([team('alpha', 4, ['tue', 'thu'], { a1: 4, a2: 1 }, { daySeating: { thu: { a1: 1 } } })])
    return apply(seated, { type: 'area/update', id: 'a1', patch: { kind: 'no-seating' } })
  }

  it('refuses to give a team seats in a room', () => {
    const p = plan([team('alpha', 4, ['tue', 'thu'])])
    expect(apply(p, setSeats('alpha', 'room', 2))).toBe(p)
    expect(apply(p, setSeats('alpha', 'room', 2, 'tue'))).toBe(p)
  })

  it('refuses to raise the seats a team still holds in a room', () => {
    const p = start()
    expect(apply(p, setSeats('alpha', 'a1', 5))).toBe(p)
    expect(apply(p, setSeats('alpha', 'a1', 2, 'thu'))).toBe(p)
  })

  it('takes all the seats in a room away', () => {
    const next = apply(start(), setSeats('alpha', 'a1', 0))
    expect(teamOf(next, 'alpha').seating).toEqual({ a2: 1 })
    expect(teamOf(apply(start(), setSeats('alpha', 'a1', 0, 'thu')), 'alpha').daySeating).toEqual({ thu: {} })
  })

  it('takes some of the seats in a room away: seats can always be taken away', () => {
    const next = apply(start(), setSeats('alpha', 'a1', 2))
    expect(teamOf(next, 'alpha').seating).toEqual({ a1: 2, a2: 1 })
    // For one day: Tuesday starts from the normal seating, where the team holds 4.
    const tuesday = apply(start(), setSeats('alpha', 'a1', 3, 'tue'))
    // Both team days now have a seating of their own, so the old normal one is in use on no
    // day: Tuesday's, with more seats, takes its place and Thursday stays the exception.
    expect(seatsOf(tuesday, 'alpha')).toStrictEqual({ seating: { a1: 3, a2: 1 }, daySeating: { thu: { a1: 1 } } })
    expect(seatingOn(teamOf(tuesday, 'alpha'), 'tue')).toEqual({ a1: 3, a2: 1 })
    expect(violations(tuesday)).toEqual([])
  })
})

describe('seat/clear', () => {
  const clear = (p: Project, scope: SeatingScope, teamId = 'alpha') => apply(p, { type: 'seat/clear', teamId, scope })

  it('removes every seat of the team, exceptions included', () => {
    const p = plan([
      team('alpha', 8, ['tue', 'thu'], { a1: 4, a2: 4 }, { daySeating: { thu: { b1: 6 } } }),
      team('beta', 2, ['tue'], { a3: 2 }),
    ])
    const next = clear(p, 'all')
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: {}, daySeating: {} })
    expect(teamOf(next, 'alpha').days).toEqual(['tue', 'thu'])
    expect(teamOf(next, 'beta')).toBe(teamOf(p, 'beta'))
  })

  it('removes an exception that is all a team has', () => {
    const p = plan([team('alpha', 8, ['tue', 'thu'], {}, { daySeating: { thu: { b1: 6 } } })])
    expect(seatsOf(clear(p, 'all'), 'alpha')).toStrictEqual({ seating: {}, daySeating: {} })
  })

  it('for one day leaves an empty exception, so the other days keep their seats', () => {
    const p = plan([team('alpha', 8, ['tue', 'thu'], { a1: 4, a2: 4 })])
    const next = clear(p, 'thu')
    const alpha = teamOf(next, 'alpha')
    expect(alpha.seating).toEqual({ a1: 4, a2: 4 })
    expect(alpha.daySeating).toEqual({ thu: {} })
    expect(seatingOn(alpha, 'thu')).toEqual({})
    expect(seatingOn(alpha, 'tue')).toEqual({ a1: 4, a2: 4 })
    expect(violations(next)).toEqual([])
  })

  it('for one day empties the exception that day has', () => {
    const p = plan([team('alpha', 8, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { b1: 6 } } })])
    expect(seatsOf(clear(p, 'thu'), 'alpha')).toStrictEqual({ seating: { a1: 4 }, daySeating: { thu: {} } })
  })

  it('for one day drops the exception when the team has no normal seats either', () => {
    const p = plan([team('alpha', 8, ['tue', 'thu'], {}, { daySeating: { thu: { b1: 6 } } })])
    const next = clear(p, 'thu')
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: {}, daySeating: {} })
    expect(violations(next)).toEqual([])
  })

  it('changes nothing when there is nothing to clear', () => {
    const empty = plan([team('alpha', 8, ['tue', 'thu'])])
    expect(clear(empty, 'all')).toBe(empty)
    expect(clear(empty, 'tue')).toBe(empty)
    const cleared = plan([team('alpha', 8, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: {} } })])
    expect(clear(cleared, 'thu')).toBe(cleared)
  })

  it('changes nothing on a day that is not a team day, or for a team that does not exist', () => {
    const p = plan([team('alpha', 8, ['tue', 'thu'], { a1: 4 })])
    expect(clear(p, 'wed')).toBe(p)
    expect(clear(p, 'all', 'ghost')).toBe(p)
    expect(clear(p, 'tue', 'ghost')).toBe(p)
  })
})

describe('seat/resetDay', () => {
  const reset = (p: Project, day: Weekday, teamId = 'alpha') => apply(p, { type: 'seat/resetDay', teamId, day })
  const start = () => plan([team('alpha', 8, ['tue', 'wed', 'thu'], { a1: 4 }, { daySeating: { tue: {}, thu: { b1: 6 } } })])

  it('drops the exception, so the day uses the normal seating again', () => {
    const next = reset(start(), 'thu')
    const alpha = teamOf(next, 'alpha')
    expect(alpha.daySeating).toEqual({ tue: {} })
    expect(seatingOn(alpha, 'thu')).toEqual({ a1: 4 })
    expect(alpha.seating).toEqual({ a1: 4 })
  })

  it('drops an empty exception too', () => {
    expect(teamOf(reset(start(), 'tue'), 'alpha').daySeating).toEqual({ thu: { b1: 6 } })
  })

  it('changes nothing for a day without exception or a team that does not exist', () => {
    const p = start()
    expect(reset(p, 'wed')).toBe(p)
    expect(reset(p, 'mon')).toBe(p)
    expect(reset(p, 'thu', 'ghost')).toBe(p)
  })
})

describe('seat/replace', () => {
  const start = () =>
    plan([
      team('alpha', 8, ['tue', 'thu'], { a1: 4 }, { daySeating: { tue: { a2: 4 } } }),
      team('beta', 2, ['tue'], { a3: 2 }),
    ])
  const replace = (p: Project, seating: Seating, daySeating?: Partial<Record<Weekday, Seating>>, teamId = 'alpha') =>
    apply(
      p,
      daySeating === undefined ? { type: 'seat/replace', teamId, seating } : { type: 'seat/replace', teamId, seating, daySeating },
    )

  it('replaces the normal seating and the exceptions', () => {
    const p = start()
    const next = replace(p, { b1: 6, b2: 2 }, { thu: { b2: 4 } })
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { b1: 6, b2: 2 }, daySeating: { thu: { b2: 4 } } })
    expect(teamOf(next, 'alpha').days).toEqual(['tue', 'thu'])
    expect(teamOf(next, 'beta')).toBe(teamOf(p, 'beta'))
    expect(violations(next)).toEqual([])
  })

  it('replaces the whole seating: exceptions that are not given again are gone', () => {
    expect(seatsOf(replace(start(), { b1: 6 }), 'alpha')).toStrictEqual({ seating: { b1: 6 }, daySeating: {} })
    expect(seatsOf(replace(start(), { b1: 6 }, {}), 'alpha')).toStrictEqual({ seating: { b1: 6 }, daySeating: {} })
  })

  it('drops seats in rooms and in areas that do not exist', () => {
    const next = replace(start(), { a1: 2, room: 3, ghost: 2 }, { thu: { room: 1, b1: 2, ghost: 4 } })
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 2 }, daySeating: { thu: { b1: 2 } } })
    expect(violations(next)).toEqual([])
  })

  it('makes seat counts whole and drops the ones that are not above zero', () => {
    const next = replace(start(), { a1: 2.4, a2: 0, a3: -1, bench: 1.5, b1: Number.NaN })
    expect(teamOf(next, 'alpha').seating).toEqual({ a1: 2, bench: 2 })
    expect(violations(next)).toEqual([])
  })

  it('drops seatings for days that are not team days', () => {
    const next = replace(start(), { a1: 4 }, { mon: { b1: 4 }, wed: { b2: 4 }, thu: { b1: 4 } })
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 4 }, daySeating: { thu: { b1: 4 } } })
  })

  it('reads a day that is given without a seating as a day without exception', () => {
    const next = replace(start(), { a1: 4 }, { tue: undefined, thu: { b1: 4 } })
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 4 }, daySeating: { thu: { b1: 4 } } })
  })

  it('drops a day seating that is the same as the normal one, and keeps an empty one', () => {
    const next = replace(start(), { b1: 6 }, { tue: { b1: 6 }, thu: {} })
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { b1: 6 }, daySeating: { thu: {} } })
    expect(violations(next)).toEqual([])
  })

  it('changes nothing when the seating is what the team has', () => {
    const p = start()
    expect(replace(p, { a1: 4 }, { tue: { a2: 4 } })).toBe(p)
    // The same once it is cleaned up.
    expect(replace(p, { a1: 4.2, room: 3 }, { tue: { a2: 4 }, wed: { b1: 1 }, thu: { a1: 4 } })).toBe(p)
    const two = plan([team('alpha', 8, ['tue'], { a1: 4, a2: 4 })])
    expect(replace(two, { a2: 4, a1: 4 })).toBe(two)
    const none = plan([team('alpha', 8, ['tue'])])
    expect(replace(none, {})).toBe(none)
  })

  it('changes nothing for a team that does not exist', () => {
    const p = start()
    expect(replace(p, { b1: 6 }, undefined, 'ghost')).toBe(p)
  })
})

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

describe('floor/add', () => {
  const add = (p: Project, added: Floor) => apply(p, { type: 'floor/add', floor: added })

  it('puts the floor on top of the building', () => {
    const p = plan([team('alpha', 4)])
    const third = floor('3', [area('c1', 8)])
    const next = add(p, third)
    expect(next.floors.map((f) => f.id)).toEqual(['1', '2', '3'])
    expect(next.floors[2]).toBe(third)
    expect(next.floors[0]).toBe(p.floors[0])
    expect(next.teams).toBe(p.teams)
    expect(violations(next)).toEqual([])
  })

  it('refuses a floor whose id is in use', () => {
    const p = plan()
    expect(add(p, floor('2', [area('c1', 8)]))).toBe(p)
  })

  it('refuses a floor with an area id that another floor uses', () => {
    const p = plan()
    expect(add(p, floor('3', [area('c1', 8), area('b2', 4)]))).toBe(p)
  })

  it('refuses a floor that uses an area id twice itself', () => {
    const p = plan()
    expect(add(p, floor('3', [area('c1', 8), area('c1', 4)]))).toBe(p)
  })

  it('accepts a copy of a floor that is already in the building', () => {
    const p = plan()
    const next = add(p, copyFloor(floorOf(p, '1'), 'Floor 3'))
    expect(next.floors.map((f) => f.name)).toEqual(['Floor 1', 'Floor 2', 'Floor 3'])
    expect(indexAreas(next).size).toBe(7 + 5)
    expect(violations(next)).toEqual([])
  })

  it('makes a floor sound before adding it', () => {
    const rough: Floor = {
      ...floor('3', [
        area('c1', 2.5, { rect: { x: 0.9, y: -1, w: 0.5, h: 0.25 } }),
        area('c2', -4, { rect: { x: Number.NaN, y: 0.5, w: 0, h: 0.25 } }),
        area('c3', 6, { rect: { x: 0.25, y: 0.25, w: 0.25, h: 0.25 } }),
      ]),
      label: 'THREE',
    }
    const next = add(plan(), rough)
    const added = floorOf(next, '3')
    expect(added.label).toBe('THR')
    expect(added.areas.map((a) => a.capacity)).toEqual([3, 0, 6])
    expect(added.areas[0]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.25 })
    expect(added.areas[1]?.rect).toEqual({ x: 0, y: 0.5, w: 0.01, h: 0.25 })
    // What was sound already is kept as the object it was.
    expect(added.areas[2]).toBe(rough.areas[2])
    expect(violations(next)).toEqual([])
  })
})

describe('floor/update', () => {
  const drawing: PlanImage = { src: 'data:image/png;base64,AAAA', width: 800, height: 400 }
  const update = (p: Project, patch: FloorPatch, id = '1') => apply(p, { type: 'floor/update', id, patch })

  it('changes the name and the label', () => {
    const p = plan([team('alpha', 4)])
    const next = update(p, { name: 'Ground floor', label: 'G' })
    expect(floorOf(next, '1')).toMatchObject({ name: 'Ground floor', label: 'G' })
    expect(floorOf(next, '1').areas).toBe(floorOf(p, '1').areas)
    expect(floorOf(next, '2')).toBe(floorOf(p, '2'))
    expect(next.teams).toBe(p.teams)
  })

  it('cuts the label to three characters', () => {
    expect(floorOf(update(plan(), { label: 'GROUND' }), '1').label).toBe('GRO')
  })

  it('sets, replaces and removes the drawing', () => {
    const drawn = update(plan(), { plan: drawing })
    expect(floorOf(drawn, '1').plan).toBe(drawing)
    const other: PlanImage = { src: 'data:image/png;base64,BBBB', width: 1000, height: 500 }
    expect(floorOf(update(drawn, { plan: other }), '1').plan).toBe(other)
    expect(floorOf(update(drawn, { plan: null }), '1').plan).toBeNull()
  })

  it('changes nothing when nothing would be different', () => {
    const p = update(plan(), { plan: drawing })
    expect(update(p, {})).toBe(p)
    expect(update(p, { name: 'Floor 1', label: '1' })).toBe(p)
    expect(update(p, { plan: drawing })).toBe(p)
    const undrawn = plan()
    expect(update(undrawn, { plan: null })).toBe(undrawn)
    // A label that is the same once it is cut.
    const long = update(plan(), { label: 'GROUND' })
    expect(update(long, { label: 'GROUND' })).toBe(long)
  })

  it('changes nothing when the same drawing is loaded again', () => {
    const p = update(plan(), { plan: drawing })
    expect(update(p, { plan: { ...drawing } })).toBe(p)
  })

  it('takes another picture of the same size, and the same picture at another size, as a new drawing', () => {
    const p = update(plan(), { plan: drawing })
    const repainted: PlanImage = { ...drawing, src: 'data:image/png;base64,CCCC' }
    expect(floorOf(update(p, { plan: repainted }), '1').plan).toBe(repainted)
    const wider: PlanImage = { ...drawing, width: 1600 }
    expect(floorOf(update(p, { plan: wider }), '1').plan).toBe(wider)
    const higher: PlanImage = { ...drawing, height: 800 }
    expect(floorOf(update(p, { plan: higher }), '1').plan).toBe(higher)
  })

  it('changes nothing for a floor that does not exist', () => {
    const p = plan()
    expect(update(p, { name: 'Attic' }, 'ghost')).toBe(p)
  })
})

describe('floor/remove', () => {
  // Alpha prefers floor 2 and sits on both floors, on Thursday only upstairs. Beta sits only
  // upstairs. Gamma has nothing to do with floor 2. Delta sits on both floors, on Thursday
  // only downstairs.
  const start = () =>
    plan([
      team('alpha', 4, ['tue', 'thu'], { a1: 2, b1: 2 }, { daySeating: { thu: { b2: 4 } }, homeFloorId: '2' }),
      team('beta', 3, ['tue'], { b1: 3 }),
      team('gamma', 1, ['wed'], { a1: 1 }, { homeFloorId: '1' }),
      team('delta', 4, ['tue', 'thu'], { a2: 2, b2: 2 }, { daySeating: { thu: { a2: 2 } } }),
    ])
  const remove = (p: Project, id: string) => apply(p, { type: 'floor/remove', id })

  it('removes the floor with its areas and keeps the other floors as they were', () => {
    const p = start()
    const next = remove(p, '2')
    expect(next.floors.map((f) => f.id)).toEqual(['1'])
    expect(floorOf(next, '1')).toBe(floorOf(p, '1'))
    expect([...indexAreas(next).keys()]).toEqual(['a1', 'a2', 'a3', 'bench', 'room'])
    expect(violations(next)).toEqual([])
  })

  it('takes away the seats teams held there, in normal seatings and in exceptions', () => {
    const next = remove(start(), '2')
    expect(teamOf(next, 'alpha').seating).toEqual({ a1: 2 })
    expect(seatsOf(next, 'beta')).toStrictEqual({ seating: {}, daySeating: {} })
    expect(teamOf(next, 'beta').days).toEqual(['tue'])
    for (const t of next.teams) {
      for (const seating of [t.seating, ...Object.values(t.daySeating)]) {
        expect(Object.keys(seating).filter((areaId) => areaId.startsWith('b'))).toEqual([])
      }
    }
  })

  it('leaves a team that sat there on one day without seats on that day, not back at its normal seats', () => {
    // The planner moved Alpha away from its normal seats on Thursday for a reason; putting it
    // back there unasked could collide with whoever has those seats on Thursday.
    const next = remove(start(), '2')
    expect(teamOf(next, 'alpha').daySeating).toEqual({ thu: {} })
    expect(seatingOn(teamOf(next, 'alpha'), 'thu')).toEqual({})
  })

  it('drops an exception that has become the same as the normal seating', () => {
    const next = remove(start(), '2')
    expect(seatsOf(next, 'delta')).toStrictEqual({ seating: { a2: 2 }, daySeating: {} })
  })

  it('clears the preferred floor of the teams that preferred it', () => {
    const next = remove(start(), '2')
    expect(teamOf(next, 'alpha').homeFloorId).toBeNull()
    expect(teamOf(next, 'gamma').homeFloorId).toBe('1')
  })

  it('keeps the teams that had nothing to do with the floor as the objects they were', () => {
    const p = start()
    expect(teamOf(remove(p, '2'), 'gamma')).toBe(teamOf(p, 'gamma'))
    const downstairs = remove(p, '1')
    expect(teamOf(downstairs, 'beta')).toBe(teamOf(p, 'beta'))
    expect(violations(downstairs)).toEqual([])
  })

  it('can remove the last floor', () => {
    const next = remove(remove(start(), '1'), '2')
    expect(next.floors).toEqual([])
    for (const t of next.teams) {
      expect(seatsOf(next, t.id)).toStrictEqual({ seating: {}, daySeating: {} })
      expect(t.homeFloorId).toBeNull()
    }
    expect(violations(next)).toEqual([])
  })

  it('changes nothing for a floor that does not exist', () => {
    const p = start()
    expect(remove(p, 'ghost')).toBe(p)
  })
})

describe('floor/move', () => {
  const three = () =>
    project(
      [floor('1', [area('a1', 4)]), floor('2', [area('b1', 4)]), floor('3', [area('c1', 4)])],
      [team('alpha', 4, ['tue'], { a1: 4 })],
    )
  const move = (p: Project, id: string, by: 1 | -1) => apply(p, { type: 'floor/move', id, by })
  const order = (p: Project) => p.floors.map((f) => f.id)

  it('moves a floor one place up or down', () => {
    expect(order(move(three(), '1', 1))).toEqual(['2', '1', '3'])
    expect(order(move(three(), '2', 1))).toEqual(['1', '3', '2'])
    expect(order(move(three(), '3', -1))).toEqual(['1', '3', '2'])
    expect(order(move(three(), '2', -1))).toEqual(['2', '1', '3'])
  })

  it('only changes the order: floors and teams stay the objects they were', () => {
    const p = three()
    const next = move(p, '1', 1)
    expect(next.floors[1]).toBe(p.floors[0])
    expect(next.floors[0]).toBe(p.floors[1])
    expect(next.teams).toBe(p.teams)
    expect(violations(next)).toEqual([])
  })

  it('changes nothing at either end of the building', () => {
    const p = three()
    expect(move(p, '3', 1)).toBe(p)
    expect(move(p, '1', -1)).toBe(p)
  })

  it('changes nothing in a building with one floor, or for a floor that does not exist', () => {
    const single = project([floor('1', [])])
    expect(move(single, '1', 1)).toBe(single)
    expect(move(single, '1', -1)).toBe(single)
    const p = three()
    expect(move(p, 'ghost', 1)).toBe(p)
    expect(move(p, 'ghost', -1)).toBe(p)
  })
})

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

describe('area/add', () => {
  const lounge = () => area('lounge', 5, { kind: 'overflow', name: 'Lounge', rect: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 } })
  const add = (p: Project, added: Area, floorId = '2') => apply(p, { type: 'area/add', floorId, area: added })

  it('adds the area at the end of its floor', () => {
    const p = plan([team('alpha', 4)])
    const next = add(p, lounge())
    expect(floorOf(next, '2').areas.map((a) => a.id)).toEqual(['b1', 'b2', 'lounge'])
    expect(areaOf(next, 'lounge')).toEqual(lounge())
    expect(floorOf(next, '1')).toBe(floorOf(p, '1'))
    expect(next.teams).toBe(p.teams)
    expect(violations(next)).toEqual([])
  })

  it('refuses an id that is in use, on this floor or on another', () => {
    const p = plan()
    expect(add(p, area('b1', 9))).toBe(p)
    expect(add(p, area('a1', 9))).toBe(p)
  })

  it('changes nothing for a floor that does not exist', () => {
    const p = plan()
    expect(add(p, lounge(), 'ghost')).toBe(p)
  })

  it.each([
    [3.6, 4],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('makes the number of seats whole and never negative: %d becomes %d', (given, expected) => {
    const next = add(plan(), { ...lounge(), capacity: given })
    expect(areaOf(next, 'lounge').capacity).toBe(expected)
    expect(violations(next)).toEqual([])
  })

  it('keeps the rectangle inside the plan', () => {
    const next = add(plan(), { ...lounge(), rect: { x: 0.9, y: -1, w: 0.5, h: 3 } })
    expect(areaOf(next, 'lounge').rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
    const broken = add(plan(), { ...lounge(), rect: { x: Number.NaN, y: Number.NaN, w: Number.NaN, h: 0 } })
    expect(violations(broken)).toEqual([])
  })
})

describe('area/update', () => {
  const start = () => plan([team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { a1: 2, b1: 2 } } })])
  const update = (p: Project, patch: AreaPatch, id = 'a1') => apply(p, { type: 'area/update', id, patch })

  it('changes name, kind, seats and place', () => {
    const next = update(start(), { name: 'North 1', kind: 'overflow', capacity: 6, rect: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 } })
    expect(areaOf(next, 'a1')).toEqual({
      id: 'a1',
      name: 'North 1',
      kind: 'overflow',
      capacity: 6,
      rect: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 },
    })
  })

  it('leaves the other areas, the other floors and the teams as the objects they were', () => {
    const p = start()
    const next = update(p, { capacity: 6 })
    expect(areaOf(next, 'a2')).toBe(areaOf(p, 'a2'))
    expect(floorOf(next, '2')).toBe(floorOf(p, '2'))
    expect(next.teams).toBe(p.teams)
    expect(floorOf(next, '1').areas.map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'bench', 'room'])
  })

  it('finds the area on whatever floor it is', () => {
    expect(areaOf(update(start(), { capacity: 9 }, 'b2'), 'b2').capacity).toBe(9)
  })

  it('makes the number of seats whole and never negative', () => {
    expect(areaOf(update(start(), { capacity: 2.6 }), 'a1').capacity).toBe(3)
    expect(areaOf(update(start(), { capacity: -4 }), 'a1').capacity).toBe(0)
    expect(areaOf(update(start(), { capacity: Number.NaN }), 'a1').capacity).toBe(0)
  })

  it('keeps the rectangle inside the plan and at least the minimum size', () => {
    expect(areaOf(update(start(), { rect: { x: 0.9, y: -1, w: 0.5, h: 3 } }), 'a1').rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
    const tiny = update(start(), { rect: { x: 0.5, y: 0.5, w: 0, h: -1 } })
    expect(areaOf(tiny, 'a1').rect).toEqual({ x: 0.5, y: 0.5, w: 0.01, h: 0.01 })
    const broken = update(start(), { rect: { x: Number.NaN, y: Number.POSITIVE_INFINITY, w: Number.NaN, h: Number.NaN } })
    expect(violations(broken)).toEqual([])
  })

  it('keeps the seats when an area becomes a room: that is a conflict to show, not to hide', () => {
    const p = start()
    const next = update(p, { kind: 'no-seating' })
    expect(areaOf(next, 'a1').kind).toBe('no-seating')
    expect(teamOf(next, 'alpha')).toBe(teamOf(p, 'alpha'))
    expect(violations(next)).toEqual([])
  })

  it('keeps the seats when an area gets fewer seats than teams hold there', () => {
    const p = start()
    const next = update(p, { capacity: 1 })
    expect(teamOf(next, 'alpha')).toBe(teamOf(p, 'alpha'))
  })

  it('changes nothing when nothing would be different', () => {
    const p = start()
    const a1 = areaOf(p, 'a1')
    expect(update(p, {})).toBe(p)
    expect(update(p, { name: a1.name, kind: a1.kind, capacity: a1.capacity, rect: { ...a1.rect } })).toBe(p)
    // The same once it is cleaned up.
    expect(update(p, { capacity: 4.3 })).toBe(p)
    const corner = update(p, { rect: { x: 0.75, y: 0.75, w: 0.25, h: 0.25 } })
    expect(update(corner, { rect: { x: 2, y: 2, w: 0.25, h: 0.25 } })).toBe(corner)
  })

  it('changes nothing for an area that does not exist', () => {
    const p = start()
    expect(update(p, { capacity: 9 }, 'ghost')).toBe(p)
  })
})

describe('area/remove', () => {
  const start = () =>
    plan([
      team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { a1: 2, b1: 2 } } }),
      team('beta', 4, ['tue', 'thu'], { a1: 2, a2: 2 }, { daySeating: { thu: { a2: 2 } } }),
      team('gamma', 2, ['wed'], { a3: 2 }),
    ])
  const remove = (p: Project, id: string) => apply(p, { type: 'area/remove', id })

  it('removes the area from its floor and keeps the rest of the building', () => {
    const p = start()
    const next = remove(p, 'a1')
    expect(floorOf(next, '1').areas.map((a) => a.id)).toEqual(['a2', 'a3', 'bench', 'room'])
    expect(areaOf(next, 'a2')).toBe(areaOf(p, 'a2'))
    expect(floorOf(next, '2')).toBe(floorOf(p, '2'))
    expect(violations(next)).toEqual([])
  })

  it('takes away the seats teams held there, in normal seatings and in exceptions', () => {
    const next = remove(start(), 'a1')
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: {}, daySeating: { thu: { b1: 2 } } })
  })

  it('drops an exception that has become the same as the normal seating', () => {
    const next = remove(start(), 'a1')
    expect(seatsOf(next, 'beta')).toStrictEqual({ seating: { a2: 2 }, daySeating: {} })
  })

  it('keeps the teams that held nothing there as the objects they were', () => {
    const p = start()
    expect(teamOf(remove(p, 'a1'), 'gamma')).toBe(teamOf(p, 'gamma'))
    const unused = remove(p, 'b2')
    expect(unused.teams).toBe(p.teams)
  })

  it('changes nothing for an area that does not exist', () => {
    const p = start()
    expect(remove(p, 'ghost')).toBe(p)
  })
})

// ---------------------------------------------------------------------------
// Accepted issues and batches
// ---------------------------------------------------------------------------

describe('issue/accept and issue/unaccept', () => {
  const splitFloors = 'team-split-floors|tue|-|-|alpha'
  const overflowUsed = 'overflow-used|thu|-|-|beta'
  const accept = (p: Project, id: string, note: string, detail: string) => apply(p, { type: 'issue/accept', id, note, detail })
  const unaccept = (p: Project, id: string) => apply(p, { type: 'issue/unaccept', id })

  it('remembers the note and the detail of an accepted issue', () => {
    const p = plan([team('alpha', 4)])
    const next = accept(p, splitFloors, 'They asked for it', 'Floor 1 and Floor 2')
    expect(next.accepted).toEqual({ [splitFloors]: { note: 'They asked for it', detail: 'Floor 1 and Floor 2' } })
    expect(next.teams).toBe(p.teams)
    expect(next.floors).toBe(p.floors)
  })

  it('keeps the other acceptances', () => {
    const one = accept(plan(), splitFloors, '', 'Floor 1 and Floor 2')
    const two = accept(one, overflowUsed, 'Fine for a day', '2 seats')
    expect(Object.keys(two.accepted)).toEqual([splitFloors, overflowUsed])
    expect(two.accepted[splitFloors]).toBe(one.accepted[splitFloors])
  })

  it('replaces an acceptance when the note or the detail is different', () => {
    const one = accept(plan(), splitFloors, '', 'Floor 1 and Floor 2')
    expect(accept(one, splitFloors, 'On request', 'Floor 1 and Floor 2').accepted[splitFloors]?.note).toBe('On request')
    expect(accept(one, splitFloors, '', 'Floor 1 and Floor 3').accepted[splitFloors]?.detail).toBe('Floor 1 and Floor 3')
  })

  it('changes nothing when the issue is accepted with the same note and detail already', () => {
    const one = accept(plan(), splitFloors, 'On request', 'Floor 1 and Floor 2')
    expect(accept(one, splitFloors, 'On request', 'Floor 1 and Floor 2')).toBe(one)
  })

  it('forgets an acceptance and keeps the others', () => {
    const two = accept(accept(plan(), splitFloors, '', 'a'), overflowUsed, '', 'b')
    const next = unaccept(two, splitFloors)
    expect(Object.keys(next.accepted)).toEqual([overflowUsed])
    expect(next.accepted[overflowUsed]).toBe(two.accepted[overflowUsed])
  })

  it('changes nothing when the issue was not accepted', () => {
    const p = accept(plan(), splitFloors, '', 'a')
    expect(unaccept(p, overflowUsed)).toBe(p)
    const nothingAccepted = plan()
    expect(unaccept(nothingAccepted, splitFloors)).toBe(nothingAccepted)
  })

  it('is not fooled by ids that every object seems to have', () => {
    const p = plan()
    for (const id of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) expect(unaccept(p, id)).toBe(p)
    const accepted = accept(p, 'constructor', 'odd, but fine', 'a')
    expect(Object.keys(accepted.accepted)).toEqual(['constructor'])
    expect(unaccept(accepted, 'constructor').accepted).toEqual({})
  })
})

describe('batch', () => {
  it('applies the actions in order, each on the result of the one before', () => {
    const next = apply(plan(), {
      type: 'batch',
      actions: [
        { type: 'team/add', team: team('alpha', 4, ['tue']) },
        setSeats('alpha', 'a1', 4),
        { type: 'team/moveDay', id: 'alpha', from: 'tue', to: 'wed' },
        setSeats('alpha', 'a1', 2, 'wed'),
      ],
    })
    expect(teamOf(next, 'alpha').days).toEqual(['wed'])
    // Wednesday is the team's only day, so "only Wednesday" edits its one seating.
    expect(seatsOf(next, 'alpha')).toStrictEqual({ seating: { a1: 2 }, daySeating: {} })
    expect(violations(next)).toEqual([])
  })

  it('gives the same result as the actions one by one', () => {
    const actions: Action[] = [
      { type: 'team/add', team: team('alpha', 4, ['tue', 'thu']) },
      setSeats('alpha', 'b1', 4),
      { type: 'floor/remove', id: '1' },
      { type: 'settings/update', patch: { reserve: 0.1 } },
    ]
    let oneByOne = plan()
    for (const action of actions) oneByOne = apply(oneByOne, action)
    expect(apply(plan(), { type: 'batch', actions })).toEqual(oneByOne)
  })

  it('changes nothing when it is empty or when none of its actions changes anything', () => {
    const p = plan([team('alpha', 4, ['tue'], { a1: 4 })])
    expect(apply(p, { type: 'batch', actions: [] })).toBe(p)
    expect(
      apply(p, {
        type: 'batch',
        actions: [
          setSeats('alpha', 'a1', 4),
          setSeats('alpha', 'room', 2),
          { type: 'team/remove', id: 'ghost' },
          { type: 'batch', actions: [] },
        ],
      }),
    ).toBe(p)
  })

  it('can hold other batches', () => {
    const next = apply(plan([team('alpha', 4, ['tue'])]), {
      type: 'batch',
      actions: [
        { type: 'batch', actions: [setSeats('alpha', 'a1', 2)] },
        { type: 'batch', actions: [setSeats('alpha', 'a2', 2)] },
      ],
    })
    expect(teamOf(next, 'alpha').seating).toEqual({ a1: 2, a2: 2 })
  })
})

// ---------------------------------------------------------------------------
// The checker the property test stands on
// ---------------------------------------------------------------------------

describe('violations', () => {
  const sound = () =>
    plan([team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { a2: 4 } }, homeFloorId: '1', attendance: 0.5 })])

  /** The sound project with one thing changed in its first team, floor or area. */
  const withTeam = (change: Partial<Team>): Project => {
    const p = sound()
    return { ...p, teams: [{ ...teamOf(p, 'alpha'), ...change }] }
  }
  const withFloor = (change: Partial<Floor>): Project => {
    const p = sound()
    return { ...p, floors: [{ ...floorOf(p, '1'), ...change }, floorOf(p, '2')] }
  }
  const withArea = (change: Partial<Area>): Project => {
    const first = floorOf(sound(), '1')
    return withFloor({ areas: [{ ...areaOf(sound(), 'a1'), ...change }, ...first.areas.slice(1)] })
  }
  const withRect = (change: Partial<Rect>): Project => withArea({ rect: { ...areaOf(sound(), 'a1').rect, ...change } })

  it('finds nothing wrong with a sound project', () => {
    expect(violations(sound())).toEqual([])
  })

  const damaged: [what: string, p: () => Project, reported: RegExp][] = [
    ['a floor id used twice', () => ({ ...sound(), floors: [...sound().floors, floor('1', [])] }), /duplicate floor id 1/],
    ['an area id on two floors', () => ({ ...sound(), floors: [...sound().floors, floor('3', [area('a1', 2)])] }), /duplicate area id a1/],
    ['a team id used twice', () => ({ ...sound(), teams: [...sound().teams, team('alpha', 1)] }), /duplicate team id alpha/],
    ['seats in an area that does not exist', () => withTeam({ seating: { ghost: 2 } }), /seats in missing area ghost/],
    ['such seats in an exception', () => withTeam({ daySeating: { thu: { ghost: 2 } } }), /on thu: seats in missing area ghost/],
    ['a seat count of zero', () => withTeam({ seating: { a1: 0 } }), /seat count 0 in a1/],
    ['a negative seat count', () => withTeam({ seating: { a1: -2 } }), /seat count -2 in a1/],
    ['a seat count that is not whole', () => withTeam({ seating: { a1: 1.5 } }), /seat count 1.5 in a1/],
    ['a seat count that is not a number', () => withTeam({ seating: { a1: Number.NaN } }), /seat count NaN in a1/],
    ['days out of week order', () => withTeam({ days: ['thu', 'tue'] }), /days are not unique and in week order/],
    ['a day twice', () => withTeam({ days: ['tue', 'tue', 'thu'] }), /days are not unique and in week order/],
    ['a seating for a day that is no team day', () => withTeam({ daySeating: { wed: { a2: 1 } } }), /day seating on wed, which is not a team day/],
    ['an exception that is none', () => withTeam({ daySeating: { thu: { a1: 4 } } }), /day seating on thu equals the normal seating/],
    ['an exception that is not there', () => withTeam({ daySeating: { thu: undefined } }), /day seating for thu is undefined/],
    ['a team size that is not whole', () => withTeam({ size: 4.5 }), /size 4.5/],
    ['a negative team size', () => withTeam({ size: -1 }), /size -1/],
    ['a team size that is not a number', () => withTeam({ size: Number.POSITIVE_INFINITY }), /size Infinity/],
    ['a code of five characters', () => withTeam({ code: 'ALPHA' }), /code longer than 4 characters/],
    ['a colour that is not #rrggbb', () => withTeam({ color: '#ABC' }), /colour #ABC is not #rrggbb/],
    ['an attendance of zero', () => withTeam({ attendance: 0 }), /attendance 0 outside/],
    ['an attendance above one', () => withTeam({ attendance: 1.5 }), /attendance 1.5 outside/],
    ['a preferred floor that does not exist', () => withTeam({ homeFloorId: 'ghost' }), /preferred floor is missing/],
    ['a floor label of four characters', () => withFloor({ label: 'FOUR' }), /label longer than 3 characters/],
    ['a capacity that is not whole', () => withArea({ capacity: 2.5 }), /capacity 2.5/],
    ['a negative capacity', () => withArea({ capacity: -1 }), /capacity -1/],
    ['a rectangle that sticks out to the right', () => withRect({ x: 0.95 }), /area a1: rectangle outside the plan/],
    ['a rectangle that sticks out at the bottom', () => withRect({ y: 0.5, h: 0.75 }), /area a1: rectangle outside the plan/],
    ['a rectangle left of the plan', () => withRect({ x: -0.01 }), /area a1: rectangle outside the plan/],
    ['a rectangle without width', () => withRect({ w: 0 }), /area a1: rectangle outside the plan/],
    ['a rectangle that is not made of numbers', () => withRect({ h: Number.NaN }), /area a1: rectangle outside the plan/],
    ['an attendance setting of zero', () => ({ ...sound(), settings: { attendance: 0, reserve: 0 } }), /settings: attendance/],
    ['a reserve above a half', () => ({ ...sound(), settings: { attendance: 1, reserve: 0.6 } }), /settings: reserve/],
    ['a reserve below zero', () => ({ ...sound(), settings: { attendance: 1, reserve: -0.1 } }), /settings: reserve/],
  ]

  it.each(damaged)('reports %s', (_what, makeProject, reported) => {
    const found = violations(makeProject())
    expect(found.some((line) => reported.test(line)), found.join('; ') || 'nothing reported').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Property: whatever happens, the project stays sound and the input untouched
// ---------------------------------------------------------------------------

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

/** Where every random walk starts: two floors and five teams, among them one with an
 *  exception, one without people and one with a preferred floor. */
function walkStart(): Project {
  return plan([
    team('alpha', 8, ['tue', 'thu'], { a1: 4, a2: 4 }),
    team('beta', 5, ['mon', 'tue'], { b1: 5 }),
    team('gamma', 3, ['wed'], {}, { homeFloorId: '2' }),
    team('delta', 0, ['fri']),
    team('epsilon', 12, [...WEEKDAYS], { b1: 1, b2: 4 }, { daySeating: { wed: { bench: 3 } }, attendance: 0.5 }),
  ])
}

/** Makes random actions for a project: mostly sensible ones, and a good share of nonsense
 *  (ids that do not exist, days that are not team days, rooms, numbers that are negative,
 *  fractional or not numbers at all, rectangles outside the plan, teams and floors built
 *  carelessly by hand). */
function actionMaker(random: () => number, spare: Project): (p: Project) => Action {
  let serial = 0
  const fresh = (kind: string) => {
    serial += 1
    return `${kind}-${serial}`
  }
  const chance = (probability: number) => random() < probability
  const below = (n: number) => Math.floor(random() * n)
  const pick = <T>(items: readonly T[]): T => {
    const item = items[below(items.length)]
    if (item === undefined) throw new Error('nothing to pick from')
    return item
  }

  const ODD_NUMBERS = [-3, -0.5, 0, 0.4, 1, 2.5, 7, 1000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
  const SHARES = [-1, 0, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, Number.NaN]
  const WISHES: DayWish[] = ['want', 'can', 'none', 'cannot']
  const KINDS: AreaKind[] = ['desks', 'desks', 'overflow', 'no-seating']
  const DRAWINGS: (PlanImage | null)[] = [null, { src: 'x', width: 800, height: 400 }, { src: 'y', width: 1000, height: 500 }]
  // Two ids as the app makes them, and three that every object seems to have already.
  const ISSUE_IDS = ['area-over-capacity|tue|-|a1|-', 'overflow-used|wed|-|-|epsilon', 'toString', 'constructor', '__proto__']

  const day = () => pick(WEEKDAYS)
  const scope = (): SeatingScope => (chance(0.5) ? 'all' : day())
  const count = (max: number) => (chance(0.8) ? below(max) : pick(ODD_NUMBERS))
  const teamId = (p: Project) => (p.teams.length > 0 && chance(0.9) ? pick(p.teams).id : 'ghost-team')
  const floorId = (p: Project) => (p.floors.length > 0 && chance(0.9) ? pick(p.floors).id : 'ghost-floor')
  const areaId = (p: Project) => {
    const known = [...indexAreas(p).keys()]
    return known.length > 0 && chance(0.9) ? pick(known) : 'ghost-area'
  }
  const rect = (): Rect =>
    chance(0.7)
      ? { x: random() * 0.75, y: random() * 0.75, w: 0.02 + random() * 0.2, h: 0.02 + random() * 0.2 }
      : { x: pick(ODD_NUMBERS), y: pick(ODD_NUMBERS), w: pick(ODD_NUMBERS), h: pick(ODD_NUMBERS) }
  const seating = (p: Project): Seating => {
    const seats: Seating = {}
    for (let i = below(4); i > 0; i -= 1) seats[areaId(p)] = chance(0.8) ? 1 + below(5) : pick(ODD_NUMBERS)
    return seats
  }
  const daySeating = (p: Project): Partial<Record<Weekday, Seating>> => {
    const perDay: Partial<Record<Weekday, Seating>> = {}
    for (const weekday of WEEKDAYS) if (chance(0.2)) perDay[weekday] = chance(0.9) ? seating(p) : undefined
    return perDay
  }
  const days = (): Weekday[] => {
    const some = WEEKDAYS.filter(() => chance(0.4))
    return chance(0.8) ? some : [...some, ...some].reverse()
  }

  const domainId = (p: Project) => (chance(0.2) ? null : p.domains.length > 0 && chance(0.9) ? pick(p.domains).id : 'ghost-domain')
  const artId = (p: Project) => (chance(0.2) ? null : p.arts.length > 0 && chance(0.9) ? pick(p.arts).id : 'ghost-art')

  const newArea = (p: Project): Area => ({
    id: chance(0.9) ? fresh('area') : areaId(p),
    name: `Area ${serial}`,
    kind: pick(KINDS),
    capacity: count(8),
    rect: rect(),
  })
  const newFloor = (p: Project): Floor => ({
    id: chance(0.9) ? fresh('floor') : floorId(p),
    name: `Floor ${serial}`,
    label: chance(0.8) ? String(serial).slice(0, 3) : 'TOO LONG',
    plan: pick(DRAWINGS),
    areas: Array.from({ length: below(4) }, () => newArea(p)),
  })
  const newTeam = (p: Project): Team => ({
    ...team(chance(0.9) ? fresh('team') : teamId(p), count(13)),
    code: chance(0.8) ? 'TM' : 'TOO LONG',
    color: pick([TEAM_COLORS[0], TEAM_COLORS[5], '#ABC', 'red', '']),
    days: days(),
    attendance: chance(0.6) ? null : pick(SHARES),
    homeFloorId: chance(0.6) ? null : floorId(p),
    // Often not as they belong together: team/add must make them fit.
    domainId: domainId(p),
    artId: artId(p),
    seating: seating(p),
    daySeating: daySeating(p),
  })

  const teamPatch = (p: Project): TeamPatch =>
    pick<TeamPatch>([
      {},
      { name: pick(['Claims', 'Underwriting', '']) },
      { code: pick(['CL', 'TOO LONG', '']) },
      { size: count(13) },
      { color: pick([TEAM_COLORS[2], '#ABC', 'red']) },
      { domainId: domainId(p) },
      { artId: artId(p) },
      { domainId: domainId(p), artId: artId(p) },
      { notes: pick(['', 'Near the window']) },
      { attendance: chance(0.3) ? null : pick(SHARES) },
      { homeFloorId: chance(0.3) ? null : floorId(p) },
      { size: count(13), attendance: pick(SHARES), homeFloorId: floorId(p) },
    ])
  const floorPatch = (): FloorPatch =>
    pick<FloorPatch>([
      {},
      { name: pick(['Floor 1', 'Ground floor']) },
      { label: pick(['1', 'G', 'TOO LONG']) },
      { plan: pick(DRAWINGS) },
    ])
  const areaPatch = (): AreaPatch =>
    pick<AreaPatch>([
      {},
      { name: pick(['A1', 'Lounge']) },
      { kind: pick(KINDS) },
      { capacity: count(8) },
      { rect: rect() },
      { kind: pick(KINDS), capacity: count(8) },
    ])

  const makers: [weight: number, make: (p: Project) => Action][] = [
    [2, () => ({ type: 'project/rename', name: pick(['Test plan', 'Head office']) })],
    [0.3, (p) => ({ type: 'project/replace', project: chance(0.5) ? p : spare })],
    [3, () => ({ type: 'settings/update', patch: pick([{}, { attendance: pick(SHARES) }, { reserve: pick(SHARES) }]) })],
    [4, (p) => ({ type: 'team/add', team: newTeam(p) })],
    [1, (p) => ({ type: 'team/addMany', teams: Array.from({ length: below(4) }, () => newTeam(p)) })],
    [5, (p) => ({ type: 'team/update', id: teamId(p), patch: teamPatch(p) })],
    [2, (p) => ({ type: 'team/remove', id: teamId(p) })],
    [8, (p) => ({ type: 'team/setWish', id: teamId(p), day: day(), wish: pick(WISHES) })],
    [8, (p) => ({ type: 'team/setPlanned', id: teamId(p), day: day(), planned: chance(0.6) })],
    [5, (p) => ({ type: 'team/moveDay', id: teamId(p), from: day(), to: day() })],
    [20, (p) => ({ type: 'seat/set', teamId: teamId(p), areaId: areaId(p), seats: count(6), scope: scope() })],
    [4, (p) => ({ type: 'seat/clear', teamId: teamId(p), scope: scope() })],
    [4, (p) => ({ type: 'seat/resetDay', teamId: teamId(p), day: day() })],
    [3, (p) => ({ type: 'seat/replace', teamId: teamId(p), seating: seating(p) })],
    [3, (p) => ({ type: 'seat/replace', teamId: teamId(p), seating: seating(p), daySeating: daySeating(p) })],
    [2, (p) => ({ type: 'floor/add', floor: newFloor(p) })],
    [3, (p) => ({ type: 'floor/update', id: floorId(p), patch: floorPatch() })],
    [1, (p) => ({ type: 'floor/remove', id: floorId(p) })],
    [3, (p) => ({ type: 'floor/move', id: floorId(p), by: chance(0.5) ? 1 : -1 })],
    [4, (p) => ({ type: 'area/add', floorId: floorId(p), area: newArea(p) })],
    [6, (p) => ({ type: 'area/update', id: areaId(p), patch: areaPatch() })],
    [2, (p) => ({ type: 'area/remove', id: areaId(p) })],
    [2, (p) => ({ type: 'domain/add', domain: { id: chance(0.9) ? fresh('domain') : (domainId(p) ?? 'x'), name: pick(['Non-Life', '', 'x'.repeat(80)]) } })],
    [2, (p) => ({ type: 'domain/rename', id: domainId(p) ?? 'ghost', name: pick(['Life', 'Digital', '']) })],
    [1, (p) => ({ type: 'domain/remove', id: domainId(p) ?? 'ghost' })],
    [2, (p) => ({ type: 'art/add', art: { id: chance(0.9) ? fresh('art') : (artId(p) ?? 'x'), name: pick(['Claims ART', '']), domainId: domainId(p) } })],
    [3, (p) => ({ type: 'art/update', id: artId(p) ?? 'ghost', patch: pick([{}, { name: 'Policy ART' }, { domainId: domainId(p) }]) })],
    [1, (p) => ({ type: 'art/remove', id: artId(p) ?? 'ghost' })],
    [3, () => ({ type: 'issue/accept', id: pick(ISSUE_IDS), note: pick(['', 'Fine']), detail: pick(['4 of 4', '5 of 4']) })],
    [3, () => ({ type: 'issue/unaccept', id: pick(ISSUE_IDS) })],
  ]
  const totalWeight = makers.reduce((total, [weight]) => total + weight, 0)

  const single = (p: Project): Action => {
    // Keep the building and the team list within bounds, so that actions keep meeting.
    if (p.floors.length < 2 && chance(0.3)) return { type: 'floor/add', floor: newFloor(p) }
    if (p.teams.length < 3 && chance(0.3)) return { type: 'team/add', team: newTeam(p) }
    if (p.floors.length > 4 && chance(0.3)) return { type: 'floor/remove', id: pick(p.floors).id }
    if (p.teams.length > 9 && chance(0.3)) return { type: 'team/remove', id: pick(p.teams).id }
    if (indexAreas(p).size > 16 && chance(0.3)) return { type: 'area/remove', id: pick([...indexAreas(p).keys()]) }

    let ticket = random() * totalWeight
    for (const [weight, make] of makers) {
      ticket -= weight
      if (ticket < 0) return make(p)
    }
    return { type: 'batch', actions: [] }
  }

  return (p) => (chance(0.05) ? { type: 'batch', actions: Array.from({ length: below(4) }, () => single(p)) } : single(p))
}

describe('any sequence of actions', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6]
  const STEPS_PER_SEED = 1500
  const ALL_TYPES: Action['type'][] = [
    'project/rename',
    'project/replace',
    'settings/update',
    'team/add',
    'team/addMany',
    'team/update',
    'team/remove',
    'team/setWish',
    'team/setPlanned',
    'team/moveDay',
    'seat/set',
    'seat/clear',
    'seat/resetDay',
    'seat/replace',
    'floor/add',
    'floor/update',
    'floor/remove',
    'floor/move',
    'area/add',
    'area/update',
    'area/remove',
    'domain/add',
    'domain/rename',
    'domain/remove',
    'art/add',
    'art/update',
    'art/remove',
    'issue/accept',
    'issue/unaccept',
    'batch',
  ]

  /** The action as text for a failure message; a whole project in it is left out. */
  const show = (action: Action) => JSON.stringify(action, (key, value: unknown) => (key === 'project' ? '(a project)' : value))

  it('keeps the project sound, leaves its input untouched and returns the same object when nothing changed', () => {
    const changed = new Map<Action['type'], number>()
    const unchanged = new Map<Action['type'], number>()

    for (const seed of SEEDS) {
      const start = deepFreeze(walkStart())
      const nextAction = actionMaker(seededRandom(seed), start)
      let p = start

      for (let step = 0; step < STEPS_PER_SEED; step += 1) {
        const action = deepFreeze(nextAction(p))
        const where = () => `seed ${seed}, step ${step}, ${show(action)}`

        let next: Project
        try {
          // The project and the action are frozen: changing either throws.
          next = reduce(p, action)
        } catch (error) {
          throw new Error(`${where()} threw: ${String(error)}`, { cause: error })
        }

        const broken = violations(next)
        if (broken.length > 0) throw new Error(`${where()} left the project unsound:\n  ${broken.join('\n  ')}`)

        // A new project object means an undo step, so it must come with a real change. A
        // batch may undo itself and a replaced project may look the same; those are exempt.
        const mayLookTheSame = action.type === 'batch' || action.type === 'project/replace'
        if (next !== p && !mayLookTheSame && JSON.stringify(next) === JSON.stringify(p)) {
          throw new Error(`${where()} returned a new project that is no different from the old one`)
        }

        const tally = next === p ? unchanged : changed
        tally.set(action.type, (tally.get(action.type) ?? 0) + 1)
        p = deepFreeze(next)
      }
    }

    // The walks have been through every action, both changing something and changing nothing.
    expect(ALL_TYPES.filter((type) => !changed.has(type))).toEqual([])
    expect(ALL_TYPES.filter((type) => !unchanged.has(type))).toEqual([])
  })
})
