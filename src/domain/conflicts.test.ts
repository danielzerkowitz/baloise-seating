/* Tests for conflict recognition. How to read this file: one `describe` per rule or small
   family of rules, each with a case where the rule fires, checked in full, next to the
   cases where it must stay silent. After that the order and the form of the whole result,
   random plans checked against the data model, the helpers around accepting issues, and
   last a plan on the real floor. */

import { describe, expect, it } from 'vitest'
import {
  RULE_SEVERITY,
  SEVERITY_ORDER,
  findIssues,
  isAccepted,
  summarizeIssues,
  worstSeverity,
  type Issue,
  type IssueRule,
  type Severity,
} from './conflicts'
import { FLOOR4_AREAS, FLOOR4_PLAN_SIZE } from './floor4'
import { seatsNeeded } from './model'
import { area, floor, project, team, violations } from './testkit'
import {
  WEEKDAYS,
  type Area,
  type AreaKind,
  type DayWish,
  type Floor,
  type Project,
  type Seating,
  type Team,
  type Weekday,
} from './types'

// ---------------------------------------------------------------------------
// A small building and helpers to test with
// ---------------------------------------------------------------------------

/** Desk clusters side by side with ids ne1, ne2, ... and names "NE 1", "NE 2", ... Each is
 *  0.2 of the plan height wide and high (a plan without a drawing is twice as wide as it is
 *  high) with a narrow aisle to the next: clusters next to each other are neighbours on the
 *  plan, clusters with one in between are not. */
function deskRow(prefix: string, count: number, capacity: number, y = 0.1): Area[] {
  return Array.from({ length: count }, (_, i) =>
    area(`${prefix}${i + 1}`, capacity, {
      name: `${prefix.toUpperCase()} ${i + 1}`,
      rect: { x: 0.05 + i * 0.11, y, w: 0.1, h: 0.2 },
    }),
  )
}

/** Floor 4: desk clusters NE 1 to NE 4 with 4 desks each, a touchdown bench with 3 overflow
 *  seats that runs along the whole row (so it is next to every cluster) and a meeting room
 *  with 8 chairs. 16 desks, 3 overflow seats. */
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

type TeamOptions = Parameters<typeof team>[4]

/** The team most examples are about. */
function claims(size: number, days: readonly Weekday[], seating: Seating = {}, options: TeamOptions = {}): Team {
  return team('claims', size, days, seating, { name: 'Claims Intake', ...options })
}

/** What a team said about the week; days that are not mentioned were not asked about. */
function wishes(said: Partial<Record<Weekday, DayWish>>): Record<Weekday, DayWish> {
  return { mon: 'none', tue: 'none', wed: 'none', thu: 'none', fri: 'none', ...said }
}

function ofRule(p: Project, ...rules: IssueRule[]): Issue[] {
  return findIssues(p).filter((issue) => rules.includes(issue.rule))
}

function ids(issues: readonly Issue[]): string[] {
  return issues.map((issue) => issue.id)
}

/** A complete issue written the short way. The id is `rule|day|floor|area|teams` with "-"
 *  for a missing part and teams joined by "+", so spelling it out also fixes the rule, day,
 *  floor, area and teams the issue must carry. */
function anIssue(id: string, severity: Severity, title: string, detail: string): Issue {
  const [rule, day, floorId, areaId, teams] = id.split('|')
  if (rule === undefined || day === undefined || floorId === undefined || areaId === undefined || teams === undefined) {
    throw new Error(`"${id}" is not an issue id`)
  }
  const orNull = (part: string) => (part === '-' ? null : part)
  return {
    id,
    rule: rule as IssueRule,
    severity,
    day: orNull(day) as Weekday | null,
    floorId: orNull(floorId),
    areaId: orNull(areaId),
    teamIds: teams === '-' ? [] : teams.split('+'),
    title,
    detail,
  }
}

// ---------------------------------------------------------------------------
// Nothing to report
// ---------------------------------------------------------------------------

describe('findIssues on a plan without problems', () => {
  it('finds nothing in an empty project', () => {
    expect(findIssues(project([]))).toEqual([])
  })

  it('finds nothing in a project without teams', () => {
    expect(findIssues(project([floor3(), floor4()]))).toEqual([])
  })

  it('finds nothing when every team has its seats, together, on its own days', () => {
    const p = project(
      [floor3(), floor4()],
      [
        claims(8, ['tue', 'thu'], { ne1: 4, ne2: 4 }),
        // Uses the same desks as Claims Intake, on other days.
        team('under', 6, ['mon', 'wed'], { ne1: 4, ne2: 2 }, { name: 'Underwriting' }),
        team('policy', 4, ['tue'], { sw1: 4 }, { name: 'Policy Admin', homeFloorId: '3' }),
      ],
    )
    expect(violations(p)).toEqual([])
    expect(findIssues(p)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

describe('area-over-capacity', () => {
  const underwriting = (seats: number, days: readonly Weekday[] = ['tue']) =>
    team('under', seats, days, { ne1: seats }, { name: 'Underwriting' })

  it('reports an area that holds more seats than it has', () => {
    const p = project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 4 }), underwriting(2)])
    expect(violations(p)).toEqual([])
    // Only on Tuesday: on Thursday Claims Intake has NE 1 to itself.
    expect(findIssues(p)).toEqual([
      {
        id: 'area-over-capacity|tue|4|ne1|claims+under',
        rule: 'area-over-capacity',
        severity: 'error',
        day: 'tue',
        floorId: '4',
        areaId: 'ne1',
        teamIds: ['claims', 'under'],
        title: 'NE 1 is over capacity on Tuesday',
        detail: '6 seats taken, 4 available. Claims Intake 4, Underwriting 2',
      },
    ])
  })

  it('accepts an area that is exactly full and reports it with one seat more', () => {
    const full = project([floor4()], [claims(2, ['tue'], { ne1: 2 }), underwriting(2)])
    expect(findIssues(full)).toEqual([])

    const oneMore = project([floor4()], [claims(2, ['tue'], { ne1: 2 }), underwriting(3)])
    expect(findIssues(oneMore)).toEqual([
      anIssue(
        'area-over-capacity|tue|4|ne1|claims+under',
        'error',
        'NE 1 is over capacity on Tuesday',
        '5 seats taken, 4 available. Claims Intake 2, Underwriting 3',
      ),
    ])
  })

  it('reports every day on which it happens', () => {
    const p = project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 4 }), underwriting(1, ['tue', 'wed', 'thu'])])
    expect(ids(findIssues(p))).toEqual([
      'area-over-capacity|tue|4|ne1|claims+under',
      'area-over-capacity|thu|4|ne1|claims+under',
    ])
  })

  it('treats an area without seats as over capacity as soon as someone sits there', () => {
    const withStore = (teams: Team[]) =>
      project([floor('4', [...deskRow('ne', 2, 4), area('store', 0, { name: 'Store' })])], teams)
    expect(findIssues(withStore([]))).toEqual([])
    expect(findIssues(withStore([claims(1, ['tue'], { store: 1 })]))).toEqual([
      anIssue(
        'area-over-capacity|tue|4|store|claims',
        'error',
        'Store is over capacity on Tuesday',
        '1 seat taken, 0 available. Claims Intake 1',
      ),
    ])
  })

  it('applies to overflow areas too', () => {
    const p = project(
      [floor4()],
      [claims(2, ['tue'], { bench: 2 }), team('under', 2, ['tue'], { bench: 2 }, { name: 'Underwriting' })],
    )
    expect(ofRule(p, 'area-over-capacity')).toEqual([
      anIssue(
        'area-over-capacity|tue|4|bench|claims+under',
        'error',
        'Touchdown bench is over capacity on Tuesday',
        '4 seats taken, 3 available. Claims Intake 2, Underwriting 2',
      ),
    ])
  })

  it('does not apply to rooms: more people than chairs is still just "seated in a room"', () => {
    const p = project([floor4()], [claims(9, ['tue'], { room: 9 })])
    expect(ofRule(p, 'area-over-capacity')).toEqual([])
    expect(ids(ofRule(p, 'seats-in-room'))).toEqual(['seats-in-room|tue|4|room|claims'])
  })
})

describe('seats-in-room', () => {
  it('reports a team that is seated in a room, and does not count those seats', () => {
    const p = project([floor4()], [team('under', 3, ['tue'], { room: 3 }, { name: 'Underwriting' })])
    expect(violations(p)).toEqual([])
    expect(findIssues(p)).toEqual([
      anIssue(
        'seats-in-room|tue|4|room|under',
        'error',
        'Underwriting is seated in Meeting room 4.1 on Tuesday',
        'Meeting room 4.1 is not for seating. 3 seats placed there',
      ),
      anIssue('team-unseated|tue|-|-|under', 'todo', 'Underwriting has no seats on Tuesday', 'Needs 3 seats'),
    ])
  })

  it('reports each team, room and day separately', () => {
    const twoRooms = floor('4', [
      ...deskRow('ne', 2, 4),
      area('room1', 8, { kind: 'no-seating', name: 'Meeting room 4.1' }),
      area('room2', 6, { kind: 'no-seating', name: 'Meeting room 4.2' }),
    ])
    const p = project(
      [twoRooms],
      [
        claims(2, ['tue', 'thu'], { room1: 1, room2: 1 }),
        team('under', 1, ['tue'], { room1: 1 }, { name: 'Underwriting' }),
      ],
    )
    const inRooms = ofRule(p, 'seats-in-room')
    expect(ids(inRooms)).toEqual([
      'seats-in-room|tue|4|room1|claims',
      'seats-in-room|tue|4|room1|under',
      'seats-in-room|tue|4|room2|claims',
      'seats-in-room|thu|4|room1|claims',
      'seats-in-room|thu|4|room2|claims',
    ])
    expect(inRooms[0]?.detail).toBe('Meeting room 4.1 is not for seating. 1 seat placed there')
  })

  it('is silent when the same seats are at desks', () => {
    expect(findIssues(project([floor4()], [claims(3, ['tue'], { ne1: 3 })]))).toEqual([])
  })
})

