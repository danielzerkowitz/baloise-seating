import { describe, expect, it } from 'vitest'
import { suggestDayMoves, type DayMove } from './dayMoves'
import { dayLoad } from './model'
import { floor, project, row, team } from './testkit'
import { WEEKDAYS, type DayWish, type Project, type Seating, type Settings, type Team, type Weekday } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** One floor with five areas of four desks: 20 desks in the building. */
function office(teams: Team[], settings: Partial<Settings> = {}): Project {
  return project([floor('4', row(['a', 'b', 'c', 'd', 'e'], 4))], teams, settings)
}

/** A team with wishes that differ from "wants its team days, was not asked about the rest". */
function wishing(
  id: string,
  size: number,
  days: readonly Weekday[],
  wishes: Partial<Record<Weekday, DayWish>>,
  seating: Seating = {},
): Team {
  const base = team(id, size, days, seating)
  return { ...base, wishes: { ...base.wishes, ...wishes } }
}

const NOWHERE_ELSE: Partial<Record<Weekday, DayWish>> = { mon: 'cannot', wed: 'cannot', thu: 'cannot', fri: 'cannot' }

/** "team>day" for every move, in order. */
function summary(moves: readonly DayMove[]): string[] {
  return moves.map((m) => `${m.teamId}>${m.to}`)
}

