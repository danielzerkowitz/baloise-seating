import { describe, expect, it } from 'vitest'
import { dayOccupancy, findTeam, freeOnDays, indexAreas, seatingOn, teamDayStatus } from './model'
import {
  areasOf,
  blockedMessage,
  effectiveScope,
  heldSeats,
  placeAction,
  placeIntent,
  scopedDays,
  scopedSeating,
  validSeats,
  type PlaceIntent,
} from './placing'
import { reduce } from './reducer'
import { area, floor, project, team, violations } from './testkit'
import { WEEKDAYS, type Area, type Floor, type Project, type Settings, type Team, type Weekday } from './types'

/** The office of the examples, one floor: desks A1 (4), A2 (4) and A3 (2), an overflow bench
 *  (3) and a meeting room (6). */
function office(): Floor[] {
  return [
    floor('1', [
      area('a1', 4),
      area('a2', 4),
      area('a3', 2),
      area('bench', 3, { kind: 'overflow' }),
      area('room', 6, { kind: 'no-seating' }),
    ]),
  ]
}

function plan(teams: Team[], settings: Partial<Settings> = {}): Project {
  return project(office(), teams, settings)
}

function teamOf(p: Project, id: string): Team {
  const found = findTeam(p, id)
  if (!found) throw new Error(`no team ${id}`)
  return found
}

function areaOf(p: Project, id: string): Area {
  const found = indexAreas(p).get(id)
  if (!found) throw new Error(`no area ${id}`)
  return found.area
}

/** What clicking an area would do, by ids. */
function intent(p: Project, teamId: string, areaId: string, day: Weekday, scope: 'all' | 'day' = 'all'): PlaceIntent {
  return placeIntent(p, teamOf(p, teamId), areaOf(p, areaId), day, scope)
}

/** Clicks an area: applies the action of the click, if there is one. */
function click(p: Project, teamId: string, areaId: string, day: Weekday, scope: 'all' | 'day' = 'all'): Project {
  const action = placeAction(p, teamOf(p, teamId), areaOf(p, areaId), day, scope)
  return action ? reduce(p, action) : p
}

const blocked = (reason: 'no-seating' | 'full' | 'not-in' | 'complete'): PlaceIntent => ({ type: 'blocked', reason })

/** A small seeded pseudo random generator (mulberry32), so a failing run can be repeated. */
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

describe('effectiveScope', () => {
  const alpha = team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { a2: 4 } } })

  it('edits every day when that is asked and the day shown has no seating of its own', () => {
    expect(effectiveScope(alpha, 'tue', 'all')).toBe('all')
  })

  it('edits the day shown when that is asked', () => {
    expect(effectiveScope(alpha, 'tue', 'day')).toBe('tue')
    expect(effectiveScope(alpha, 'thu', 'day')).toBe('thu')
  })

  it('edits only the day shown when the team sits differently on it, whatever was asked', () => {
    expect(effectiveScope(alpha, 'thu', 'all')).toBe('thu')
  })

  it('also counts an empty exception as sitting differently', () => {
    const cleared = team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: {} } })
    expect(effectiveScope(cleared, 'thu', 'all')).toBe('thu')
  })
})

describe('scopedSeating', () => {
  const alpha = team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { a2: 4 } } })

  it('is the normal seating for an edit of every day', () => {
    expect(scopedSeating(alpha, 'all')).toBe(alpha.seating)
  })

  it('is what the team holds on the day for an edit of one day', () => {
    expect(scopedSeating(alpha, 'tue')).toEqual({ a1: 4 })
    expect(scopedSeating(alpha, 'thu')).toEqual({ a2: 4 })
  })

  it('is empty for a day that is not a team day', () => {
    expect(scopedSeating(alpha, 'mon')).toEqual({})
  })
})

describe('scopedDays', () => {
  it('is every team day for an edit of the normal seating', () => {
    expect(scopedDays(team('alpha', 4, ['tue', 'thu', 'fri']), 'all')).toEqual(['tue', 'thu', 'fri'])
  })

  it('leaves out the days on which the team sits differently: the edit does not reach them', () => {
    const alpha = team('alpha', 4, ['tue', 'thu', 'fri'], { a1: 4 }, { daySeating: { thu: { a2: 4 } } })
    expect(scopedDays(alpha, 'all')).toEqual(['tue', 'fri'])
    const everywhereDifferent = team('alpha', 4, ['tue'], { a1: 4 }, { daySeating: { tue: {} } })
    expect(scopedDays(everywhereDifferent, 'all')).toEqual([])
  })

  it('is the one day for an edit of that day, when it is a team day', () => {
    const alpha = team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { a2: 4 } } })
    expect(scopedDays(alpha, 'tue')).toEqual(['tue'])
    expect(scopedDays(alpha, 'thu')).toEqual(['thu'])
    expect(scopedDays(alpha, 'mon')).toEqual([])
  })

  it('is empty for a team without team days', () => {
    expect(scopedDays(team('alpha', 4), 'all')).toEqual([])
  })
})