describe('how full a day is: day-uses-reserve, day-needs-overflow, day-over-capacity', () => {
  const dayRules = (p: Project) => ofRule(p, 'day-uses-reserve', 'day-needs-overflow', 'day-over-capacity')

  /** 10 desks and 2 overflow seats, with one team of the given size in on Tuesday. */
  const building = (people: number, reserve: number) =>
    project(
      [floor('1', [area('desks', 10), area('touchdown', 2, { kind: 'overflow' })])],
      [team('big', people, ['tue'], {}, { name: 'Big' })],
      { reserve },
    )

  it('is silent while the seats needed fit in the desks that may be planned', () => {
    // A fifth of 10 desks is kept free, which leaves 8 to plan with.
    expect(dayRules(building(8, 0.2))).toEqual([])
  })

  it('warns when a day eats into the reserve', () => {
    expect(dayRules(building(9, 0.2))).toEqual([
      anIssue(
        'day-uses-reserve|tue|-|-|big',
        'warning',
        'Tuesday eats into the reserve',
        '9 seats needed, 8 desks plannable when 20% is kept free (10 desks in total)',
      ),
    ])
    expect(dayRules(building(10, 0.2)).map((i) => i.detail)).toEqual([
      '10 seats needed, 8 desks plannable when 20% is kept free (10 desks in total)',
    ])
  })

  it('warns when a day only fits with overflow seats', () => {
    expect(dayRules(building(11, 0.2))).toEqual([
      anIssue(
        'day-needs-overflow|tue|-|-|big',
        'warning',
        'Tuesday only fits with overflow seats',
        '11 seats needed, 10 desks: 1 person would sit at an overflow seat',
      ),
    ])
    expect(dayRules(building(12, 0.2)).map((i) => i.detail)).toEqual([
      '12 seats needed, 10 desks: 2 people would sit at overflow seats',
    ])
  })

  it('reports a conflict when a day does not even fit with the overflow seats', () => {
    expect(dayRules(building(13, 0.2))).toEqual([
      anIssue(
        'day-over-capacity|tue|-|-|big',
        'error',
        'Tuesday cannot fit',
        '13 seats needed, 10 desks and 2 overflow seats in the building: 1 short',
      ),
    ])
  })

  it('follows the reserve setting', () => {
    // No reserve: all 10 desks may be planned, the eleventh person needs an overflow seat.
    expect(dayRules(building(10, 0))).toEqual([])
    expect(ids(dayRules(building(11, 0)))).toEqual(['day-needs-overflow|tue|-|-|big'])
    // Half of the desks kept free.
    expect(dayRules(building(5, 0.5))).toEqual([])
    expect(dayRules(building(6, 0.5)).map((i) => i.detail)).toEqual([
      '6 seats needed, 5 desks plannable when 50% is kept free (10 desks in total)',
    ])
  })

  it('rounds the plannable desks down: 10% off 66 desks leaves 59', () => {
    const sixtySix = (people: number) =>
      project(
        [floor('4', [area('desks', 66), area('touchdown', 9, { kind: 'overflow' })])],
        [team('big', people, ['tue'], {}, { name: 'Big' })],
        { reserve: 0.1 },
      )
    expect(dayRules(sixtySix(59))).toEqual([])
    expect(dayRules(sixtySix(62)).map((i) => i.detail)).toEqual([
      '62 seats needed, 59 desks plannable when 10% is kept free (66 desks in total)',
    ])
    expect(dayRules(sixtySix(70)).map((i) => i.detail)).toEqual([
      '70 seats needed, 66 desks: 4 people would sit at overflow seats',
    ])
    expect(dayRules(sixtySix(81)).map((i) => i.detail)).toEqual([
      '81 seats needed, 66 desks and 9 overflow seats in the building: 6 short',
    ])
  })

  it('concerns every team that is in on that day, and only that day', () => {
    const p = project(
      [floor('1', [area('desks', 10)])],
      [
        team('a', 6, ['mon', 'tue']),
        // Nobody in this team yet, but it is in on Tuesday.
        team('b', 0, ['tue']),
        team('c', 6, ['tue', 'wed']),
        team('d', 6, ['thu']),
      ],
    )
    expect(dayRules(p)).toEqual([
      anIssue(
        'day-over-capacity|tue|-|-|a+b+c',
        'error',
        'Tuesday cannot fit',
        '12 seats needed, 10 desks and 0 overflow seats in the building: 2 short',
      ),
    ])
  })

  it('reports a building without floors as too small for anyone', () => {
    expect(findIssues(project([], [claims(1, ['tue'])]))).toEqual([
      anIssue(
        'day-over-capacity|tue|-|-|claims',
        'error',
        'Tuesday cannot fit',
        '1 seat needed, 0 desks and 0 overflow seats in the building: 1 short',
      ),
      anIssue('team-unseated|tue|-|-|claims', 'todo', 'Claims Intake has no seats on Tuesday', 'Needs 1 seat'),
    ])
  })

  it('writes one desk and one seat in the singular', () => {
    const tiny = (desks: number, overflow: number, people: number, reserve = 0) =>
      project(
        [floor('1', [area('desks', desks), area('touchdown', overflow, { kind: 'overflow' })])],
        [team('big', people, ['tue'])],
        { reserve },
      )
    expect(dayRules(tiny(1, 1, 3)).map((i) => i.detail)).toEqual([
      '3 seats needed, 1 desk and 1 overflow seat in the building: 1 short',
    ])
    expect(dayRules(tiny(1, 1, 2)).map((i) => i.detail)).toEqual([
      '2 seats needed, 1 desk: 1 person would sit at an overflow seat',
    ])
    expect(dayRules(tiny(1, 0, 1, 0.5)).map((i) => i.detail)).toEqual([
      '1 seat needed, 0 desks plannable when 50% is kept free (1 desk in total)',
    ])
    expect(dayRules(tiny(2, 0, 2, 0.5)).map((i) => i.detail)).toEqual([
      '2 seats needed, 1 desk plannable when 50% is kept free (2 desks in total)',
    ])
  })
})

// ---------------------------------------------------------------------------
// Still to seat, and seated too generously
// ---------------------------------------------------------------------------

describe('team-unseated, team-short and team-over-seated', () => {
  /** Claims Intake, 9 people, in on Tuesday with the given seats on floor 4. */
  const withSeats = (seating: Seating, options: TeamOptions = {}) =>
    project([floor4()], [claims(9, ['tue'], seating, options)])

  it('reports a team day without any seat', () => {
    expect(findIssues(withSeats({}))).toEqual([
      anIssue('team-unseated|tue|-|-|claims', 'todo', 'Claims Intake has no seats on Tuesday', 'Needs 9 seats'),
    ])
  })

  it('points an unseated team at its preferred floor', () => {
    expect(findIssues(withSeats({}, { homeFloorId: '4' }))).toEqual([
      anIssue('team-unseated|tue|4|-|claims', 'todo', 'Claims Intake has no seats on Tuesday', 'Needs 9 seats'),
    ])
  })

  it('reports every unseated team day', () => {
    const p = project([floor4()], [claims(9, ['tue', 'thu'])])
    expect(ids(findIssues(p))).toEqual(['team-unseated|tue|-|-|claims', 'team-unseated|thu|-|-|claims'])
  })

  it('reports a team with fewer seats than it needs', () => {
    expect(findIssues(withSeats({ ne1: 4, ne2: 3 }))).toEqual([
      anIssue('team-short|tue|4|-|claims', 'todo', 'Claims Intake is 2 seats short on Tuesday', '7 of 9 seats placed'),
    ])
    expect(findIssues(withSeats({ ne1: 4, ne2: 4 }))).toEqual([
      anIssue('team-short|tue|4|-|claims', 'todo', 'Claims Intake is 1 seat short on Tuesday', '8 of 9 seats placed'),
    ])
  })

  it('is silent when a team holds exactly the seats it needs', () => {
    expect(findIssues(withSeats({ ne1: 4, ne2: 4, ne3: 1 }))).toEqual([])
  })

  it('notes a team with more seats than it needs', () => {
    expect(findIssues(withSeats({ ne1: 4, ne2: 4, ne3: 2 }))).toEqual([
      anIssue(
        'team-over-seated|tue|4|-|claims',
        'info',
        'Claims Intake holds 1 more seat than it needs on Tuesday',
        '10 seats for 9 needed',
      ),
    ])
    expect(findIssues(withSeats({ ne1: 4, ne2: 4, ne3: 3 }))).toEqual([
      anIssue(
        'team-over-seated|tue|4|-|claims',
        'info',
        'Claims Intake holds 2 more seats than it needs on Tuesday',
        '11 seats for 9 needed',
      ),
    ])
  })

  it('does not count seats in a room', () => {
    const partly = findIssues(withSeats({ ne1: 4, ne2: 4, room: 1 }))
    expect(ids(partly)).toEqual(['seats-in-room|tue|4|room|claims', 'team-short|tue|4|-|claims'])
    expect(partly[1]?.detail).toBe('8 of 9 seats placed')

    expect(ids(findIssues(withSeats({ room: 9 })))).toEqual([
      'seats-in-room|tue|4|room|claims',
      'team-unseated|tue|-|-|claims',
    ])
  })

  it('asks nothing for a team without people, unless it holds seats', () => {
    const nobody = (seating: Seating) => project([floor4()], [team('new', 0, ['tue'], seating, { name: 'New team' })])
    expect(findIssues(nobody({}))).toEqual([])
    expect(findIssues(nobody({ ne1: 2 }))).toEqual([
      anIssue(
        'team-over-seated|tue|4|-|new',
        'info',
        'New team holds 2 more seats than it needs on Tuesday',
        '2 seats for 0 needed',
      ),
    ])
  })

  it('shows a team that is short on the first floor where it holds seats', () => {
    const onTwoFloors = (seating: Seating) => project([floor3(), floor4()], [claims(9, ['tue'], seating)])
    expect(ids(ofRule(onTwoFloors({ ne1: 4 }), 'team-short'))).toEqual(['team-short|tue|4|-|claims'])
    expect(ids(ofRule(onTwoFloors({ ne1: 4, sw3: 1 }), 'team-short'))).toEqual(['team-short|tue|3|-|claims'])
  })
})