function moveOf(moves: readonly DayMove[], teamId: string): DayMove {
  const found = moves.find((m) => m.teamId === teamId)
  if (!found) throw new Error(`no move for ${teamId}`)
  return found
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

// ---------------------------------------------------------------------------
// When there is something to suggest
// ---------------------------------------------------------------------------

describe('suggestDayMoves: when a day needs relief', () => {
  it('suggests nothing for a day that fits', () => {
    const p = office([team('alpha', 12, ['tue']), team('beta', 8, ['tue'])])
    expect(dayLoad(p, 'tue').needed).toBe(20)
    expect(suggestDayMoves(p, 'tue')).toEqual([])
    expect(suggestDayMoves(p, 'mon')).toEqual([])
  })

  it('suggests moves as soon as the day is one seat over', () => {
    const p = office([team('alpha', 12, ['tue']), team('beta', 9, ['tue'])])
    expect(suggestDayMoves(p, 'tue').length).toBeGreaterThan(0)
  })

  it('measures the day against the desks that may be planned, not against all desks', () => {
    // 20 desks with a quarter kept free: 15 may be planned.
    const teams = [team('alpha', 10, ['tue']), team('beta', 6, ['tue'])]
    expect(suggestDayMoves(office(teams), 'tue')).toEqual([])
    const moves = suggestDayMoves(office(teams, { reserve: 0.25 }), 'tue')
    expect(summary(moves)).toEqual(['beta>mon', 'alpha>mon'])
    // One seat over: either team brings the day back within its desks.
    expect(moves.map((m) => m.resolves)).toEqual([true, true])
    // The desks that are free on Monday are counted without the reserve too.
    expect(moveOf(moves, 'beta').reason).toBe('Monday has 15 desks free; Beta was not asked about Monday yet')
  })

  it('counts a move that brings the day down to exactly its desks as solving it', () => {
    // 22 seats on 20 desks: two over.
    const p = office([team('two', 2, ['tue']), team('one', 1, ['tue']), team('rest', 19, ['tue'])])
    const moves = suggestDayMoves(p, 'tue', 10)
    expect(moveOf(moves, 'two')).toMatchObject({ resolves: true, fromAfter: 20 })
    expect(moveOf(moves, 'one')).toMatchObject({ resolves: false, fromAfter: 21 })
    expect(moveOf(moves, 'rest')).toMatchObject({ resolves: true, fromAfter: 3 })
    expect(moves.map((m) => m.teamId)).toEqual(['two', 'rest', 'one'])
  })

  it('describes a move completely', () => {
    const p = office([team('alpha', 12, ['tue']), team('beta', 10, ['tue', 'thu']), team('gamma', 3, ['mon'])])
    expect(suggestDayMoves(p, 'tue')).toEqual([
      {
        teamId: 'beta',
        from: 'tue',
        to: 'wed',
        seats: 10,
        fromAfter: 12,
        toAfter: 10,
        agreed: false,
        resolves: true,
        reason: 'Wednesday has 20 desks free; Beta was not asked about Wednesday yet',
      },
      {
        teamId: 'alpha',
        from: 'tue',
        to: 'wed',
        seats: 12,
        fromAfter: 10,
        toAfter: 12,
        agreed: false,
        resolves: true,
        reason: 'Wednesday has 20 desks free; Alpha was not asked about Wednesday yet',
      },
    ])
  })

  it('counts the seats a team needs, not its people', () => {
    const half = { ...team('alpha', 12, ['tue']), attendance: 0.5 }
    const p = office([half, team('beta', 16, ['tue']), team('gamma', 3, ['wed'])])
    const move = moveOf(suggestDayMoves(p, 'tue'), 'alpha')
    expect(move).toMatchObject({ seats: 6, fromAfter: 16, toAfter: 6, resolves: true })
  })

  it('says what the team said about the day', () => {
    const p = (wish: DayWish) =>
      office([
        wishing('alpha', 12, ['tue'], { ...NOWHERE_ELSE, wed: wish }),
        wishing('beta', 12, ['tue'], NOWHERE_ELSE),
        team('gamma', 5, ['wed']),
      ])
    expect(suggestDayMoves(p('want'), 'tue')).toMatchObject([
      { agreed: true, reason: 'Wednesday has 15 desks free and Alpha wants to come then' },
    ])
    expect(suggestDayMoves(p('can'), 'tue')).toMatchObject([
      { agreed: true, reason: 'Wednesday has 15 desks free and Alpha said it could come then' },
    ])
    expect(suggestDayMoves(p('none'), 'tue')).toMatchObject([
      { agreed: false, reason: 'Wednesday has 15 desks free; Alpha was not asked about Wednesday yet' },
    ])
    expect(suggestDayMoves(p('cannot'), 'tue')).toEqual([])
  })

  it('writes one desk in the singular', () => {
    const teams = (onWednesday: number) => [
      wishing('alpha', 1, ['tue'], { ...NOWHERE_ELSE, wed: 'can' }),
      wishing('beta', 20, ['tue'], NOWHERE_ELSE),
      team('gamma', onWednesday, ['wed']),
    ]
    expect(moveOf(suggestDayMoves(office(teams(19)), 'tue'), 'alpha').reason).toBe(
      'Wednesday has 1 desk free and Alpha said it could come then',
    )
    // With 2 of the 20 desks kept free, 18 may be planned: the 19th seat comes out of the reserve.
    expect(moveOf(suggestDayMoves(office(teams(18), { reserve: 0.1 }), 'tue'), 'alpha').reason).toBe(
      'Wednesday has room only by using 1 desk of the reserve and Alpha said it could come then',
    )
  })

  it('has a word for a team without a name', () => {
    const p = office([{ ...team('new', 12, ['tue']), name: '  ' }, wishing('beta', 12, ['tue'], NOWHERE_ELSE)])
    expect(moveOf(suggestDayMoves(p, 'tue'), 'new').reason).toBe(
      'Monday has 20 desks free; this team was not asked about Monday yet',
    )
  })

  it('leaves the project alone and gives the same answer every time', () => {
    const p = office([team('alpha', 12, ['tue'], { a: 4, b: 4, c: 4 }), wishing('beta', 10, ['tue'], { fri: 'can' })])
    const before = structuredClone(p)
    const first = suggestDayMoves(deepFreeze(p), 'tue')
    expect(p).toStrictEqual(before)
    expect(suggestDayMoves(structuredClone(before), 'tue')).toStrictEqual(first)
  })
})

// ---------------------------------------------------------------------------
// What is never suggested
// ---------------------------------------------------------------------------

describe('suggestDayMoves: what is never suggested', () => {
  it('never moves a team to a day it cannot come on', () => {
    const p = office([
      wishing('alpha', 12, ['tue'], { mon: 'cannot', wed: 'cannot', thu: 'cannot' }),
      wishing('beta', 10, ['tue'], NOWHERE_ELSE),
    ])
    expect(summary(suggestDayMoves(p, 'tue', 10))).toEqual(['alpha>fri'])
  })

  it('never moves a team to a day it already comes on, or a team that is not in', () => {
    // Wednesday is the only day Alpha has not ruled out, and it comes in on that day already.
    const p = office([
      wishing('alpha', 12, ['tue', 'wed'], { mon: 'cannot', thu: 'cannot', fri: 'cannot' }),
      team('beta', 9, ['tue']),
      team('gamma', 2, ['wed']),
    ])
    expect(summary(suggestDayMoves(p, 'tue', 10))).toEqual(['beta>mon'])
  })

  it('skips a team that needs no seats', () => {
    const p = office([team('nobody', 0, ['tue']), team('alpha', 12, ['tue']), team('beta', 10, ['tue'])])
    expect(suggestDayMoves(p, 'tue', 10).map((m) => m.teamId)).toEqual(['beta', 'alpha'])
  })

  it('drops a target day that would then need more seats than the building has desks', () => {
    const fillers = WEEKDAYS.filter((d) => d !== 'tue').map((d) => team(`filler-${d}`, 15, [d]))
    const p = office([team('alpha', 6, ['tue']), team('beta', 16, ['tue']), ...fillers])
    // 15 + 6 and 15 + 16 are both more than 20 desks, on every other day.
    expect(suggestDayMoves(p, 'tue', 10)).toEqual([])
  })

  it('keeps a target day that the move fills exactly', () => {
    const fillers = WEEKDAYS.filter((d) => d !== 'tue').map((d) => team(`filler-${d}`, 14, [d]))
    const p = office([team('alpha', 6, ['tue']), team('beta', 16, ['tue']), ...fillers])
    const moves = suggestDayMoves(p, 'tue', 10)
    expect(summary(moves)).toEqual(['alpha>mon'])
    expect(moveOf(moves, 'alpha')).toMatchObject({
      toAfter: 20,
      reason: 'Monday has 6 desks free; Alpha was not asked about Monday yet',
    })
  })

  it('counts the reserve as room, but says so', () => {
    // 15 of the 20 desks may be planned. Wednesday needs 12 already.
    const p = office(
      [
        wishing('alpha', 5, ['tue'], { ...NOWHERE_ELSE, wed: 'can' }),
        wishing('beta', 12, ['tue'], NOWHERE_ELSE),
        team('gamma', 12, ['wed']),
      ],
      { reserve: 0.25 },
    )
    expect(suggestDayMoves(p, 'tue')).toEqual([
      {
        teamId: 'alpha',
        from: 'tue',
        to: 'wed',
        seats: 5,
        fromAfter: 12,
        toAfter: 17,
        agreed: true,
        resolves: true,
        reason: 'Wednesday has room only by using 2 desks of the reserve and Alpha said it could come then',
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------

describe('suggestDayMoves: the order of the suggestions', () => {
  it('1. puts a day that stays within the plannable desks before one that uses the reserve', () => {
    // Alpha said it could come on Wednesday, but that day would go into the reserve.
    const p = office(
      [wishing('alpha', 5, ['tue'], { wed: 'can' }), team('beta', 12, ['tue']), team('gamma', 12, ['wed'])],
      { reserve: 0.25 },
    )
    const move = moveOf(suggestDayMoves(p, 'tue'), 'alpha')
    expect(move).toMatchObject({ to: 'mon', agreed: false, toAfter: 5 })
  })

  it('2. puts a day the team agreed to before a day it was not asked about', () => {
    // Beta is the smaller team and would otherwise come first.
    const p = office([wishing('alpha', 12, ['tue'], { fri: 'can' }), team('beta', 10, ['tue'])])
    expect(summary(suggestDayMoves(p, 'tue'))).toEqual(['alpha>fri', 'beta>mon'])
  })

  it('2. puts a day the team wants before a day it could do', () => {
    const p = office([wishing('alpha', 12, ['tue'], { wed: 'can', fri: 'want' }), team('beta', 10, ['tue'])])
    expect(moveOf(suggestDayMoves(p, 'tue'), 'alpha').to).toBe('fri')
    const wanting = office([
      wishing('alpha', 12, ['tue'], { wed: 'can' }),
      wishing('beta', 14, ['tue'], { thu: 'want' }),
    ])
    expect(summary(suggestDayMoves(wanting, 'tue'))).toEqual(['beta>thu', 'alpha>wed'])
  })

  it('3. puts a move that solves the day on its own before one that does not', () => {
    // 25 seats on 20 desks: five over. Alpha (3) does not solve that, the others do.
    const p = office([team('alpha', 3, ['tue']), team('beta', 6, ['tue']), team('gamma', 16, ['tue'])])
    const moves = suggestDayMoves(p, 'tue')
    expect(moves.map((m) => [m.teamId, m.resolves])).toEqual([
      ['beta', true],
      ['gamma', true],
      ['alpha', false],
    ])
  })

  it('4. puts the smaller team first among moves that solve the day, the larger one among those that do not', () => {
    // 30 seats on 20 desks: ten over. Only the team of 12 solves it alone.
    const sizes: [string, number][] = [['three', 3], ['six', 6], ['twelve', 12], ['nine', 9]]
    const p = office(sizes.map(([id, size]) => team(id, size, ['tue'])))
    expect(suggestDayMoves(p, 'tue', 10).map((m) => m.teamId)).toEqual(['twelve', 'nine', 'six', 'three'])

    // Two over: every team solves it, the smallest goes first.
    const easy = office([team('nine', 9, ['tue']), team('six', 6, ['tue']), team('seven', 7, ['tue'])])
    expect(suggestDayMoves(easy, 'tue', 10).map((m) => m.teamId)).toEqual(['six', 'seven', 'nine'])
  })

  it('5. puts a day on which the team can keep its seats before a day on which it cannot', () => {
    // Wednesday is the emptier day, but someone else sits in Alpha's area then.
    const p = office([
      wishing('alpha', 4, ['tue'], { mon: 'cannot', fri: 'cannot' }, { a: 4 }),
      wishing('beta', 18, ['tue'], NOWHERE_ELSE),
      team('wednesday', 2, ['wed'], { a: 2 }),
      team('thursday', 4, ['thu'], { b: 4 }),
    ])
    expect(moveOf(suggestDayMoves(p, 'tue'), 'alpha')).toMatchObject({ to: 'thu', toAfter: 8 })

    // When the other team sits elsewhere, the emptier Wednesday wins again.
    const free = office([
      wishing('alpha', 4, ['tue'], { mon: 'cannot', fri: 'cannot' }, { a: 4 }),
      wishing('beta', 18, ['tue'], NOWHERE_ELSE),
      team('wednesday', 2, ['wed'], { c: 2 }),
      team('thursday', 4, ['thu'], { b: 4 }),
    ])
    expect(moveOf(suggestDayMoves(free, 'tue'), 'alpha')).toMatchObject({ to: 'wed', toAfter: 6 })
  })

  it('5. treats a team without seats as a team that keeps them', () => {
    // On every other day one seat in area A is taken, so the seated team cannot keep its
    // seats anywhere. The unseated team has none to lose and comes first.
    const p = office([
      team('seated', 11, ['tue'], { a: 4, b: 4, c: 3 }),
      team('unseated', 11, ['tue']),
      team('visitor', 1, ['mon', 'wed', 'thu', 'fri'], { a: 1 }),
    ])
    expect(summary(suggestDayMoves(p, 'tue'))).toEqual(['unseated>mon', 'seated>mon'])
  })

  it('6. puts the emptier target day first', () => {
    const p = office([
      wishing('alpha', 4, ['tue'], { mon: 'cannot', fri: 'cannot' }),
      wishing('beta', 18, ['tue'], NOWHERE_ELSE),
      team('wednesday', 6, ['wed']),
      team('thursday', 2, ['thu']),
    ])
    expect(moveOf(suggestDayMoves(p, 'tue'), 'alpha')).toMatchObject({ to: 'thu', toAfter: 6 })
  })

  it('7. falls back on team-list order and then on week order', () => {
    const p = office([team('first', 11, ['tue']), team('second', 11, ['tue'])])
    expect(summary(suggestDayMoves(p, 'tue'))).toEqual(['first>mon', 'second>mon'])
    const midweek = office([team('first', 11, ['wed']), team('second', 11, ['wed'])])
    expect(summary(suggestDayMoves(midweek, 'wed'))).toEqual(['first>mon', 'second>mon'])
    const monday = office([team('first', 11, ['mon']), team('second', 11, ['mon'])])
    expect(summary(suggestDayMoves(monday, 'mon'))).toEqual(['first>tue', 'second>tue'])
  })
})

// ---------------------------------------------------------------------------
// How many
// ---------------------------------------------------------------------------

describe('suggestDayMoves: how many suggestions', () => {
  const crowded = () => office(['a', 'b', 'c', 'd', 'e'].map((id) => team(id, 5, ['tue'])))

  it('suggests one move per team: its best', () => {
    const moves = suggestDayMoves(crowded(), 'tue', 10)
    expect(moves.map((m) => m.teamId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(new Set(moves.map((m) => m.to))).toEqual(new Set(['mon']))
  })

  it('suggests three moves unless told otherwise', () => {
    expect(suggestDayMoves(crowded(), 'tue').map((m) => m.teamId)).toEqual(['a', 'b', 'c'])
  })

  it('respects the limit', () => {
    expect(suggestDayMoves(crowded(), 'tue', 1).map((m) => m.teamId)).toEqual(['a'])
    expect(suggestDayMoves(crowded(), 'tue', 4).map((m) => m.teamId)).toEqual(['a', 'b', 'c', 'd'])
    expect(suggestDayMoves(crowded(), 'tue', 0)).toEqual([])
  })
})