describe('validSeats', () => {
  const p = plan([])

  it('counts seats at desks and in overflow areas', () => {
    expect(validSeats(p, { a1: 4, a3: 1, bench: 2 })).toBe(7)
    expect(validSeats(p, {})).toBe(0)
  })

  it('does not count seats in a room or in an area that does not exist', () => {
    expect(validSeats(p, { room: 3 })).toBe(0)
    expect(validSeats(p, { ghost: 3 })).toBe(0)
    expect(validSeats(p, { a1: 2, room: 3, ghost: 5 })).toBe(2)
  })
})

describe('placeIntent', () => {
  describe('on a day that is not a team day', () => {
    it('is blocked, whatever the area and whatever the team holds elsewhere', () => {
      const p = plan([team('alpha', 4, ['tue'], { a1: 4 })])
      for (const areaId of ['a1', 'a2', 'bench', 'room']) {
        expect(intent(p, 'alpha', areaId, 'mon')).toEqual(blocked('not-in'))
        expect(intent(p, 'alpha', areaId, 'mon', 'day')).toEqual(blocked('not-in'))
      }
    })

    it('is blocked for a team without team days', () => {
      const p = plan([team('alpha', 4)])
      for (const day of WEEKDAYS) expect(intent(p, 'alpha', 'a1', day)).toEqual(blocked('not-in'))
    })
  })

  describe('where the team holds seats', () => {
    it('takes all of them away', () => {
      const p = plan([team('alpha', 6, ['tue'], { a1: 3, a3: 2 })])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual({ type: 'remove', seats: 3 })
      expect(intent(p, 'alpha', 'a3', 'tue')).toEqual({ type: 'remove', seats: 2 })
    })

    it('takes them away from a room too: they should never have been there', () => {
      const p = plan([team('alpha', 4, ['tue'], { room: 2 })])
      expect(intent(p, 'alpha', 'room', 'tue')).toEqual({ type: 'remove', seats: 2 })
    })

    it('takes them away when the team has all its seats, has too many, or the area is overbooked', () => {
      const complete = plan([team('alpha', 4, ['tue'], { a1: 4 })])
      expect(intent(complete, 'alpha', 'a1', 'tue')).toEqual({ type: 'remove', seats: 4 })
      const tooMany = plan([team('alpha', 2, ['tue'], { a1: 4 })])
      expect(intent(tooMany, 'alpha', 'a1', 'tue')).toEqual({ type: 'remove', seats: 4 })
      const overbooked = plan([team('alpha', 2, ['tue'], { a3: 2 }), team('beta', 2, ['tue'], { a3: 2 })])
      expect(intent(overbooked, 'alpha', 'a3', 'tue')).toEqual({ type: 'remove', seats: 2 })
    })
  })

  describe('in a room', () => {
    it('is blocked for a team that holds nothing there', () => {
      const p = plan([team('alpha', 4, ['tue'])])
      expect(intent(p, 'alpha', 'room', 'tue')).toEqual(blocked('no-seating'))
      expect(intent(p, 'alpha', 'room', 'tue', 'day')).toEqual(blocked('no-seating'))
    })

    it('says so even when the team already has all its seats', () => {
      const p = plan([team('alpha', 4, ['tue'], { a1: 4 })])
      expect(intent(p, 'alpha', 'room', 'tue')).toEqual(blocked('no-seating'))
    })
  })

  describe('for a team that has all the seats it needs', () => {
    it('is blocked: seats have to be taken away first', () => {
      const p = plan([team('alpha', 4, ['tue'], { a1: 4 })])
      expect(intent(p, 'alpha', 'a2', 'tue')).toEqual(blocked('complete'))
      expect(intent(p, 'alpha', 'bench', 'tue')).toEqual(blocked('complete'))
    })

    it('is blocked for a team with more seats than it needs', () => {
      const p = plan([team('alpha', 2, ['tue'], { a1: 4 })])
      expect(intent(p, 'alpha', 'a2', 'tue')).toEqual(blocked('complete'))
    })

    it('is blocked for a team without people', () => {
      const p = plan([team('alpha', 0, ['tue'])])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual(blocked('complete'))
    })

    it('counts the seats needed with the attendance', () => {
      const p = plan([team('alpha', 8, ['tue'], { a1: 4 })], { attendance: 0.5 })
      expect(intent(p, 'alpha', 'a2', 'tue')).toEqual(blocked('complete'))
    })

    it('does not count seats in a room towards the seats the team has', () => {
      const p = plan([team('alpha', 4, ['tue'], { room: 4 })])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual({ type: 'add', seats: 4 })
    })
  })

  describe('in an area without a free seat', () => {
    it('is blocked when others hold every seat', () => {
      const p = plan([team('alpha', 4, ['tue']), team('beta', 4, ['tue'], { a1: 4 })])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual(blocked('full'))
    })

    it('is blocked when the area is overbooked already', () => {
      const p = plan([team('alpha', 4, ['tue']), team('beta', 2, ['tue'], { a3: 2 }), team('gamma', 2, ['tue'], { a3: 2 })])
      expect(intent(p, 'alpha', 'a3', 'tue')).toEqual(blocked('full'))
    })

    it('is blocked in an area that has no seats at all', () => {
      const p = project([floor('1', [area('empty', 0)])], [team('alpha', 4, ['tue'])])
      expect(intent(p, 'alpha', 'empty', 'tue')).toEqual(blocked('full'))
    })
  })

  describe('in an area with free seats', () => {
    it('gives what the team still misses when the area has more', () => {
      const p = plan([team('alpha', 3, ['tue'])])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual({ type: 'add', seats: 3 })
    })

    it('gives what is free when the team misses more', () => {
      const p = plan([team('alpha', 9, ['tue'])])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual({ type: 'add', seats: 4 })
      expect(intent(p, 'alpha', 'a3', 'tue')).toEqual({ type: 'add', seats: 2 })
    })

    it('gives only the seats others left free', () => {
      const p = plan([team('alpha', 4, ['tue']), team('beta', 3, ['tue'], { a1: 3 })])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual({ type: 'add', seats: 1 })
    })

    it('counts what the team already holds elsewhere', () => {
      const p = plan([team('alpha', 6, ['tue'], { a1: 4 })])
      expect(intent(p, 'alpha', 'a2', 'tue')).toEqual({ type: 'add', seats: 2 })
    })

    it('needs fewer seats with a lower attendance, of the project or of the team', () => {
      const half = plan([team('alpha', 6, ['tue'])], { attendance: 0.5 })
      expect(intent(half, 'alpha', 'a1', 'tue')).toEqual({ type: 'add', seats: 3 })
      const own = plan([team('alpha', 6, ['tue'], {}, { attendance: 0.5 })])
      expect(intent(own, 'alpha', 'a1', 'tue')).toEqual({ type: 'add', seats: 3 })
    })

    it('offers overflow seats like desks', () => {
      const p = plan([team('alpha', 5, ['tue'], { a1: 4 })])
      expect(intent(p, 'alpha', 'bench', 'tue')).toEqual({ type: 'add', seats: 1 })
      expect(intent(plan([team('alpha', 9, ['tue'])]), 'alpha', 'bench', 'tue')).toEqual({ type: 'add', seats: 3 })
    })

    it('does not mind who sits there on days the team is not in', () => {
      const p = plan([team('alpha', 4, ['tue']), team('beta', 4, ['mon', 'wed'], { a1: 4 })])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual({ type: 'add', seats: 4 })
    })
  })

  describe('for a team with several team days', () => {
    it('cannot take seats that are free on Tuesday but taken on Thursday', () => {
      const p = plan([team('alpha', 4, ['tue', 'thu']), team('beta', 4, ['thu'], { a1: 4 })])
      expect(freeOnDays(p, 'a1', ['tue'])).toBe(4)
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual(blocked('full'))
      expect(intent(p, 'alpha', 'a1', 'thu')).toEqual(blocked('full'))
    })

    it('gets the seats that are free on all its days', () => {
      // Of the 4 desks in A1, Beta holds 1 on Tuesday and Gamma 3 on Thursday.
      const p = plan([
        team('alpha', 8, ['tue', 'thu']),
        team('beta', 1, ['tue'], { a1: 1 }),
        team('gamma', 3, ['thu'], { a1: 3 }),
      ])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual({ type: 'add', seats: 1 })
      expect(intent(p, 'alpha', 'a1', 'thu')).toEqual({ type: 'add', seats: 1 })
    })

    it('can take the seats for the day shown only, when that is what the planner asks', () => {
      const p = plan([team('alpha', 4, ['tue', 'thu']), team('beta', 4, ['thu'], { a1: 4 })])
      expect(intent(p, 'alpha', 'a1', 'tue', 'day')).toEqual({ type: 'add', seats: 4 })
      expect(intent(p, 'alpha', 'a1', 'thu', 'day')).toEqual(blocked('full'))
    })

    it('finds an area free on a day on which the team that normally sits there is elsewhere', () => {
      // Beta has A1, but on Tuesday it sits in A2.
      const p = plan([team('alpha', 4, ['tue']), team('beta', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { tue: { a2: 4 } } })])
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual({ type: 'add', seats: 4 })
      expect(intent(p, 'alpha', 'a2', 'tue')).toEqual(blocked('full'))
    })
  })

  describe('for a team that sits differently on one day', () => {
    // Alpha (6 people) has A1 and A3, but on Thursday only 3 seats in A2 so far.
    const alpha = team('alpha', 6, ['tue', 'thu'], { a1: 4, a3: 2 }, { daySeating: { thu: { a2: 3 } } })

    it('works on the seating of the day shown', () => {
      const p = plan([alpha])
      // Tuesday shows the normal seating: complete, and A1 is held.
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual({ type: 'remove', seats: 4 })
      expect(intent(p, 'alpha', 'a2', 'tue')).toEqual(blocked('complete'))
      // Thursday shows the exception: 3 seats missing, A2 is held, A1 is not.
      expect(intent(p, 'alpha', 'a2', 'thu')).toEqual({ type: 'remove', seats: 3 })
      expect(intent(p, 'alpha', 'a1', 'thu')).toEqual({ type: 'add', seats: 3 })
      expect(intent(p, 'alpha', 'bench', 'thu')).toEqual({ type: 'add', seats: 3 })
    })

    it('does not let the other day stand in the way of an edit of the normal seating', () => {
      // Beta fills the bench on Thursday. Alpha's normal seating is not used on Thursday, so
      // on Tuesday the bench is free for it.
      const short = team('alpha', 8, ['tue', 'thu'], { a1: 4, a3: 2 }, { daySeating: { thu: { a2: 3 } } })
      const p = plan([short, team('beta', 3, ['thu'], { bench: 3 })])
      expect(intent(p, 'alpha', 'bench', 'tue')).toEqual({ type: 'add', seats: 2 })
      expect(intent(p, 'alpha', 'bench', 'thu')).toEqual(blocked('full'))
    })

    it('looks only at that day when the day with the exception is shown', () => {
      // Beta fills A1 on Tuesday; on Thursday, the day being edited, it is free.
      const p = plan([
        team('alpha', 6, ['tue', 'thu'], { a3: 2 }, { daySeating: { thu: { a2: 3 } } }),
        team('beta', 4, ['tue'], { a1: 4 }),
      ])
      expect(intent(p, 'alpha', 'a1', 'thu')).toEqual({ type: 'add', seats: 3 })
      expect(intent(p, 'alpha', 'a1', 'tue')).toEqual(blocked('full'))
    })
  })
})