describe('attendance', () => {
  /** One hall with room for everybody, so that only the team's own seats matter. */
  const hall = () => floor('1', [area('hall', 200, { name: 'Hall' })])

  it('rounds the seats a team needs up, without floating point noise', () => {
    const needs = (people: number, attendance: number) =>
      findIssues(project([hall()], [claims(people, ['tue'])], { attendance })).map((i) => i.detail)
    // In floating point 100 x 0.55 is 55.00000000000001 and 25 x 0.28 is 7.000000000000001.
    expect(needs(100, 0.55)).toEqual(['Needs 55 seats'])
    expect(needs(25, 0.28)).toEqual(['Needs 7 seats'])
    expect(needs(9, 0.8)).toEqual(['Needs 8 seats'])
  })

  it('takes a team as complete with exactly the rounded number of seats', () => {
    const seated = (seats: number) =>
      findIssues(project([hall()], [claims(100, ['tue'], { hall: seats })], { attendance: 0.55 }))
    expect(seated(55)).toEqual([])
    expect(seated(54)).toEqual([
      anIssue('team-short|tue|1|-|claims', 'todo', 'Claims Intake is 1 seat short on Tuesday', '54 of 55 seats placed'),
    ])
    expect(seated(56)).toEqual([
      anIssue(
        'team-over-seated|tue|1|-|claims',
        'info',
        'Claims Intake holds 1 more seat than it needs on Tuesday',
        '56 seats for 55 needed',
      ),
    ])
  })

  it("prefers a team's own attendance to the project's", () => {
    const p = project(
      [hall()],
      [claims(25, ['tue'], {}, { attendance: 0.28 }), team('under', 25, ['tue'], {}, { name: 'Underwriting' })],
      { attendance: 1 },
    )
    expect(findIssues(p).map((i) => i.detail)).toEqual(['Needs 7 seats', 'Needs 25 seats'])
  })

  it('measures how full a day is with the same rounded numbers', () => {
    const eightDesks = (people: number) =>
      project([floor('1', [area('desks', 8)])], [claims(people, ['tue'])], { attendance: 0.8 })
    // 9 and 10 people at 80% need 8 seats, 11 people need 9.
    expect(ofRule(eightDesks(9), 'day-over-capacity')).toEqual([])
    expect(ofRule(eightDesks(10), 'day-over-capacity')).toEqual([])
    expect(ofRule(eightDesks(11), 'day-over-capacity').map((i) => i.detail)).toEqual([
      '9 seats needed, 8 desks and 0 overflow seats in the building: 1 short',
    ])
  })
})

// ---------------------------------------------------------------------------
// Where a team sits
// ---------------------------------------------------------------------------

describe('team-split-floors', () => {
  it('warns when a team sits on more than one floor', () => {
    const p = project([floor3(), floor4()], [claims(9, ['tue'], { sw1: 4, sw2: 1, ne1: 4 })])
    expect(violations(p)).toEqual([])
    expect(findIssues(p)).toEqual([
      anIssue(
        'team-split-floors|tue|3|-|claims',
        'warning',
        'Claims Intake is split over 2 floors on Tuesday',
        'Floor 3: 5 seats. Floor 4: 4 seats',
      ),
    ])
  })

  it('is silent when all seats are on one floor', () => {
    expect(findIssues(project([floor3(), floor4()], [claims(9, ['tue'], { sw1: 4, sw2: 4, sw3: 1 })]))).toEqual([])
  })

  it('counts every floor and writes one seat in the singular', () => {
    const ground = floor('2', deskRow('gr', 2, 4))
    const p = project([ground, floor3(), floor4()], [claims(9, ['tue'], { gr1: 1, sw1: 4, ne1: 4 })])
    expect(findIssues(p)).toEqual([
      anIssue(
        'team-split-floors|tue|2|-|claims',
        'warning',
        'Claims Intake is split over 3 floors on Tuesday',
        'Floor 2: 1 seat. Floor 3: 4 seats. Floor 4: 4 seats',
      ),
    ])
  })

  it('ignores seats in a room on another floor', () => {
    const floor3WithRoom = floor('3', [
      ...deskRow('sw', 3, 4),
      area('room3', 6, { kind: 'no-seating', name: 'Meeting room 3.1' }),
    ])
    const p = project([floor3WithRoom, floor4()], [claims(4, ['tue'], { ne1: 4, room3: 1 })])
    expect(ids(findIssues(p))).toEqual(['seats-in-room|tue|3|room3|claims'])
  })
})

describe('team-scattered', () => {
  const onFloor4 = (people: number, seating: Seating) => project([floor4()], [claims(people, ['tue'], seating)])

  it('is silent for areas next to each other', () => {
    expect(findIssues(onFloor4(8, { ne1: 4, ne2: 4 }))).toEqual([])
  })

  it('notes a team whose areas are apart', () => {
    expect(findIssues(onFloor4(8, { ne1: 4, ne3: 4 }))).toEqual([
      anIssue(
        'team-scattered|tue|4|-|claims',
        'info',
        'Claims Intake sits in 2 separate places on Floor 4 on Tuesday',
        'NE 1 / NE 3',
      ),
    ])
  })

  it('lists the areas of each place', () => {
    expect(findIssues(onFloor4(9, { ne1: 4, ne2: 4, ne4: 1 })).map((i) => i.detail)).toEqual(['NE 1, NE 2 / NE 4'])
  })

  it('takes areas as one place when they are linked through another area of the team', () => {
    // NE 1 and NE 3 are apart, but NE 2 lies between them.
    expect(findIssues(onFloor4(12, { ne1: 4, ne2: 4, ne3: 4 }))).toEqual([])
    // The touchdown bench runs along the whole row, so it links NE 1 and NE 3 as well.
    expect(ofRule(onFloor4(9, { ne1: 4, ne3: 4, bench: 1 }), 'team-scattered')).toEqual([])
  })

  it('does not take a room for a place', () => {
    expect(ofRule(onFloor4(8, { ne1: 4, room: 4 }), 'team-scattered')).toEqual([])
  })

  it('counts the places', () => {
    const longRow = floor('4', deskRow('ne', 5, 2))
    expect(findIssues(project([longRow], [claims(6, ['tue'], { ne1: 2, ne3: 2, ne5: 2 })]))).toEqual([
      anIssue(
        'team-scattered|tue|4|-|claims',
        'info',
        'Claims Intake sits in 3 separate places on Floor 4 on Tuesday',
        'NE 1 / NE 3 / NE 5',
      ),
    ])
  })

  it('looks at each floor on its own', () => {
    const p = project([floor3(), floor4()], [claims(16, ['tue'], { sw1: 4, sw3: 4, ne1: 4, ne3: 4 })])
    expect(ofRule(p, 'team-scattered')).toEqual([
      anIssue(
        'team-scattered|tue|3|-|claims',
        'info',
        'Claims Intake sits in 2 separate places on Floor 3 on Tuesday',
        'SW 1 / SW 3',
      ),
      anIssue(
        'team-scattered|tue|4|-|claims',
        'info',
        'Claims Intake sits in 2 separate places on Floor 4 on Tuesday',
        'NE 1 / NE 3',
      ),
    ])
    // One area on each floor is split over floors, but scattered on neither.
    const oneEach = project([floor3(), floor4()], [claims(8, ['tue'], { sw1: 4, ne1: 4 })])
    expect(ids(findIssues(oneEach))).toEqual(['team-split-floors|tue|3|-|claims'])
  })

  it('goes by the gap between areas, in any direction', () => {
    // Two clusters, each 0.2 of the plan height on every side, one above the other. Areas
    // count as neighbours up to three quarters of a typical cluster apart: 0.15 here.
    const stacked = (gap: number) =>
      floor('4', [
        area('top', 4, { name: 'Top', rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.2 } }),
        area('bottom', 4, { name: 'Bottom', rect: { x: 0.1, y: 0.3 + gap, w: 0.1, h: 0.2 } }),
      ])
    const places = (gap: number) =>
      findIssues(project([stacked(gap)], [claims(8, ['tue'], { top: 4, bottom: 4 })])).map((i) => i.detail)
    expect(places(0.05)).toEqual([])
    expect(places(0.25)).toEqual(['Top / Bottom'])
  })
})