describe('placeAction', () => {
  it('gives the seats of the preview, on every team day', () => {
    const p = plan([team('alpha', 3, ['tue', 'thu'])])
    expect(placeAction(p, teamOf(p, 'alpha'), areaOf(p, 'a1'), 'tue', 'all')).toEqual({
      type: 'seat/set',
      teamId: 'alpha',
      areaId: 'a1',
      seats: 3,
      scope: 'all',
    })
  })

  it('takes seats away by setting them to 0', () => {
    const p = plan([team('alpha', 3, ['tue', 'thu'], { a1: 3 })])
    expect(placeAction(p, teamOf(p, 'alpha'), areaOf(p, 'a1'), 'tue', 'all')).toEqual({
      type: 'seat/set',
      teamId: 'alpha',
      areaId: 'a1',
      seats: 0,
      scope: 'all',
    })
  })

  it('edits the day shown when the planner asks for that day only', () => {
    const p = plan([team('alpha', 3, ['tue', 'thu'])])
    expect(placeAction(p, teamOf(p, 'alpha'), areaOf(p, 'a1'), 'thu', 'day')).toMatchObject({ seats: 3, scope: 'thu' })
  })

  it('edits the day shown when the team sits differently on it, whatever the planner asks', () => {
    const p = plan([team('alpha', 3, ['tue', 'thu'], { a1: 3 }, { daySeating: { thu: {} } })])
    expect(placeAction(p, teamOf(p, 'alpha'), areaOf(p, 'a2'), 'thu', 'all')).toMatchObject({ seats: 3, scope: 'thu' })
    expect(placeAction(p, teamOf(p, 'alpha'), areaOf(p, 'a1'), 'tue', 'all')).toMatchObject({ seats: 0, scope: 'all' })
  })

  it('is null for every click that is blocked', () => {
    const p = plan([team('alpha', 4, ['tue'], { a1: 4 }), team('beta', 4, ['tue'], { a2: 4 }), team('gamma', 2, ['tue'])])
    const blockedClicks: [string, string, Weekday][] = [
      ['alpha', 'a1', 'mon'], // not in
      ['gamma', 'room', 'tue'], // a room
      ['alpha', 'a3', 'tue'], // complete
      ['gamma', 'a2', 'tue'], // full
    ]
    for (const [teamId, areaId, day] of blockedClicks) {
      expect(intent(p, teamId, areaId, day).type).toBe('blocked')
      expect(placeAction(p, teamOf(p, teamId), areaOf(p, areaId), day, 'all')).toBeNull()
    }
  })

  it('seats a team click by click until it is complete, and no further', () => {
    let p = plan([team('alpha', 9, ['tue', 'thu'])])
    p = click(p, 'alpha', 'a1', 'tue')
    expect(teamOf(p, 'alpha').seating).toEqual({ a1: 4 })
    p = click(p, 'alpha', 'a2', 'tue')
    expect(teamOf(p, 'alpha').seating).toEqual({ a1: 4, a2: 4 })
    p = click(p, 'alpha', 'a3', 'thu')
    expect(teamOf(p, 'alpha').seating).toEqual({ a1: 4, a2: 4, a3: 1 })
    expect(teamDayStatus(p, teamOf(p, 'alpha'), 'tue').state).toBe('seated')
    expect(teamDayStatus(p, teamOf(p, 'alpha'), 'thu').state).toBe('seated')
    expect(click(p, 'alpha', 'bench', 'tue')).toBe(p)
    // A click on an area the team holds takes it away again.
    p = click(p, 'alpha', 'a2', 'thu')
    expect(teamOf(p, 'alpha').seating).toEqual({ a1: 4, a3: 1 })
    expect(teamOf(p, 'alpha').daySeating).toEqual({})
  })

  it('makes an exception for the day shown when asked, and leaves the other days alone', () => {
    let p = plan([team('alpha', 4, ['tue', 'thu'], { a1: 4 })])
    p = click(p, 'alpha', 'a1', 'thu', 'day')
    expect(teamOf(p, 'alpha').seating).toEqual({ a1: 4 })
    expect(teamOf(p, 'alpha').daySeating).toEqual({ thu: {} })
    p = click(p, 'alpha', 'a2', 'thu', 'day')
    expect(teamOf(p, 'alpha').daySeating).toEqual({ thu: { a2: 4 } })
    expect(seatingOn(teamOf(p, 'alpha'), 'tue')).toEqual({ a1: 4 })
  })

  it('does not overbook Thursday when the click happens on Tuesday', () => {
    // Beta holds 3 of the 4 desks in A1 on Thursday only.
    let p = plan([team('alpha', 4, ['tue', 'thu']), team('beta', 3, ['thu'], { a1: 3 })])
    p = click(p, 'alpha', 'a1', 'tue')
    expect(teamOf(p, 'alpha').seating).toEqual({ a1: 1 })
    for (const day of WEEKDAYS) expect(dayOccupancy(p, day).get('a1')?.free).toBeGreaterThanOrEqual(0)
  })
})