describe('overflow-used', () => {
  it('warns when a team sits at overflow seats', () => {
    const p = project([floor4()], [claims(7, ['tue'], { ne1: 4, bench: 3 })])
    expect(violations(p)).toEqual([])
    expect(findIssues(p)).toEqual([
      anIssue(
        'overflow-used|tue|4|bench|claims',
        'warning',
        'Claims Intake uses 3 overflow seats on Tuesday',
        'Touchdown bench 3',
      ),
    ])
  })

  it('writes one overflow seat in the singular', () => {
    expect(findIssues(project([floor4()], [claims(5, ['tue'], { ne1: 4, bench: 1 })]))).toEqual([
      anIssue(
        'overflow-used|tue|4|bench|claims',
        'warning',
        'Claims Intake uses 1 overflow seat on Tuesday',
        'Touchdown bench 1',
      ),
    ])
  })

  it('is silent for a team at desks only', () => {
    expect(findIssues(project([floor4()], [claims(4, ['tue'], { ne1: 4 })]))).toEqual([])
  })

  it('lists every overflow area and points at the first one in floor order', () => {
    const twoBenches = floor('4', [
      ...deskRow('ne', 2, 4),
      area('hub', 4, { kind: 'overflow', name: 'Hub counter' }),
      area('bench', 3, { kind: 'overflow', name: 'Touchdown bench' }),
    ])
    expect(findIssues(project([twoBenches], [claims(3, ['tue'], { bench: 2, hub: 1 })]))).toEqual([
      anIssue(
        'overflow-used|tue|4|hub|claims',
        'warning',
        'Claims Intake uses 3 overflow seats on Tuesday',
        'Hub counter 1, Touchdown bench 2',
      ),
    ])
  })

  it('points at the lowest floor when overflow seats are used on several', () => {
    const floor3WithLounge = floor('3', [
      ...deskRow('sw', 3, 4),
      area('lounge', 4, { kind: 'overflow', name: 'Lounge table' }),
    ])
    const p = project([floor3WithLounge, floor4()], [claims(3, ['tue'], { bench: 2, lounge: 1 })])
    expect(ofRule(p, 'overflow-used')).toEqual([
      anIssue(
        'overflow-used|tue|3|lounge|claims',
        'warning',
        'Claims Intake uses 3 overflow seats on Tuesday',
        'Lounge table 1, Touchdown bench 2',
      ),
    ])
  })
})

describe('off-home-floor', () => {
  const onTwoFloors = (seating: Seating, homeFloorId: string | null) =>
    project([floor3(), floor4()], [claims(4, ['tue'], seating, { homeFloorId })])

  it('notes a team that sits on another floor than it prefers', () => {
    const p = onTwoFloors({ ne1: 4 }, '3')
    expect(violations(p)).toEqual([])
    expect(findIssues(p)).toEqual([
      anIssue(
        'off-home-floor|tue|4|-|claims',
        'info',
        'Claims Intake is not on its preferred floor on Tuesday',
        'Preferred: Floor 3. Seated on: Floor 4',
      ),
    ])
  })

  it('is silent on the preferred floor, without a preference and without seats', () => {
    expect(findIssues(onTwoFloors({ sw1: 4 }, '3'))).toEqual([])
    expect(findIssues(onTwoFloors({ ne1: 4 }, null))).toEqual([])
    expect(ids(findIssues(onTwoFloors({}, '3')))).toEqual(['team-unseated|tue|3|-|claims'])
  })

  it('ignores a preferred floor that does not exist', () => {
    expect(findIssues(onTwoFloors({ ne1: 4 }, 'gone'))).toEqual([])
    expect(ids(findIssues(onTwoFloors({}, 'gone')))).toEqual(['team-unseated|tue|-|-|claims'])
  })

  it('names every floor of a team that is only partly on its preferred floor', () => {
    expect(ofRule(onTwoFloors({ sw1: 2, ne1: 2 }, '4'), 'off-home-floor')).toEqual([
      anIssue(
        'off-home-floor|tue|3|-|claims',
        'info',
        'Claims Intake is not on its preferred floor on Tuesday',
        'Preferred: Floor 4. Seated on: Floor 3 and Floor 4',
      ),
    ])
  })
})

// ---------------------------------------------------------------------------
// Day exceptions
// ---------------------------------------------------------------------------

describe('seat-differs and day exceptions', () => {
  it('notes a day on which a team sits somewhere else', () => {
    const twoRows = floor('4', [...deskRow('ne', 2, 4), ...deskRow('se', 2, 4, 0.6)])
    const p = project(
      [twoRows],
      [claims(8, ['tue', 'thu'], { ne1: 4, ne2: 4 }, { daySeating: { tue: { se1: 4, se2: 4 } } })],
    )
    expect(violations(p)).toEqual([])
    expect(findIssues(p)).toEqual([
      anIssue(
        'seat-differs|tue|4|-|claims',
        'info',
        'Claims Intake sits somewhere else on Tuesday',
        'Tuesday: Floor 4: SE 1, SE 2. Other days: Floor 4: NE 1, NE 2',
      ),
    ])
  })

  it('counts a team at its exception on that day, and not at its normal seats', () => {
    const p = project(
      [floor4()],
      [
        // Normally in NE 1, on Tuesday in NE 2.
        claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { tue: { ne2: 4 } } }),
        team('under', 4, ['tue', 'thu'], { ne1: 4 }, { name: 'Underwriting' }),
        team('policy', 4, ['tue'], { ne2: 4 }, { name: 'Policy Admin' }),
      ],
    )
    expect(violations(p)).toEqual([])
    expect(ofRule(p, 'area-over-capacity')).toEqual([
      anIssue(
        'area-over-capacity|tue|4|ne2|claims+policy',
        'error',
        'NE 2 is over capacity on Tuesday',
        '8 seats taken, 4 available. Claims Intake 4, Policy Admin 4',
      ),
      anIssue(
        'area-over-capacity|thu|4|ne1|claims+under',
        'error',
        'NE 1 is over capacity on Thursday',
        '8 seats taken, 4 available. Claims Intake 4, Underwriting 4',
      ),
    ])
  })

  it('counts a team nowhere on days that are not its team days', () => {
    const sharedDesks = project(
      [floor4()],
      [claims(4, ['tue'], { ne1: 4 }), team('under', 4, ['wed'], { ne1: 4 }, { name: 'Underwriting' })],
    )
    expect(findIssues(sharedDesks)).toEqual([])

    // An exception left behind on a day that is no team day holds no seats either.
    const leftBehind = project([floor4()], [claims(4, ['tue'], { ne1: 4 }, { daySeating: { wed: { ne2: 9 } } })])
    expect(findIssues(leftBehind)).toEqual([])
  })

  it('takes an empty exception as "not seated on that day", and on that day only', () => {
    const p = project([floor4()], [claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { tue: {} } })])
    expect(violations(p)).toEqual([])
    // Only the to-do: "sits somewhere else" is not said about a day without any seat.
    expect(findIssues(p)).toEqual([
      anIssue('team-unseated|tue|-|-|claims', 'todo', 'Claims Intake has no seats on Tuesday', 'Needs 4 seats'),
    ])
  })

  it('says so when the other days have no seats', () => {
    const p = project([floor4()], [claims(4, ['tue', 'thu'], {}, { daySeating: { tue: { ne1: 4 } } })])
    expect(findIssues(p)).toEqual([
      anIssue('team-unseated|thu|-|-|claims', 'todo', 'Claims Intake has no seats on Thursday', 'Needs 4 seats'),
      anIssue(
        'seat-differs|tue|4|-|claims',
        'info',
        'Claims Intake sits somewhere else on Tuesday',
        'Tuesday: Floor 4: NE 1. Other days: not seated',
      ),
    ])
  })

  it('says so when every team day has its own seating', () => {
    const p = project(
      [floor4()],
      [claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { tue: { ne2: 4 }, thu: { ne3: 4 } } })],
    )
    expect(findIssues(p)).toEqual([
      anIssue(
        'seat-differs|tue|4|-|claims',
        'info',
        'Claims Intake sits somewhere else on Tuesday',
        'Tuesday: Floor 4: NE 2. Every team day has its own seating',
      ),
      anIssue(
        'seat-differs|thu|4|-|claims',
        'info',
        'Claims Intake sits somewhere else on Thursday',
        'Thursday: Floor 4: NE 3. Every team day has its own seating',
      ),
    ])
  })

  it('describes seats on several floors and shows the first of them', () => {
    const p = project(
      [floor3(), floor4()],
      [claims(8, ['mon', 'tue'], { ne1: 4, ne2: 4 }, { daySeating: { mon: { sw1: 4, ne1: 4 } } })],
    )
    expect(ofRule(p, 'seat-differs')).toEqual([
      anIssue(
        'seat-differs|mon|3|-|claims',
        'info',
        'Claims Intake sits somewhere else on Monday',
        'Monday: Floor 3: SW 1; Floor 4: NE 1. Other days: Floor 4: NE 1, NE 2',
      ),
    ])
  })
})

// ---------------------------------------------------------------------------
// Days and wishes
// ---------------------------------------------------------------------------