describe('placing by clicks alone', () => {
  it('never overbooks an area, never seats a team in a room and never gives a team too many seats', () => {
    const random = seededRandom(1127)
    const pick = <T>(items: readonly T[]): T => {
      const item = items[Math.floor(random() * items.length)]
      if (item === undefined) throw new Error('nothing to pick from')
      return item
    }

    let p = project(
      [
        floor('1', [
          area('a1', 4),
          area('a2', 4),
          area('a3', 2),
          area('bench', 3, { kind: 'overflow' }),
          area('room', 6, { kind: 'no-seating' }),
          area('empty', 0),
        ]),
        floor('2', [area('b1', 6), area('b2', 4)]),
      ],
      [
        team('alpha', 8, ['tue', 'thu']),
        team('beta', 5, ['mon', 'tue']),
        team('gamma', 3, ['wed', 'thu', 'fri']),
        team('delta', 12, ['tue'], {}, { attendance: 0.5 }),
        team('epsilon', 6, WEEKDAYS),
        team('nobody', 0, ['tue']),
        team('homeless', 4),
      ],
    )
    const areas = [...indexAreas(p).values()].map((ref) => ref.area)
    const seen = new Set<string>()

    for (let step = 0; step < 4000; step += 1) {
      const clicking = pick(p.teams)
      const target = pick(areas)
      const day = pick(WEEKDAYS)
      const scope = random() < 0.5 ? 'all' : 'day'
      const where = `step ${step}: ${clicking.id} clicks ${target.id} on ${day} (${scope})`

      const preview = placeIntent(p, clicking, target, day, scope)
      const action = placeAction(p, clicking, target, day, scope)
      seen.add(preview.type === 'blocked' ? preview.reason : preview.type)
      if (preview.type === 'blocked') {
        expect(action, where).toBeNull()
        continue
      }
      if (action === null) throw new Error(`${where}: a click that is not blocked needs an action`)

      const next = reduce(p, action)
      // The click does what the preview said, on the day the planner is looking at.
      expect(next, where).not.toBe(p)
      expect(seatingOn(teamOf(next, clicking.id), day)[target.id] ?? 0, where).toBe(preview.type === 'add' ? preview.seats : 0)
      p = next

      for (const weekday of WEEKDAYS) {
        for (const occupancy of dayOccupancy(p, weekday).values()) {
          expect(occupancy.free, `${where}: ${occupancy.area.id} on ${weekday}`).toBeGreaterThanOrEqual(0)
          if (occupancy.area.kind === 'no-seating') expect(occupancy.used, where).toBe(0)
        }
        for (const t of p.teams) expect(teamDayStatus(p, t, weekday).state, `${where}: ${t.id} on ${weekday}`).not.toBe('over')
      }
      expect(violations(p), where).toEqual([])
    }

    // The walk has been through every kind of click.
    expect([...seen].sort()).toEqual(['add', 'complete', 'full', 'no-seating', 'not-in', 'remove'])
  })
})