describe('unwanted-day', () => {
  it('warns about a planned day on which the team cannot come', () => {
    const p = project(
      [floor4()],
      [claims(4, ['tue', 'fri'], { ne1: 4 }, { wishes: wishes({ tue: 'want', fri: 'cannot' }) })],
    )
    expect(violations(p)).toEqual([])
    expect(findIssues(p)).toEqual([
      anIssue(
        'unwanted-day|fri|4|-|claims',
        'warning',
        'Claims Intake is planned on Friday but cannot come',
        'The team said it cannot come on Friday',
      ),
    ])
  })

  it('is silent for every other wish, and for a day that is not planned', () => {
    const said = wishes({ mon: 'want', tue: 'can', wed: 'none', thu: 'cannot' })
    const p = project([floor4()], [claims(4, ['mon', 'tue', 'wed'], { ne1: 4 }, { wishes: said })])
    expect(findIssues(p)).toEqual([])
  })
})

describe('wish-unmet', () => {
  it('warns about a wanted day that is not planned', () => {
    const p = project(
      [floor4()],
      [claims(4, ['wed', 'thu'], { ne1: 4 }, { wishes: wishes({ tue: 'want', wed: 'want', thu: 'want' }) })],
    )
    expect(violations(p)).toEqual([])
    expect(findIssues(p)).toEqual([
      anIssue(
        'wish-unmet|tue|-|-|claims',
        'warning',
        'Claims Intake wants Tuesday but is not planned then',
        'Planned: Wednesday and Thursday',
      ),
    ])
  })

  it('lists the planned days in week order', () => {
    const said = wishes({ mon: 'want', tue: 'want', wed: 'want', fri: 'want' })
    const p = project([floor4()], [claims(4, ['mon', 'wed', 'fri'], { ne1: 4 }, { wishes: said })])
    expect(findIssues(p).map((i) => i.detail)).toEqual(['Planned: Monday, Wednesday and Friday'])
  })

  it('is silent when the wanted days are planned and for days the team merely could do', () => {
    const said = wishes({ mon: 'can', tue: 'want', wed: 'none', thu: 'cannot' })
    expect(findIssues(project([floor4()], [claims(4, ['tue'], { ne1: 4 }, { wishes: said })]))).toEqual([])
  })

  it('is about the week, not about a place: it names no floor, whatever the team prefers', () => {
    const said = wishes({ tue: 'want', thu: 'want' })
    const p = project([floor4()], [claims(4, ['thu'], { ne1: 4 }, { wishes: said, homeFloorId: '4' })])
    expect(ids(findIssues(p))).toEqual(['wish-unmet|tue|-|-|claims'])
  })

  it('says so when no day is planned at all', () => {
    const p = project([floor4()], [claims(4, [], {}, { wishes: wishes({ tue: 'want' }) })])
    expect(findIssues(p)).toEqual([
      anIssue(
        'wish-unmet|tue|-|-|claims',
        'warning',
        'Claims Intake wants Tuesday but is not planned then',
        'No day planned',
      ),
      anIssue('no-team-days|-|-|-|claims', 'info', 'Claims Intake has no team day yet', 'Wanted: Tuesday'),
    ])
  })
})

describe('no-team-days', () => {
  it('notes a team with people and no team day', () => {
    expect(findIssues(project([floor4()], [claims(9, [])]))).toEqual([
      anIssue('no-team-days|-|-|-|claims', 'info', 'Claims Intake has no team day yet', 'No day asked for'),
    ])
  })

  it('lists the days the team asked for', () => {
    const p = project([floor4()], [claims(9, [], {}, { wishes: wishes({ thu: 'want', tue: 'want' }) })])
    expect(ofRule(p, 'no-team-days')).toEqual([
      anIssue('no-team-days|-|-|-|claims', 'info', 'Claims Intake has no team day yet', 'Wanted: Tuesday and Thursday'),
    ])
  })

  it('does not take a day the team merely could do, or cannot do, for a wanted day', () => {
    const said = wishes({ mon: 'can', tue: 'want', wed: 'cannot' })
    const p = project([floor4()], [claims(9, [], {}, { wishes: said })])
    expect(ofRule(p, 'no-team-days').map((i) => i.detail)).toEqual(['Wanted: Tuesday'])
    const noWish = project([floor4()], [claims(9, [], {}, { wishes: wishes({ mon: 'can', wed: 'cannot' }) })])
    expect(findIssues(noWish).map((i) => i.detail)).toEqual(['No day asked for'])
  })

  it('is silent for a team without people and for a team with one planned day', () => {
    expect(findIssues(project([floor4()], [claims(0, [])]))).toEqual([])
    expect(findIssues(project([floor4()], [claims(4, ['fri'], { ne1: 4 })]))).toEqual([])
  })

  it('names no floor, whatever the team prefers', () => {
    const p = project([floor4()], [claims(9, [], {}, { homeFloorId: '4' })])
    expect(ids(findIssues(p))).toEqual(['no-team-days|-|-|-|claims'])
  })

  it('counts the seats of a team without a team day nowhere', () => {
    const p = project([floor4()], [claims(9, [], { ne1: 9, room: 2 })])
    expect(ids(findIssues(p))).toEqual(['no-team-days|-|-|-|claims'])
  })
})

// ---------------------------------------------------------------------------
// Order and form of the result
// ---------------------------------------------------------------------------

describe('the order of the issues', () => {
  it('goes by level, weekday, floor, area, team and rule name, with missing parts last', () => {
    // Area and team ids are chosen so that the alphabet never agrees with the list order.
    const lower = floor('3', [area('z', 2), area('a', 2)])
    const upper = floor('4', [area('m', 2), area('n', 2), area('o', 2, { kind: 'overflow' })])
    const p = project(
      [lower, upper],
      [
        // Tuesday: two teams in A, two in Z, two in M (they also meet on Monday). 12 people
        // on 8 desks and 2 overflow seats, so the day as a whole cannot fit either.
        team('yan', 2, ['tue'], { a: 2 }),
        team('bo', 2, ['tue'], { a: 2 }),
        team('xi', 2, ['tue'], { z: 2 }),
        team('cy', 2, ['tue'], { z: 2 }),
        team('wu', 2, ['mon', 'tue'], { m: 2 }),
        team('di', 2, ['mon', 'tue'], { m: 2 }),
        // Wednesday: five teams that still need seats.
        team('ed', 1, ['wed']),
        team('fay', 2, ['wed'], { n: 1 }),
        team('gus', 1, ['wed'], {}, { homeFloorId: '3' }),
        team('hal', 1, ['wed'], {}, { homeFloorId: '3' }),
        team('ira', 2, ['wed'], { a: 1 }),
        // Thursday: three notes about the same team on the same floor.
        team('jo', 1, ['thu', 'fri'], { m: 1 }, { homeFloorId: '4', daySeating: { thu: { z: 2 } } }),
        // A wish for Monday that is not met, and Thursday planned against the team's word.
        team('kim', 2, ['thu'], { n: 2 }, { wishes: wishes({ mon: 'want', thu: 'cannot' }) }),
        // At an overflow seat on the same floor and day as Kim's warning.
        team('mo', 1, ['thu'], { o: 1 }),
        team('lee', 2, []),
      ],
    )
    expect(violations(p)).toEqual([])
    expect(ids(findIssues(p))).toEqual([
      // Conflicts. Monday comes before Tuesday although it is on the higher floor.
      'area-over-capacity|mon|4|m|wu+di',
      // Floor 3 before floor 4, and Z before A because that is their order on the floor.
      'area-over-capacity|tue|3|z|xi+cy',
      'area-over-capacity|tue|3|a|yan+bo',
      'area-over-capacity|tue|4|m|wu+di',
      // Not tied to a floor: after everything that is.
      'day-over-capacity|tue|-|-|yan+bo+xi+cy+wu+di',
      // To-dos. On one floor the team list decides, before the rule name does.
      'team-unseated|wed|3|-|gus',
      'team-unseated|wed|3|-|hal',
      'team-short|wed|3|-|ira',
      'team-short|wed|4|-|fay',
      'team-unseated|wed|-|-|ed',
      // Warnings. On one floor, what is tied to an area comes before what is not.
      'wish-unmet|mon|-|-|kim',
      'overflow-used|thu|4|o|mo',
      'unwanted-day|thu|4|-|kim',
      // Notes. Same day, floor and team: by rule name.
      'off-home-floor|thu|3|-|jo',
      'seat-differs|thu|3|-|jo',
      'team-over-seated|thu|3|-|jo',
      // Not tied to a day: last.
      'no-team-days|-|-|-|lee',
    ])
  })
})

/** A plan in which every rule fires at least once. 28 desks and 3 overflow seats on two
 *  floors; a quarter of the desks is kept free, which leaves 21 to plan with. */
function mixedProject(): Project {
  return project(
    [floor3(), floor4()],
    [
      // Tuesday (20 seats needed, fits).
      claims(4, ['tue', 'thu'], { ne1: 4 }, { daySeating: { thu: { ne2: 4 } } }),
      team('under', 2, ['tue'], { ne1: 2 }, { name: 'Underwriting' }),
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

/** Where an issue belongs in the list, worked out from the project without `findIssues`. */
function listPosition(p: Project, issue: Issue): (number | string)[] {
  const last = Number.MAX_SAFE_INTEGER
  const orLast = (index: number) => (index < 0 ? last : index)
  const onFloor = p.floors.find((f) => f.id === issue.floorId)
  return [
    SEVERITY_ORDER.indexOf(issue.severity),
    issue.day === null ? last : WEEKDAYS.indexOf(issue.day),
    orLast(p.floors.findIndex((f) => f.id === issue.floorId)),
    orLast(onFloor ? onFloor.areas.findIndex((a) => a.id === issue.areaId) : -1),
    orLast(p.teams.findIndex((t) => t.id === issue.teamIds[0])),
    issue.rule,
  ]
}

function comparePositions(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined || y === undefined || x === y) continue
    return x < y ? -1 : 1
  }
  return 0
}

/** The rules of form that hold for every issue, whatever it is about. */
function expectWellFormed(p: Project, issues: readonly Issue[]): void {
  const floorOfArea = new Map(p.floors.flatMap((f) => f.areas.map((a) => [a.id, f.id] as const)))
  const floorIds = new Set(p.floors.map((f) => f.id))
  const teamIds = p.teams.map((t) => t.id)

  for (const issue of issues) {
    const teams = issue.teamIds.join('+') || '-'
    expect(issue.id).toBe([issue.rule, issue.day ?? '-', issue.floorId ?? '-', issue.areaId ?? '-', teams].join('|'))
    expect(issue.severity).toBe(RULE_SEVERITY[issue.rule])

    if (issue.floorId !== null) expect(floorIds.has(issue.floorId)).toBe(true)
    if (issue.areaId !== null) expect(floorOfArea.get(issue.areaId)).toBe(issue.floorId)
    // Teams involved exist and are listed in team-list order.
    expect(issue.teamIds.length).toBeGreaterThan(0)
    expect(issue.teamIds).toEqual(teamIds.filter((id) => issue.teamIds.includes(id)))

    for (const text of [issue.title, issue.detail]) {
      expect(text).not.toBe('')
      expect(text.endsWith('.')).toBe(false)
      expect(text).not.toMatch(/undefined|null|NaN|Infinity/)
      // "1 seat", never "1 seats"; "2 seats", never "2 seat".
      expect(text).not.toMatch(/(^|[^0-9])1 (more seats|overflow seats|seats|desks|people|floors|separate places)/)
      expect(text).not.toMatch(/(^|[^0-9])(0|[2-9]|[0-9]{2,}) (more seat|overflow seat|seat|desk|person)( |$)/)
    }
  }

  expect(new Set(ids(issues)).size).toBe(issues.length)
  const inOrder = [...issues].sort((a, b) => comparePositions(listPosition(p, a), listPosition(p, b)))
  expect(ids(issues)).toEqual(ids(inOrder))
}

describe('a larger mixed project', () => {
  const p = mixedProject()
  const issues = findIssues(p)

  it('is a sound project in which every rule fires', () => {
    expect(violations(p)).toEqual([])
    const fired = new Set(issues.map((issue) => issue.rule))
    expect([...fired].sort()).toEqual(Object.keys(RULE_SEVERITY).sort())
  })

  it('gives every issue its own id, in the set form, and lists them in order', () => {
    expectWellFormed(p, issues)
  })

  it('lists the issues of each level', () => {
    const idsOf = (severity: Severity) => ids(issues.filter((issue) => issue.severity === severity))
    expect(idsOf('error')).toEqual([
      'day-over-capacity|mon|-|-|legal+crowd1',
      'area-over-capacity|tue|4|ne1|claims+under',
      'seats-in-room|tue|4|room|data',
    ])
    expect(idsOf('todo')).toEqual([
      'team-unseated|mon|-|-|crowd1',
      'team-short|tue|4|-|policy',
      'team-unseated|tue|-|-|data',
      'team-unseated|wed|-|-|crowd2',
      'team-unseated|fri|-|-|crowd3',
    ])
    expect(idsOf('warning')).toEqual([
      'overflow-used|tue|4|bench|portal',
      'wish-unmet|wed|-|-|legal',
      'day-needs-overflow|wed|-|-|crowd2',
      'team-split-floors|thu|3|-|finance',
      'unwanted-day|fri|3|-|arch',
      'day-uses-reserve|fri|-|-|arch+crowd3',
    ])
    expect(idsOf('info')).toEqual([
      'off-home-floor|thu|3|-|finance',
      'seat-differs|thu|4|-|claims',
      'team-over-seated|thu|4|-|broker',
      'team-scattered|thu|4|-|risk',
      'no-team-days|-|-|-|newbies',
    ])
  })

  it('does not depend on the order of the keys inside seating records', () => {
    const shuffled = withSeatingKeysReversed(p)
    const finance = (project: Project) => Object.keys(project.teams.find((t) => t.id === 'finance')?.seating ?? {})
    expect(finance(p)).toEqual(['sw1', 'ne4'])
    expect(finance(shuffled)).toEqual(['ne4', 'sw1'])
    expect(findIssues(shuffled)).toEqual(issues)
  })
})

// ---------------------------------------------------------------------------
// Many random plans: the same rules of form, and the core rules worked out the long way
// ---------------------------------------------------------------------------

/** Repeatable random numbers (mulberry32), so that a failing plan can be built again from
 *  its seed. */
function randomSource(seed: number) {
  let state = seed
  const next = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    /** A whole number from 0 up to, but not including, `below`. */
    int: (below: number) => Math.floor(next() * below),
    chance: (probability: number) => next() < probability,
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)]
      if (item === undefined) throw new Error('nothing to pick from')
      return item
    },
  }
}

const LETTERS = 'ABCDEFGHIJ'

/** A random plan of one to three floors and up to eight teams, seated all over the place:
 *  in rooms, over capacity, on several floors, with day exceptions. Names carry no digits,
 *  so every digit in an issue text is a count. */
function randomProject(seed: number): Project {
  const random = randomSource(seed)
  const kinds: AreaKind[] = ['desks', 'desks', 'desks', 'overflow', 'no-seating']
  const floors = Array.from({ length: 1 + random.int(3) }, (_, f) =>
    floor(
      `f${f}`,
      Array.from({ length: 1 + random.int(6) }, (_, a) =>
        area(`f${f}a${a}`, random.int(7), {
          kind: random.pick(kinds),
          name: `Area ${LETTERS.charAt(f)}${LETTERS.charAt(a)}`,
          rect: { x: random.int(9) / 10, y: random.int(9) / 10, w: 0.1, h: 0.1 },
        }),
      ),
      { name: `Floor ${LETTERS.charAt(f)}` },
    ),
  )
  const areaIds = floors.flatMap((f) => f.areas.map((a) => a.id))
  const randomSeating = (): Seating => {
    const seating: Seating = {}
    for (const id of areaIds) if (random.chance(0.3)) seating[id] = 1 + random.int(5)
    return seating
  }
  const teams = Array.from({ length: random.int(9) }, (_, t) => {
    const days = WEEKDAYS.filter(() => random.chance(0.4))
    const daySeating: Partial<Record<Weekday, Seating>> = {}
    for (const day of days) {
      if (random.chance(0.25)) daySeating[day] = random.chance(0.2) ? {} : randomSeating()
    }
    const said = wishes({})
    for (const day of WEEKDAYS) said[day] = random.pick(['want', 'can', 'none', 'cannot'])
    return team(`t${t}`, random.int(13), days, randomSeating(), {
      name: `Team ${LETTERS.charAt(t)}`,
      wishes: said,
      attendance: random.chance(0.3) ? random.pick([0.28, 0.5, 0.8]) : null,
      homeFloorId: random.chance(0.4) ? random.pick(floors).id : null,
      daySeating,
    })
  })
  return project(floors, teams, { attendance: random.pick([1, 0.8, 0.55]), reserve: random.pick([0, 0.1, 0.25]) })
}

/** The seats a team holds on a day, read straight from the data model. */
function seatsOn(t: Team, day: Weekday): Seating {
  return t.days.includes(day) ? (t.daySeating[day] ?? t.seating) : {}
}

/** The ids of all `area-over-capacity` and `seats-in-room` issues, worked out the long way. */
function collisionIds(p: Project): string[] {
  const found: string[] = []
  for (const day of WEEKDAYS) {
    for (const f of p.floors) {
      for (const a of f.areas) {
        const holders = p.teams.filter((t) => (seatsOn(t, day)[a.id] ?? 0) > 0)
        const used = holders.reduce((sum, t) => sum + (seatsOn(t, day)[a.id] ?? 0), 0)
        if (a.kind === 'no-seating') {
          for (const t of holders) found.push(`seats-in-room|${day}|${f.id}|${a.id}|${t.id}`)
        } else if (used > a.capacity) {
          found.push(`area-over-capacity|${day}|${f.id}|${a.id}|${holders.map((t) => t.id).join('+')}`)
        }
      }
    }
  }
  return found
}

/** The ids of all `team-unseated`, `team-short` and `team-over-seated` issues, worked out
 *  the long way. */
function seatStateIds(p: Project): string[] {
  const found: string[] = []
  for (const t of p.teams) {
    for (const day of t.days) {
      const seats = seatsOn(t, day)
      const perFloor = p.floors.map((f) =>
        f.areas.reduce((sum, a) => sum + (a.kind === 'no-seating' ? 0 : (seats[a.id] ?? 0)), 0),
      )
      const seated = perFloor.reduce((sum, n) => sum + n, 0)
      const needed = seatsNeeded(t, p.settings)
      const firstFloor = p.floors[perFloor.findIndex((n) => n > 0)]
      const homeFloor = p.floors.find((f) => f.id === t.homeFloorId)
      const floorId = (firstFloor ?? homeFloor)?.id ?? '-'
      if (seated === 0 && needed > 0) found.push(`team-unseated|${day}|${floorId}|-|${t.id}`)
      else if (seated > 0 && seated < needed) found.push(`team-short|${day}|${floorId}|-|${t.id}`)
      else if (seated > needed) found.push(`team-over-seated|${day}|${floorId}|-|${t.id}`)
    }
  }
  return found
}