describe('blockedMessage', () => {
  const alpha = team('alpha', 4, ['tue'], {}, { name: 'Claims Alpha' })
  const meetingRoom = area('room', 6, { kind: 'no-seating', name: 'Meeting room 4.7' })
  const reasons = ['no-seating', 'full', 'not-in', 'complete'] as const

  it('gives a different sentence for every reason', () => {
    const messages = reasons.map((reason) => blockedMessage(alpha, meetingRoom, reason))
    expect(new Set(messages).size).toBe(reasons.length)
    for (const message of messages) expect(message).toMatch(/^\S.*\.$/)
  })

  it('names the area or the team it is about', () => {
    expect(blockedMessage(alpha, meetingRoom, 'no-seating')).toContain('Meeting room 4.7')
    expect(blockedMessage(alpha, meetingRoom, 'full')).toContain('Meeting room 4.7')
    expect(blockedMessage(alpha, meetingRoom, 'full')).toContain('Claims Alpha')
    expect(blockedMessage(alpha, meetingRoom, 'not-in')).toContain('Claims Alpha')
    expect(blockedMessage(alpha, meetingRoom, 'complete')).toContain('Claims Alpha')
  })
})

describe('heldSeats and areasOf', () => {
  it('counts every seat of a seating, also those in rooms and in areas that are gone', () => {
    expect(heldSeats({})).toBe(0)
    expect(heldSeats({ a1: 4, room: 2, ghost: 1 })).toBe(7)
  })

  it('lists the areas of a seating in the order of the given areas', () => {
    const areas = office()[0]?.areas ?? []
    expect(areasOf({ bench: 1, a3: 2, a1: 4 }, areas)).toEqual(['a1', 'a3', 'bench'])
    expect(areasOf({ ghost: 2 }, areas)).toEqual([])
    expect(areasOf({}, areas)).toEqual([])
  })
})