describe('on 300 random plans', () => {
  const seeds = Array.from({ length: 300 }, (_, i) => i + 1)

  /** Runs a check on every plan. A failure names the plan it happened on. */
  const onEveryPlan = (check: (p: Project) => void) => {
    for (const seed of seeds) {
      try {
        check(randomProject(seed))
      } catch (error) {
        throw new Error(`failed on randomProject(${seed})`, { cause: error })
      }
    }
  }

  it('follows the rules of form', () => {
    onEveryPlan((p) => {
      const issues = findIssues(p)
      expectWellFormed(p, issues)
      // Counts are whole numbers: no decimal point or thousands separator anywhere.
      for (const issue of issues) expect(`${issue.title} ${issue.detail}`).not.toMatch(/\d[.,]\d/)
    })
  })

  it('does not depend on the order of the keys inside seating records', () => {
    onEveryPlan((p) => {
      expect(findIssues(withSeatingKeysReversed(p))).toEqual(findIssues(p))
    })
  })

  it('finds exactly the collisions that the seating records hold', () => {
    onEveryPlan((p) => {
      expect(ids(ofRule(p, 'area-over-capacity', 'seats-in-room')).sort()).toEqual(collisionIds(p).sort())
    })
  })

  it('finds exactly the teams that are unseated, short or over-seated', () => {
    onEveryPlan((p) => {
      expect(ids(ofRule(p, 'team-unseated', 'team-short', 'team-over-seated')).sort()).toEqual(seatStateIds(p).sort())
    })
  })

  it('covers every rule', () => {
    const fired = new Set(seeds.flatMap((seed) => findIssues(randomProject(seed)).map((issue) => issue.rule)))
    expect([...fired].sort()).toEqual(Object.keys(RULE_SEVERITY).sort())
  })
})

// ---------------------------------------------------------------------------
// Accepting, summarizing, and the worst level
// ---------------------------------------------------------------------------

/** The project with these issues accepted as they are now. */
function accepting(p: Project, issues: readonly Issue[], note = ''): Project {
  const accepted = { ...p.accepted }
  for (const issue of issues) accepted[issue.id] = { note, detail: issue.detail }
  return { ...p, accepted }
}

describe('isAccepted', () => {
  /** Claims Intake with some of its people at the touchdown bench: exactly one warning. */
  const atTheBench = (benchSeats: number) =>
    project([floor4()], [claims(4 + benchSeats, ['tue'], { ne1: 4, bench: benchSeats })])

  const theOnlyIssue = (p: Project): Issue => {
    const [issue, ...others] = findIssues(p)
    if (issue === undefined || others.length > 0) throw new Error('expected exactly one issue')
    return issue
  }

  it('takes a warning as accepted while its detail is unchanged', () => {
    const p = atTheBench(2)
    const warning = theOnlyIssue(p)
    expect(warning.id).toBe('overflow-used|tue|4|bench|claims')
    expect(isAccepted(p, warning)).toBe(false)

    const accepted = accepting(p, [warning], 'Agreed with the team')
    expect(isAccepted(accepted, warning)).toBe(true)
    // Accepted issues stay in the list; they are only marked.
    expect(findIssues(accepted)).toEqual([warning])
  })

  it('opens the warning again when the numbers behind it change', () => {
    const before = atTheBench(2)
    const after: Project = { ...atTheBench(3), accepted: accepting(before, [theOnlyIssue(before)]).accepted }
    const warning = theOnlyIssue(after)
    expect(warning.id).toBe(theOnlyIssue(before).id)
    expect(warning.detail).toBe('Touchdown bench 3')
    expect(isAccepted(after, warning)).toBe(false)
  })

  it('takes notes as well', () => {
    const p = project([floor4()], [claims(3, ['tue'], { ne1: 4 })])
    const note = theOnlyIssue(p)
    expect(note.rule).toBe('team-over-seated')
    expect(isAccepted(accepting(p, [note]), note)).toBe(true)
  })

  it('never takes a conflict or a to-do as accepted', () => {
    const p = project([floor4()], [claims(3, ['tue'], { room: 3 })])
    const issues = findIssues(p)
    expect(issues.map((issue) => issue.severity)).toEqual(['error', 'todo'])
    const accepted = accepting(p, issues)
    expect(issues.map((issue) => isAccepted(accepted, issue))).toEqual([false, false])
  })

  it('does not confuse one issue with another', () => {
    const p = atTheBench(2)
    const warning = theOnlyIssue(p)
    const thursdays = { 'overflow-used|thu|4|bench|claims': { note: '', detail: warning.detail } }
    expect(isAccepted({ ...p, accepted: thursdays }, warning)).toBe(false)
  })
})

describe('summarizeIssues', () => {
  it('counts conflicts, teams to seat, open warnings and notes, and what was accepted', () => {
    const p = project(
      [floor4()],
      [
        // Two teams in NE 1: one conflict.
        claims(4, ['tue'], { ne1: 4 }),
        team('under', 2, ['tue'], { ne1: 2 }, { name: 'Underwriting' }),
        // In a room on two days: two conflicts, and unseated twice, which is one team to seat.
        team('data', 3, ['tue', 'thu'], { room: 3 }, { name: 'Data Platform' }),
        // Two seats short: a second team to seat.
        team('policy', 6, ['wed'], { ne2: 4 }, { name: 'Policy Admin' }),
        // One warning.
        team('portal', 5, ['wed'], { ne3: 4, bench: 1 }, { name: 'Customer Portal' }),
        // Two notes.
        team('broker', 2, ['thu'], { ne3: 3 }, { name: 'Broker Channel' }),
        team('arch', 4, [], {}, { name: 'Architecture' }),
      ],
    )
    const issues = findIssues(p)
    expect(ids(issues)).toEqual([
      'area-over-capacity|tue|4|ne1|claims+under',
      'seats-in-room|tue|4|room|data',
      'seats-in-room|thu|4|room|data',
      'team-unseated|tue|-|-|data',
      'team-short|wed|4|-|policy',
      'team-unseated|thu|-|-|data',
      'overflow-used|wed|4|bench|portal',
      'team-over-seated|thu|4|-|broker',
      'no-team-days|-|-|-|arch',
    ])
    expect(summarizeIssues(p, issues)).toEqual({ conflicts: 3, teamsToSeat: 2, warnings: 1, notes: 2, accepted: 0 })

    const some = accepting(
      p,
      issues.filter((issue) => issue.rule === 'overflow-used' || issue.rule === 'no-team-days'),
    )
    expect(summarizeIssues(some, issues)).toEqual({ conflicts: 3, teamsToSeat: 2, warnings: 0, notes: 1, accepted: 2 })

    // Accepting everything changes nothing for conflicts and to-dos.
    const all = accepting(p, issues)
    expect(summarizeIssues(all, issues)).toEqual({ conflicts: 3, teamsToSeat: 2, warnings: 0, notes: 0, accepted: 3 })
  })

  it('is all zero without issues', () => {
    const nothing = { conflicts: 0, teamsToSeat: 0, warnings: 0, notes: 0, accepted: 0 }
    expect(summarizeIssues(project([]), [])).toEqual(nothing)
  })
})

describe('worstSeverity', () => {
  // One issue of each level, each on its own day.
  const p = project(
    [floor3(), floor4()],
    [
      // Monday, floor 4: two teams in NE 1.
      claims(4, ['mon'], { ne1: 4 }),
      team('under', 2, ['mon'], { ne1: 2 }, { name: 'Underwriting' }),
      // Tuesday, floor 3: two seats short.
      team('policy', 6, ['tue'], { sw1: 4 }, { name: 'Policy Admin' }),
      // Wednesday, floor 4: one overflow seat.
      team('portal', 5, ['wed'], { ne3: 4, bench: 1 }, { name: 'Customer Portal' }),
      // Thursday, floor 3: one seat too many.
      team('broker', 2, ['thu'], { sw2: 3 }, { name: 'Broker Channel' }),
    ],
  )
  const issues = findIssues(p)

  it('starts from one issue of each level', () => {
    expect(ids(issues)).toEqual([
      'area-over-capacity|mon|4|ne1|claims+under',
      'team-short|tue|3|-|policy',
      'overflow-used|wed|4|bench|portal',
      'team-over-seated|thu|3|-|broker',
    ])
  })

  it('gives the most serious level among the issues that match every filter', () => {
    expect(worstSeverity(issues, {})).toBe('error')
    expect(worstSeverity(issues, { day: 'mon' })).toBe('error')
    expect(worstSeverity(issues, { day: 'tue' })).toBe('todo')
    expect(worstSeverity(issues, { day: 'wed' })).toBe('warning')
    expect(worstSeverity(issues, { day: 'thu' })).toBe('info')
    expect(worstSeverity(issues, { floorId: '3' })).toBe('todo')
    expect(worstSeverity(issues, { floorId: '4' })).toBe('error')
    expect(worstSeverity(issues, { floorId: '4', day: 'wed' })).toBe('warning')
    expect(worstSeverity(issues, { areaId: 'bench' })).toBe('warning')
    expect(worstSeverity(issues, { areaId: 'ne1' })).toBe('error')
    // Every team of an issue counts, not only the first.
    expect(worstSeverity(issues, { teamId: 'under' })).toBe('error')
    expect(worstSeverity(issues, { teamId: 'broker' })).toBe('info')
  })

  it('gives null when nothing matches', () => {
    expect(worstSeverity([], {})).toBeNull()
    expect(worstSeverity(issues, { day: 'fri' })).toBeNull()
    expect(worstSeverity(issues, { floorId: '3', day: 'wed' })).toBeNull()
    expect(worstSeverity(issues, { areaId: 'ne2' })).toBeNull()
    expect(worstSeverity(issues, { teamId: 'portal', day: 'thu' })).toBeNull()
  })

  it('skips accepted warnings and notes when it is given the project', () => {
    const accepted = accepting(p, issues)
    // Without the project nothing is known about acceptance.
    expect(worstSeverity(issues, { day: 'wed' })).toBe('warning')
    expect(worstSeverity(issues, { day: 'wed' }, p)).toBe('warning')
    expect(worstSeverity(issues, { day: 'wed' }, accepted)).toBeNull()
    expect(worstSeverity(issues, { day: 'thu' }, accepted)).toBeNull()
    // Conflicts and to-dos cannot be accepted away.
    expect(worstSeverity(issues, { day: 'mon' }, accepted)).toBe('error')
    expect(worstSeverity(issues, { day: 'tue' }, accepted)).toBe('todo')
    expect(worstSeverity(issues, {}, accepted)).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// The real floor
// ---------------------------------------------------------------------------

describe('on the real floor 4', () => {
  const realFloor: Floor = {
    id: 'floor-4',
    name: 'Floor 4',
    label: '4',
    // No picture needed, but its proportions decide which areas are neighbours.
    plan: { src: '', width: FLOOR4_PLAN_SIZE.width, height: FLOOR4_PLAN_SIZE.height },
    areas: FLOOR4_AREAS,
  }

  // 66 desks and 32 overflow seats; a tenth of the desks is kept free, which leaves 59.
  const p = project(
    [realFloor],
    [
      // The north-east row, next to each other. On Thursday in the south-west corner instead.
      team('claims', 9, ['tue', 'thu'], { 'f4-ne1': 4, 'f4-ne2': 2, 'f4-ne3': 3 }, {
        name: 'Claims Intake',
        daySeating: { thu: { 'f4-sw1': 4, 'f4-sw2': 2, 'f4-sw3': 2, 'f4-sw4': 1 } },
      }),
      // Two seats in NE 3, which Claims Intake nearly fills on Tuesday, and four at the
      // other end of the floor.
      team('underwriting', 10, ['tue', 'wed'], { 'f4-ne3': 2, 'f4-ne4': 4, 'f4-se5': 4 }, { name: 'Underwriting' }),
      // Two seats short.
      team('policy', 8, ['mon', 'wed'], { 'f4-n1': 4, 'f4-n2': 2 }, { name: 'Policy Admin' }),
      // Three people at the touchdown bench, far from the others; would like Friday too.
      team('portal', 7, ['tue', 'thu'], { 'f4-se1': 4, 'f4-bench': 3 }, {
        name: 'Customer Portal',
        wishes: wishes({ tue: 'want', thu: 'want', fri: 'want' }),
      }),
      // Put in a meeting room.
      team('data', 6, ['tue'], { 'f4-room-41': 6 }, { name: 'Data Platform' }),
      // Makes Tuesday busy: 62 seats needed in all. Has 12 of its 30 seats.
      team('finance', 30, ['tue'], { 'f4-nw1': 6, 'f4-nw2': 6 }, { name: 'Finance Operations' }),
      // Asked for Wednesday, not planned yet.
      team('architecture', 4, [], {}, { name: 'Architecture', wishes: wishes({ wed: 'want' }) }),
    ],
    { reserve: 0.1 },
  )
  const issues = findIssues(p)

  it('finds what a planner would expect, in the order of the list', () => {
    expect(violations(p)).toEqual([])
    expect(issues).toEqual([
      // Conflicts
      anIssue(
        'area-over-capacity|tue|floor-4|f4-ne3|claims+underwriting',
        'error',
        'NE 3 is over capacity on Tuesday',
        '5 seats taken, 4 available. Claims Intake 3, Underwriting 2',
      ),
      anIssue(
        'seats-in-room|tue|floor-4|f4-room-41|data',
        'error',
        'Data Platform is seated in Meeting room 4.1 on Tuesday',
        'Meeting room 4.1 is not for seating. 6 seats placed there',
      ),
      // Still to seat
      anIssue(
        'team-short|mon|floor-4|-|policy',
        'todo',
        'Policy Admin is 2 seats short on Monday',
        '6 of 8 seats placed',
      ),
      anIssue(
        'team-short|tue|floor-4|-|finance',
        'todo',
        'Finance Operations is 18 seats short on Tuesday',
        '12 of 30 seats placed',
      ),
      anIssue('team-unseated|tue|-|-|data', 'todo', 'Data Platform has no seats on Tuesday', 'Needs 6 seats'),
      anIssue(
        'team-short|wed|floor-4|-|policy',
        'todo',
        'Policy Admin is 2 seats short on Wednesday',
        '6 of 8 seats placed',
      ),
      // Warnings
      anIssue(
        'overflow-used|tue|floor-4|f4-bench|portal',
        'warning',
        'Customer Portal uses 3 overflow seats on Tuesday',
        'Touchdown bench 3',
      ),
      anIssue(
        'day-uses-reserve|tue|-|-|claims+underwriting+portal+data+finance',
        'warning',
        'Tuesday eats into the reserve',
        '62 seats needed, 59 desks plannable when 10% is kept free (66 desks in total)',
      ),
      anIssue(
        'wish-unmet|wed|-|-|architecture',
        'warning',
        'Architecture wants Wednesday but is not planned then',
        'No day planned',
      ),
      anIssue(
        'overflow-used|thu|floor-4|f4-bench|portal',
        'warning',
        'Customer Portal uses 3 overflow seats on Thursday',
        'Touchdown bench 3',
      ),
      anIssue(
        'wish-unmet|fri|-|-|portal',
        'warning',
        'Customer Portal wants Friday but is not planned then',
        'Planned: Tuesday and Thursday',
      ),
      // Notes
      anIssue(
        'team-scattered|tue|floor-4|-|underwriting',
        'info',
        'Underwriting sits in 2 separate places on Floor 4 on Tuesday',
        'NE 3, NE 4 / SE 5',
      ),
      anIssue(
        'team-scattered|tue|floor-4|-|portal',
        'info',
        'Customer Portal sits in 2 separate places on Floor 4 on Tuesday',
        'SE 1 / Touchdown bench',
      ),
      anIssue(
        'team-scattered|wed|floor-4|-|underwriting',
        'info',
        'Underwriting sits in 2 separate places on Floor 4 on Wednesday',
        'NE 3, NE 4 / SE 5',
      ),
      anIssue(
        'seat-differs|thu|floor-4|-|claims',
        'info',
        'Claims Intake sits somewhere else on Thursday',
        'Thursday: Floor 4: SW 1, SW 2, SW 3, SW 4. Other days: Floor 4: NE 1, NE 2, NE 3',
      ),
      anIssue(
        'team-scattered|thu|floor-4|-|portal',
        'info',
        'Customer Portal sits in 2 separate places on Floor 4 on Thursday',
        'SE 1 / Touchdown bench',
      ),
      anIssue('no-team-days|-|-|-|architecture', 'info', 'Architecture has no team day yet', 'Wanted: Wednesday'),
    ])
  })

  it('follows the rules of form and adds up', () => {
    expectWellFormed(p, issues)
    expect(summarizeIssues(p, issues)).toEqual({ conflicts: 2, teamsToSeat: 3, warnings: 5, notes: 6, accepted: 0 })
    expect(worstSeverity(issues, { day: 'tue' })).toBe('error')
    expect(worstSeverity(issues, { day: 'thu' })).toBe('warning')
    expect(worstSeverity(issues, { areaId: 'f4-ne3' })).toBe('error')
    expect(worstSeverity(issues, { teamId: 'architecture' })).toBe('warning')
  })

  it('is quiet again once the plan is put right', () => {
    const fixed = project(
      [realFloor],
      [
        team('claims', 9, ['tue', 'thu'], { 'f4-ne1': 4, 'f4-ne2': 2, 'f4-ne3': 3 }, { name: 'Claims Intake' }),
        // Next to Claims Intake on Wednesday, when the north-east row is free.
        team('underwriting', 10, ['wed'], { 'f4-ne1': 4, 'f4-ne2': 2, 'f4-ne3': 4 }, { name: 'Underwriting' }),
        team('policy', 8, ['mon', 'wed'], { 'f4-n1': 4, 'f4-n2': 4 }, { name: 'Policy Admin' }),
        team('portal', 7, ['tue', 'thu'], { 'f4-se1': 4, 'f4-se2': 3 }, { name: 'Customer Portal' }),
        team('data', 6, ['tue'], { 'f4-se3': 2, 'f4-se4': 4 }, { name: 'Data Platform' }),
      ],
      { reserve: 0.1 },
    )
    expect(violations(fixed)).toEqual([])
    expect(findIssues(fixed)).toEqual([])
  })
})
