import { describe, expect, it } from 'vitest'
import { exampleTeams, startingProject } from '../state/seed'
import { nextTeamColor, TEAM_COLORS } from './color'
import {
  csvSeparatorFor,
  exportFileName,
  normalizeProject,
  parseProjectFile,
  parseTeamsText,
  ProjectFormatError,
  seatingCsv,
  serializeProject,
} from './files'
import { makeArea, makeFloor, MIN_RECT_SIZE } from './model'
import { reduce } from './reducer'
import { area, floor, project, team, violations } from './testkit'
import { WEEKDAYS, type Project } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The entry at `index`; fails the test when there is none. */
function nth<T>(list: readonly T[], index: number): T {
  const entry = list[index]
  if (entry === undefined) throw new Error(`nothing at index ${index}`)
  return entry
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/** A small deterministic random generator (mulberry32), so that a failure can be repeated. */
function randomSource(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A text of `length` pieces drawn at random from `pieces`. */
function randomText(random: () => number, pieces: readonly string[], length: number): string {
  let text = ''
  for (let i = 0; i < length; i += 1) text += nth(pieces, Math.floor(random() * pieces.length))
  return text
}

/** Normalizes `input` and checks what must hold for EVERY input that is accepted: the input
 *  is left alone, the result breaks no invariant, it survives being written to a file (no
 *  NaN, no -0, nothing undefined), and normalizing it again changes nothing. */
function repaired(input: unknown): Project {
  const before = structuredClone(input)
  // Frozen, so that any attempt to write to the input throws.
  const result = normalizeProject(deepFreeze(input))
  // Not the strict comparison: that one stumbles over a field called "constructor".
  expect(input).toEqual(before)
  expect(violations(result)).toEqual([])
  expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
  expect(normalizeProject(result)).toStrictEqual(result)
  return result
}

/** The message with which `input` is refused; fails the test when it is accepted or when
 *  something other than a ProjectFormatError is thrown. */
function refusal(input: unknown): string {
  try {
    normalizeProject(input)
  } catch (error) {
    if (error instanceof ProjectFormatError) return error.message
    throw error
  }
  throw new Error('the input was accepted')
}

/** What a damaged or hostile file could hold around the given floors and teams. */
function rawProject(floors: unknown[], teams: unknown[] = [], rest: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, name: 'Raw', floors, teams, ...rest }
}

/** A raw floor "f1" with areas a1, a2, ... of four desks each. */
function rawFloor(areaCount: number): Record<string, unknown> {
  return { id: 'f1', name: 'Floor 1', areas: Array.from({ length: areaCount }, (_, i) => area(`a${i + 1}`, 4)) }
}

/** A project as the app itself makes it: the bundled floor and a second one, the example
 *  teams, seats (with a day that differs and a day without seats), changed settings and an
 *  accepted warning. */
function appProject(): Project {
  let p = startingProject()
  const ground = makeFloor({ name: 'Ground floor' })
  p = reduce(p, { type: 'floor/add', floor: ground })
  p = reduce(p, { type: 'area/add', floorId: ground.id, area: makeArea(ground, { x: 0.2, y: 0.3, w: 0.25, h: 0.2 }) })
  p = reduce(p, exampleTeams(p).action)
  const intake = nth(p.teams, 0) // Tuesday and Thursday
  const handling = nth(p.teams, 1)
  const underwriting = nth(p.teams, 2) // Tuesday and Wednesday
  return reduce(p, {
    type: 'batch',
    actions: [
      { type: 'seat/set', teamId: intake.id, areaId: 'f4-nw1', seats: 6, scope: 'all' },
      { type: 'seat/set', teamId: intake.id, areaId: 'f4-nw2', seats: 3, scope: 'all' },
      { type: 'seat/set', teamId: intake.id, areaId: 'f4-se1', seats: 4, scope: 'thu' },
      { type: 'seat/set', teamId: handling.id, areaId: 'f4-bench', seats: 5, scope: 'all' },
      { type: 'seat/set', teamId: underwriting.id, areaId: 'f4-n1', seats: 4, scope: 'all' },
      { type: 'seat/set', teamId: underwriting.id, areaId: 'f4-n2', seats: 4, scope: 'all' },
      { type: 'seat/clear', teamId: underwriting.id, scope: 'tue' },
      { type: 'team/update', id: handling.id, patch: { attendance: 0.8, homeFloorId: 'floor-4', notes: 'Near the window.' } },
      { type: 'team/setPlanned', id: handling.id, day: 'fri', planned: true },
      { type: 'settings/update', patch: { attendance: 0.9, reserve: 0.1 } },
      { type: 'issue/accept', id: `overflow-used|tue|-|-|${handling.id}`, note: 'Agreed', detail: '5 overflow seats' },
    ],
  })
}

// ---------------------------------------------------------------------------
// normalizeProject
// ---------------------------------------------------------------------------

describe('normalizeProject on what the app itself makes', () => {
  it('returns the starting project unchanged', () => {
    const p = startingProject()
    expect(nth(p.floors, 0).plan?.src.startsWith('data:image/')).toBe(true)
    expect(repaired(p)).toStrictEqual(p)
  })

  it('returns a planned project unchanged, as new objects', () => {
    const p = appProject()
    // The fixture really has what it is meant to have.
    expect(violations(p)).toEqual([])
    expect(nth(p.teams, 0).daySeating).toStrictEqual({ thu: { 'f4-nw1': 6, 'f4-nw2': 3, 'f4-se1': 4 } })
    expect(nth(p.teams, 2).daySeating).toStrictEqual({ tue: {} })
    expect(Object.keys(p.accepted)).toHaveLength(1)

    const result = repaired(p)
    expect(result).toStrictEqual(p)
    expect(result).not.toBe(p)
    expect(result.floors).not.toBe(p.floors)
    expect(nth(result.teams, 0).seating).not.toBe(nth(p.teams, 0).seating)
  })

  it('comes back the same from a file', () => {
    const p = appProject()
    expect(parseProjectFile(serializeProject(p))).toStrictEqual({ ok: true, project: p })
  })

  it('takes the envelope of a file as well as a bare project', () => {
    const p = project([floor('f1', [area('a1', 4)])], [team('alpha', 3, ['mon'], { a1: 3 })])
    expect(repaired(p)).toStrictEqual(p)
    expect(repaired({ app: 'team-day-planner', schemaVersion: 1, savedAt: '2026-11-27T09:30:00.000Z', project: p })).toStrictEqual(p)
    // Nothing but the project inside counts.
    expect(repaired({ project: p })).toStrictEqual(p)
    expect(repaired({ app: 'something else', savedAt: 12, project: p })).toStrictEqual(p)
  })

  it('reads an object that has floors and teams as the project, whatever else it carries', () => {
    const p = project([floor('f1', [])])
    expect(repaired({ ...p, project: { floors: 'unrelated' } })).toStrictEqual(p)
  })
})

describe('normalizeProject refuses', () => {
  const notAPlannerFile = 'This is not a planner file.'
  const newerVersion = 'This file was made with a newer version of the planner. Update the planner to open it.'
  const tooLarge = 'This file is too large to be a seating plan.'

  it('what is not an object', () => {
    for (const input of [null, undefined, 42, 'text', true, Number.NaN, [], [{ floors: [], teams: [] }], () => ({})]) {
      expect(refusal(input)).toBe(notAPlannerFile)
    }
  })

  it('an object without a floors array or without a teams array', () => {
    const inputs = [
      {},
      { teams: [] },
      { floors: [] },
      { floors: {}, teams: [] },
      { floors: 'none', teams: [] },
      { floors: [], teams: null },
      { floors: [], teams: { length: 0 } },
      { project: null },
      { project: [] },
      { project: {} },
      { project: { floors: [] } },
      { app: 'team-day-planner', schemaVersion: 1, savedAt: 'now', project: 'gone' },
    ]
    for (const input of inputs) expect(refusal(input)).toBe(notAPlannerFile)
  })

  it('floors and teams that are only inherited', () => {
    expect(refusal(Object.create({ floors: [], teams: [] }))).toBe(notAPlannerFile)
  })

  it('a file from a newer version, also when it has another shape', () => {
    const inputs = [
      { schemaVersion: 3, floors: [], teams: [] },
      { schemaVersion: 2.5, floors: [], teams: [] },
      { schemaVersion: Number.POSITIVE_INFINITY, floors: [], teams: [] },
      { app: 'team-day-planner', schemaVersion: 3, savedAt: 'now', project: { schemaVersion: 2, floors: [], teams: [] } },
      { app: 'team-day-planner', schemaVersion: 2, savedAt: 'now', project: { schemaVersion: 4, floors: [], teams: [] } },
      { app: 'team-day-planner', schemaVersion: 3, savedAt: 'now', building: { levels: [] } },
      { schemaVersion: 3, project: { building: {} } },
    ]
    for (const input of inputs) expect(refusal(input)).toBe(newerVersion)
  })

  it('no version that is not a number above 2: the result is always version 2', () => {
    for (const schemaVersion of [2, 1, 0, -4, '3', null, undefined, Number.NaN, {}, [3]]) {
      expect(repaired({ schemaVersion, floors: [], teams: [] }).schemaVersion).toBe(2)
    }
  })

  it('more than 200 floors, 2000 areas on a floor or 5000 teams', () => {
    const many = (count: number) => Array.from({ length: count }, () => ({}))
    expect(refusal({ floors: many(201), teams: [] })).toBe(tooLarge)
    expect(refusal({ floors: [{ areas: many(2001) }], teams: [] })).toBe(tooLarge)
    expect(refusal({ floors: [{}, { areas: many(2001) }], teams: [] })).toBe(tooLarge)
    expect(refusal({ floors: [], teams: many(5001) })).toBe(tooLarge)
    // An array that only claims to be long is refused before anything is read from it.
    expect(refusal({ floors: new Array(1_000_000), teams: [] })).toBe(tooLarge)
    expect(refusal({ project: { floors: [], teams: many(5001) } })).toBe(tooLarge)
  })

  it('but takes exactly 200 floors, 2000 areas and 5000 teams', () => {
    const many = (count: number, entry: object = {}) => Array.from({ length: count }, () => entry)
    expect(repaired({ floors: many(200), teams: [] }).floors).toHaveLength(200)
    expect(nth(repaired({ floors: [{ areas: many(2000) }], teams: [] }).floors, 0).areas).toHaveLength(2000)
    // With a code and a colour, as in every file the app writes: finding ones that are not
    // in use for 5000 teams would take a second or two.
    const result = normalizeProject({ floors: [], teams: many(5000, { code: 'T', color: '#0f8b8d' }) })
    expect(result.teams).toHaveLength(5000)
    expect(violations(result)).toEqual([])
  })

  it('what is an object but has no floors and teams of its own, such as a map or a date', () => {
    for (const input of [new Map([['floors', []]]), new Set(), new Date(), /floors/, new Error('teams')]) {
      expect(refusal(input)).toBe(notAPlannerFile)
    }
  })
})

describe('normalizeProject repairs ids', () => {
  const pattern = /^[A-Za-z0-9_-]{1,64}$/
  const longest = 'x'.repeat(64)

  it('keeps well formed ids and replaces bad and duplicate ones', () => {
    const result = repaired(
      rawProject(
        [
          {
            id: 'f1',
            areas: [
              { id: 'a1' },
              { id: 'a1' },
              { id: 'has space' },
              { id: 7 },
              { id: '__proto__' },
              { id: 'constructor' },
              { id: 'prototype' },
              { id: 'toString' },
              { id: `${longest}x` },
              { id: longest },
              { id: '' },
              {},
            ],
          },
          { id: 'f1', areas: [{ id: 'a1' }, { id: 'A1' }, { id: 'Zone_2-b' }] },
          { id: null },
        ],
        [{ id: 't1' }, { id: 't1' }, { id: {} }, { id: 'valueOf' }],
      ),
    )
    const first = nth(result.floors, 0)
    const second = nth(result.floors, 1)
    const firstAreaIds = first.areas.map((a) => a.id)
    const secondAreaIds = second.areas.map((a) => a.id)

    expect(first.id).toBe('f1')
    expect(second.id).not.toBe('f1')
    // The first of two keeps the id; every other bad id is gone.
    expect(firstAreaIds[0]).toBe('a1')
    expect(firstAreaIds[9]).toBe(longest)
    expect(firstAreaIds.filter((id) => id === 'a1' || id === longest)).toHaveLength(2)
    expect(firstAreaIds).toHaveLength(12)
    // Area ids are unique across floors; ids differ by case.
    expect(secondAreaIds[0]).not.toBe('a1')
    expect(secondAreaIds.slice(1)).toEqual(['A1', 'Zone_2-b'])
    expect(nth(result.teams, 0).id).toBe('t1')

    const groups = [result.floors.map((f) => f.id), [...firstAreaIds, ...secondAreaIds], result.teams.map((t) => t.id)]
    for (const ids of groups) {
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) {
        expect(id).toMatch(pattern)
        expect(id in {}).toBe(false) // not a name that every object answers to
        expect(id).not.toBe('prototype')
      }
    }
  })

  it('leaves what referred to a duplicated id with the first that has it', () => {
    const result = repaired(
      rawProject(
        [
          { id: 'f1', name: 'First', areas: [{ id: 'a1', capacity: 4 }] },
          { id: 'f1', name: 'Second', areas: [{ id: 'a1', capacity: 4 }] },
        ],
        [{ id: 't1', days: ['mon'], homeFloorId: 'f1', seating: { a1: 2 } }],
      ),
    )
    const alpha = nth(result.teams, 0)
    expect(alpha.homeFloorId).toBe(nth(result.floors, 0).id)
    expect(alpha.seating).toStrictEqual({ [nth(nth(result.floors, 0).areas, 0).id]: 2 })
  })

  it('drops what referred to a replaced id instead of guessing', () => {
    const result = repaired(
      rawProject(
        [{ id: 'floor one', areas: [{ id: 'desk island', capacity: 6 }, { id: 'a2', capacity: 6 }] }],
        [
          {
            id: 't1',
            days: ['mon', 'tue'],
            homeFloorId: 'floor one',
            seating: { 'desk island': 4, a2: 1 },
            daySeating: { mon: { 'desk island': 2 } },
          },
        ],
      ),
    )
    const alpha = nth(result.teams, 0)
    expect(alpha.homeFloorId).toBeNull()
    expect(alpha.seating).toStrictEqual({ a2: 1 })
    // What is left of Monday's exception is "no seats", which differs from the normal seats.
    expect(alpha.daySeating).toStrictEqual({ mon: {} })
  })

  it('does not take the id of a floor for an area or the other way round', () => {
    const result = repaired(
      rawProject([{ id: 'f1', areas: [{ id: 'a1', capacity: 4 }] }], [{ days: ['mon'], homeFloorId: 'a1', seating: { f1: 2 } }]),
    )
    expect(nth(result.teams, 0).homeFloorId).toBeNull()
    expect(nth(result.teams, 0).seating).toStrictEqual({})
  })
})

describe('normalizeProject repairs text', () => {
  it('trims names and numbers the nameless by their place in the list', () => {
    const result = repaired({
      name: '  Head office  ',
      floors: [
        { name: '  Ground floor ', areas: [{ name: ' Bench ' }, { name: '' }, null, { name: 12 }, { name: '\t\n ' }] },
        { name: '' },
        'not a floor',
        { name: 42 },
        { name: '   ' },
        {},
      ],
      teams: [{ name: ' Claims ' }, { name: null }, [], {}, { name: '' }],
    })
    expect(result.name).toBe('Head office')
    expect(result.floors.map((f) => f.name)).toEqual(['Ground floor', 'Floor 2', 'Floor 3', 'Floor 4', 'Floor 5'])
    expect(nth(result.floors, 0).areas.map((a) => a.name)).toEqual(['Bench', 'Area 2', 'Area 3', 'Area 4'])
    expect(result.teams.map((t) => t.name)).toEqual(['Claims', 'Team 2', 'Team 3', 'Team 4'])
  })

  it('calls a project without a usable name "Office plan"', () => {
    for (const name of ['', '   ', null, 7, ['Plan'], { toString: 'x' }, undefined]) {
      expect(repaired({ name, floors: [], teams: [] }).name).toBe('Office plan')
    }
  })

  it('cuts names at 120 characters, notes at 2000 and groups at 60', () => {
    const result = repaired(
      rawProject(
        [{ name: 'n'.repeat(500), areas: [{ name: 'a'.repeat(121) }] }],
        [
          { name: 't'.repeat(121), group: 'g'.repeat(61), notes: 'x'.repeat(2001) },
          { name: 't'.repeat(120), group: 'g'.repeat(60), notes: 'x'.repeat(2000) },
        ],
        { name: ` ${'p'.repeat(200)}` },
      ),
    )
    expect(result.name).toBe('p'.repeat(120))
    expect(nth(result.floors, 0).name).toBe('n'.repeat(120))
    expect(nth(nth(result.floors, 0).areas, 0).name).toBe('a'.repeat(120))
    for (const t of result.teams) {
      expect(t.name).toBe('t'.repeat(120))
      expect(t.notes).toBe('x'.repeat(2000))
    }
    // The old group of both became one domain, its name cut at 60 characters.
    expect(result.domains.map((d) => d.name)).toEqual(['g'.repeat(60)])
    expect(result.teams.every((t) => t.domainId === nth(result.domains, 0).id)).toBe(true)
  })

  it('leaves no space and no half character where a name was cut', () => {
    const result = repaired(
      rawProject([], [{ name: `${'a'.repeat(119)} bcd` }, { name: `${'a'.repeat(119)}😀` }, { name: `${'a'.repeat(118)}😀!` }]),
    )
    expect(result.teams.map((t) => t.name)).toEqual(['a'.repeat(119), 'a'.repeat(119), `${'a'.repeat(118)}😀`])
  })

  it('keeps notes as typed, and empties those that are not text', () => {
    const result = repaired(
      rawProject([], [{ notes: ' line one\nline two ' }, { notes: false }, { notes: {} }]),
    )
    expect(result.teams.map((t) => t.notes)).toEqual([' line one\nline two ', '', ''])
  })

  it('cuts floor labels at 3 characters and makes a missing one from the name', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: 'Floor 12' }, '12'],
      [{ name: 'Ground floor', label: null }, 'G'],
      [{ name: 'Level -1', label: 9 }, '-1'],
      [{ name: '***', label: ['4'] }, '?'],
      [{ name: 'Basement', label: 'LOWER' }, 'LOW'],
      [{ name: 'Floor 4', label: '4A' }, '4A'],
      [{ name: 'Lobby', label: '😀😀' }, '😀'],
      [{ label: 'X' }, 'X'],
      // What the planner typed stays as typed, also when that is nothing.
      [{ name: 'Floor 5', label: '' }, ''],
      [{ name: 'Floor 6', label: ' 6 ' }, ' 6 '],
    ]
    const result = repaired(rawProject(cases.map(([raw]) => raw)))
    expect(result.floors.map((f) => f.label)).toEqual(cases.map(([, label]) => label))
  })

  it('cuts team codes at 4 characters and gives a missing one that no earlier team has', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: 'Claims Alpha', code: 'CA' }, 'CA'],
      [{ name: 'Customer Area' }, 'CA2'],
      [{ name: 'Underwriting', code: 'UNDERW' }, 'UNDE'],
      [{ name: 'Data Platform', code: 5 }, 'DP'],
      [{ name: 'Ops', code: null }, 'OPS'],
      // What the planner typed stays as typed, also when that is nothing.
      [{ name: 'Claims Advice', code: '' }, ''],
      [{ name: 'Claims Archive', code: ' X ' }, ' X '],
      [{ name: 'Customer Advice', code: {} }, 'CA3'],
    ]
    const result = repaired(rawProject([], cases.map(([raw]) => raw)))
    expect(result.teams.map((t) => t.code)).toEqual(cases.map(([, code]) => code))
  })
})

describe('normalizeProject repairs floors and areas', () => {
  const embedded = 'data:image/png;base64,iVBORw0KGgo='

  it('keeps a plan that is embedded in the file, without anything extra', () => {
    const result = repaired(rawProject([{ plan: { src: embedded, width: 800, height: 600.5, href: 'http://example.com' } }]))
    expect(nth(result.floors, 0).plan).toStrictEqual({ src: embedded, width: 800, height: 600.5 })
  })

  it('never keeps a plan that would be loaded from somewhere else', () => {
    const sources = [
      'http://example.com/plan.png',
      'https://example.com/plan.png',
      '//example.com/plan.png',
      '/plans/floor.png',
      'file:///C:/plan.png',
      'blob:https://example.com/1234',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:,',
      ` ${embedded}`,
      'DATA:IMAGE/PNG;base64,iVBORw0KGgo=',
      '',
      7,
      null,
      { toString: embedded },
      [embedded],
    ]
    const result = repaired(rawProject(sources.map((src) => ({ plan: { src, width: 800, height: 600 } }))))
    expect(result.floors).toHaveLength(sources.length)
    expect(result.floors.map((f) => f.plan)).toEqual(sources.map(() => null))
    expect(JSON.stringify(result)).not.toContain('example.com')
  })

  it('drops a plan without a real size, and a plan that is not an object', () => {
    const sizes: [unknown, unknown][] = [
      [0, 600],
      [800, 0],
      [-800, 600],
      [Number.NaN, 600],
      [800, Number.POSITIVE_INFINITY],
      ['800', 600],
      [800, null],
      [undefined, undefined],
    ]
    const plans = [...sizes.map(([width, height]) => ({ src: embedded, width, height })), embedded, [], 42, true]
    const result = repaired(rawProject(plans.map((plan) => ({ plan }))))
    expect(result.floors.map((f) => f.plan)).toEqual(plans.map(() => null))
  })

  it('makes areas of what is not an array an empty list', () => {
    const result = repaired(rawProject([{ areas: null }, { areas: { 0: { id: 'a1' } } }, { areas: 'a1' }, {}]))
    expect(result.floors.map((f) => f.areas)).toEqual([[], [], [], []])
  })

  it('turns an unknown kind of area into desks', () => {
    const kinds = ['desks', 'overflow', 'no-seating', 'room', '', null, 3, 'constructor', 'toString', ['overflow'], 'Desks']
    const result = repaired(rawProject([{ areas: kinds.map((kind) => ({ kind })) }]))
    expect(nth(result.floors, 0).areas.map((a) => a.kind)).toEqual([
      'desks',
      'overflow',
      'no-seating',
      ...kinds.slice(3).map(() => 'desks'),
    ])
  })

  it('makes every capacity a whole number from 0 to 1000', () => {
    const cases: [unknown, number][] = [
      [4, 4],
      [0, 0],
      [-3, 0],
      [2.6, 3],
      [2.4, 2],
      [-0.2, 0],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
      [Number.NEGATIVE_INFINITY, 0],
      ['12', 0],
      [null, 0],
      [undefined, 0],
      [true, 0],
      [[6], 0],
      [1000, 1000],
      [1000.4, 1000],
      [5000, 1000],
      [1e308, 1000],
    ]
    const result = repaired(rawProject([{ areas: cases.map(([capacity]) => ({ capacity })) }]))
    expect(nth(result.floors, 0).areas.map((a) => a.capacity)).toEqual(cases.map(([, expected]) => expected))
  })

  it('brings every rectangle inside the plan', () => {
    const smallest = { x: 0, y: 0, w: MIN_RECT_SIZE, h: MIN_RECT_SIZE }
    const cases: [unknown, { x: number; y: number; w: number; h: number }][] = [
      [{ x: 0.5, y: 0.25, w: 0.25, h: 0.125 }, { x: 0.5, y: 0.25, w: 0.25, h: 0.125 }],
      [{ x: 0.75, y: 0.75, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
      [{ x: -1, y: 2, w: 5, h: 0 }, { x: 0, y: 1 - MIN_RECT_SIZE, w: 1, h: MIN_RECT_SIZE }],
      [{ x: -0, y: -0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 0.5, h: 0.5 }],
      [{ x: Number.NaN, y: Number.POSITIVE_INFINITY, w: 'wide', h: null }, smallest],
      [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5, w: MIN_RECT_SIZE, h: MIN_RECT_SIZE }],
      [[0.1, 0.1, 0.2, 0.2], smallest],
      ['0.1 0.1 0.2 0.2', smallest],
      [null, smallest],
      [undefined, smallest],
    ]
    const result = repaired(rawProject([{ areas: cases.map(([rect]) => ({ rect })) }]))
    expect(nth(result.floors, 0).areas.map((a) => a.rect)).toStrictEqual(cases.map(([, expected]) => expected))
  })
})

describe('normalizeProject repairs teams', () => {
  it('makes every team size a whole number from 0 to 5000', () => {
    const cases: [unknown, number][] = [
      [8, 8],
      [7.5, 8],
      [7.4, 7],
      [-2, 0],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
      ['8', 0],
      [null, 0],
      [5000, 5000],
      [99999, 5000],
    ]
    const result = repaired(rawProject([], cases.map(([size]) => ({ size }))))
    expect(result.teams.map((t) => t.size)).toEqual(cases.map(([, expected]) => expected))
  })

  it('writes colours as #rrggbb and gives a team without one the colour used least so far', () => {
    const result = repaired(
      rawProject([], [{ color: '#0F8B8D' }, { color: 'abc' }, { color: 'red' }, { color: 0xff0000 }, {}, { color: ' #E2711D ' }]),
    )
    const expected = ['#0f8b8d', '#aabbcc']
    for (let i = 0; i < 3; i += 1) expected.push(nextTeamColor(expected))
    expected.push('#e2711d')
    expect(result.teams.map((t) => t.color)).toEqual(expected)
    // Teal is taken by the first team, so the first team without a colour gets the next one.
    expect(nth(result.teams, 2).color).toBe(TEAM_COLORS[1])
  })

  it('finds a free code and the least used colour for each of many teams that have none', () => {
    const result = repaired(rawProject([], Array.from({ length: 96 }, () => ({}))))
    expect(new Set(result.teams.map((t) => t.code)).size).toBe(96)
    // Sixteen colours, so each is used six times.
    for (const color of TEAM_COLORS) expect(result.teams.filter((t) => t.color === color)).toHaveLength(6)
  })

  it('reads the wish for each of the five weekdays and nothing else', () => {
    const result = repaired(
      rawProject(
        [],
        [
          { wishes: { mon: 'want', tue: 'can', wed: 'cannot', thu: 'none', fri: 'maybe', sat: 'want' } },
          { wishes: { mon: 5, tue: null, wed: 'WANT', thu: ['want'] } },
          { wishes: ['want', 'want', 'want', 'want', 'want'] },
          { wishes: 'want' },
          {},
        ],
      ),
    )
    const none = { mon: 'none', tue: 'none', wed: 'none', thu: 'none', fri: 'none' }
    expect(result.teams.map((t) => t.wishes)).toStrictEqual([
      { mon: 'want', tue: 'can', wed: 'cannot', thu: 'none', fri: 'none' },
      none,
      none,
      none,
      none,
    ])
  })

  it('keeps only real weekdays as team days, each once and in week order', () => {
    const result = repaired(
      rawProject(
        [],
        [
          { days: ['thu', 'mon', 'thu', 'sat', 3, null, 'Mon', ['tue'], 'fri'] },
          { days: 'mon' },
          { days: { 0: 'mon', length: 1 } },
          { days: null },
          {},
        ],
      ),
    )
    expect(result.teams.map((t) => t.days)).toEqual([['mon', 'thu', 'fri'], [], [], [], []])
  })

  it('keeps an attendance between 0.1 and 1 and falls back to the project setting otherwise', () => {
    const cases: [unknown, number | null][] = [
      [null, null],
      [0.5, 0.5],
      [1, 1],
      [0, 0.1],
      [-1, 0.1],
      [0.05, 0.1],
      [3, 1],
      [Number.NaN, null],
      [Number.POSITIVE_INFINITY, null],
      ['0.5', null],
      [undefined, null],
      [{}, null],
    ]
    const result = repaired(rawProject([], cases.map(([attendance]) => ({ attendance }))))
    expect(result.teams.map((t) => t.attendance)).toEqual(cases.map(([, expected]) => expected))
  })

  it('keeps a preferred floor only when that floor exists', () => {
    const result = repaired(
      rawProject(
        [{ id: 'f1' }, { id: 'f2' }],
        [{ homeFloorId: 'f2' }, { homeFloorId: 'f3' }, { homeFloorId: 2 }, { homeFloorId: ['f1'] }, { homeFloorId: 'toString' }, {}],
      ),
    )
    expect(result.teams.map((t) => t.homeFloorId)).toEqual(['f2', null, null, null, null, null])
  })

  it('keeps only whole seat counts of 1 to 1000, in areas that exist', () => {
    const seating = {
      a1: 2,
      a2: 0,
      a3: -1,
      a4: 0.4,
      a5: 2.5,
      a6: Number.NaN,
      a7: Number.POSITIVE_INFINITY,
      a8: '3',
      a9: 1e6,
      a10: 0.5,
      a11: null,
      a12: { seats: 2 },
      ghost: 2,
      toString: 3,
    }
    const result = repaired(rawProject([rawFloor(12)], [{ days: ['mon'], seating }]))
    expect(nth(result.teams, 0).seating).toStrictEqual({ a1: 2, a5: 3, a9: 1000, a10: 1 })
  })

  it('makes a seating that is not an object empty', () => {
    const result = repaired(
      rawProject([rawFloor(2)], [{ seating: [2, 3] }, { seating: null }, { seating: 'a1' }, { seating: 4 }, {}]),
    )
    expect(result.teams.map((t) => t.seating)).toStrictEqual([{}, {}, {}, {}, {}])
  })

  it('keeps seats that are a conflict: the planner must see them, not lose them', () => {
    const raw = project(
      [floor('f1', [area('a1', 4), area('room', 6, { kind: 'no-seating' })])],
      [team('alpha', 9, ['mon'], { a1: 9, room: 2 }), team('beta', 4, ['mon'], { a1: 4 })],
    )
    expect(repaired(raw)).toStrictEqual(raw)
  })

  it('keeps a day exception only for a team day', () => {
    const result = repaired(
      rawProject(
        [rawFloor(3)],
        [
          {
            days: ['tue', 'thu'],
            seating: { a1: 2 },
            daySeating: { mon: { a2: 1 }, tue: { a2: 2 }, wed: {}, fri: { a1: 1 }, sat: { a1: 1 }, 0: { a1: 1 } },
          },
        ],
      ),
    )
    expect(nth(result.teams, 0).daySeating).toStrictEqual({ tue: { a2: 2 } })
  })

  it('drops an exception that equals the normal seating, also when it only does so after cleaning', () => {
    const result = repaired(
      rawProject(
        [rawFloor(3)],
        [
          {
            days: ['mon', 'tue', 'wed'],
            seating: { a1: 2, a2: 1 },
            daySeating: { mon: { a2: 1, a1: 2 }, tue: { a1: 2.2, a2: 1, ghost: 5, a3: 0 }, wed: { a1: 2 } },
          },
          // Without normal seats, an empty exception is no exception either.
          { days: ['mon'], seating: {}, daySeating: { mon: {} } },
          { days: ['mon'], seating: { ghost: 3 }, daySeating: { mon: { ghost: 1 } } },
        ],
      ),
    )
    expect(result.teams.map((t) => t.daySeating)).toStrictEqual([{ wed: { a1: 2 } }, {}, {}])
  })

  it('keeps an EMPTY exception that differs from the normal seating: no seats on that day', () => {
    const result = repaired(
      rawProject([rawFloor(2)], [{ days: ['tue', 'thu'], seating: { a1: 2 }, daySeating: { thu: {} } }]),
    )
    const alpha = nth(result.teams, 0)
    expect(alpha.daySeating).toStrictEqual({ thu: {} })
    expect(Object.hasOwn(alpha.daySeating, 'thu')).toBe(true)
  })

  it('cleans the seats of an exception like the normal ones', () => {
    const result = repaired(
      rawProject(
        [rawFloor(3)],
        [{ days: ['tue', 'thu'], seating: { a1: 2 }, daySeating: { tue: { a2: 2.4, a3: -1, ghost: 3, a1: 5000 } } }],
      ),
    )
    expect(nth(result.teams, 0).daySeating).toStrictEqual({ tue: { a2: 2, a1: 1000 } })
  })

  it('never leaves the normal seating hidden behind a seating of its own on every team day', () => {
    const result = repaired(
      rawProject(
        [rawFloor(3)],
        [
          // The only team day has its own seating: that IS where the team sits.
          { days: ['tue'], seating: { a1: 2 }, daySeating: { tue: { a2: 2 } } },
          // Both days share one seating of their own: it becomes the normal one.
          { days: ['tue', 'thu'], seating: { a1: 2 }, daySeating: { tue: { a3: 2 }, thu: { a3: 2 } } },
          // Two different ones: the one with more seats becomes normal, the other stays.
          { days: ['tue', 'thu'], seating: { a1: 2 }, daySeating: { tue: {}, thu: { a2: 1 } } },
        ],
      ),
    )
    expect(result.teams.map((t) => [t.seating, t.daySeating])).toStrictEqual([
      [{ a2: 2 }, {}],
      [{ a3: 2 }, {}],
      [{ a2: 1 }, { tue: {} }],
    ])
    expect(violations(result)).toEqual([])
  })

  it('ignores exceptions that are not objects', () => {
    const result = repaired(
      rawProject(
        [rawFloor(2)],
        [
          { days: ['mon', 'tue', 'wed', 'thu'], seating: { a1: 2 }, daySeating: { mon: null, tue: [1], wed: 'a2', thu: 3 } },
          { days: ['mon'], seating: { a1: 2 }, daySeating: [{ a2: 1 }] },
          { days: ['mon'], seating: { a1: 2 }, daySeating: null },
          { days: ['mon'], seating: { a1: 2 }, daySeating: 'mon' },
        ],
      ),
    )
    expect(result.teams.map((t) => t.daySeating)).toStrictEqual([{}, {}, {}, {}])
  })
})

describe('normalizeProject repairs settings and accepted issues', () => {
  it('clamps attendance to 0.1 .. 1 and the reserve to 0 .. 0.5', () => {
    const cases: [unknown, { attendance: number; reserve: number }][] = [
      [{ attendance: 0.8, reserve: 0.2 }, { attendance: 0.8, reserve: 0.2 }],
      [{ attendance: 0, reserve: -1 }, { attendance: 0.1, reserve: 0 }],
      [{ attendance: 7, reserve: 0.9 }, { attendance: 1, reserve: 0.5 }],
      [{ attendance: -0.3, reserve: -0 }, { attendance: 0.1, reserve: 0 }],
      [{ attendance: Number.NaN, reserve: Number.POSITIVE_INFINITY }, { attendance: 1, reserve: 0 }],
      [{ attendance: '0.5', reserve: '0.2' }, { attendance: 1, reserve: 0 }],
      [{ attendance: null }, { attendance: 1, reserve: 0 }],
      [{}, { attendance: 1, reserve: 0 }],
      [null, { attendance: 1, reserve: 0 }],
      [[0.5, 0.2], { attendance: 1, reserve: 0 }],
      ['default', { attendance: 1, reserve: 0 }],
      [undefined, { attendance: 1, reserve: 0 }],
    ]
    for (const [settings, expected] of cases) {
      expect(repaired({ floors: [], teams: [], settings }).settings).toStrictEqual(expected)
    }
  })

  it('keeps well formed accepted issues and drops the rest', () => {
    const result = repaired(
      rawProject([], [], {
        accepted: {
          'wish-unmet|tue|-|-|t1': { note: 'Agreed with the team', detail: 'Tuesday is full' },
          'overflow-used|mon|-|-|t2': { note: '', detail: '', by: 'someone', at: 12 },
          a: { note: 1, detail: 'd' },
          b: { note: 'n' },
          c: { detail: 'd' },
          d: 'accepted',
          e: null,
          f: ['n', 'd'],
          g: true,
        },
      }),
    )
    expect(result.accepted).toStrictEqual({
      'wish-unmet|tue|-|-|t1': { note: 'Agreed with the team', detail: 'Tuesday is full' },
      'overflow-used|mon|-|-|t2': { note: '', detail: '' },
    })
  })

  it('cuts the reason of an accepted issue at 500 characters and keeps its detail whole', () => {
    // The detail is compared with the issue's text as it is: cut short, the acceptance
    // would be forgotten on every reload. Its own bound lies far above any real detail.
    const result = repaired(rawProject([], [], { accepted: { id: { note: 'n'.repeat(501), detail: 'd'.repeat(2000) } } }))
    expect(result.accepted).toStrictEqual({ id: { note: 'n'.repeat(500), detail: 'd'.repeat(2000) } })
    const huge = repaired(rawProject([], [], { accepted: { id: { note: '', detail: 'd'.repeat(6000) } } }))
    expect(huge.accepted.id?.detail).toHaveLength(5000)
  })

  it('takes out characters that cannot be stored', () => {
    // A NUL in any text makes the database refuse the whole plan.
    const result = repaired(
      rawProject(
        [{ name: 'Floor\u0000 4', areas: [{ id: 'a1', name: 'NE\u0000 1' }] }],
        [{ name: 'Claims\u0000 Intake', group: 'Clai\u0001ms', notes: 'line one\nline\u0000 two', days: [] }],
        { name: 'Plan\u0000', accepted: { id: { note: 'fine\u0000', detail: 'de\u0000tail' } } },
      ),
    )
    expect(JSON.stringify(result)).not.toMatch(/\\u0000|\\u0001/)
    expect(nth(result.teams, 0)).toMatchObject({ name: 'Claims Intake', notes: 'line one\nline two' })
    // The group of a version 1 plan became a domain, without the character.
    expect(result.domains.map((d) => d.name)).toEqual(['Claims'])
    expect(nth(result.floors, 0).name).toBe('Floor 4')
    expect(result.name).toBe('Plan')
    // Half of a surrogate pair goes as well; a whole pair stays.
    const pairs = repaired(rawProject([], [{ name: 'Team \ud83d and \ud83d\ude00', days: [] }]))
    expect(nth(pairs.teams, 0).name).toBe('Team  and \ud83d\ude00')
  })

  it('keeps at most 2000 accepted issues', () => {
    const accepted: Record<string, unknown> = { broken: 'not counted' }
    for (let i = 0; i < 2500; i += 1) accepted[`note|mon|-|-|t${i}`] = { note: '', detail: String(i) }
    const result = repaired(rawProject([], [], { accepted }))
    expect(Object.keys(result.accepted)).toHaveLength(2000)
    expect(result.accepted['note|mon|-|-|t0']).toStrictEqual({ note: '', detail: '0' })
    expect(result.accepted['note|mon|-|-|t1999']).toStrictEqual({ note: '', detail: '1999' })
    expect(result.accepted['note|mon|-|-|t2000']).toBeUndefined()
  })

  it('makes accepted issues that are not an object empty', () => {
    for (const accepted of [null, [], [{ note: 'n', detail: 'd' }], 'all', 3, undefined]) {
      expect(repaired(rawProject([], [], { accepted })).accepted).toStrictEqual({})
    }
  })
})

describe('normalizeProject on hostile input', () => {
  const noWishes = { mon: 'none', tue: 'none', wed: 'none', thu: 'none', fri: 'none' }
  const defaultTeam = {
    id: expect.any(String),
    name: 'Team 1',
    code: 'T1',
    size: 0,
    color: TEAM_COLORS[0],
    domainId: null,
    artId: null,
    wishes: noWishes,
    days: [],
    attendance: null,
    homeFloorId: null,
    seating: {},
    daySeating: {},
    notes: '',
  }
  const defaultArea = {
    id: expect.any(String),
    name: 'Area 1',
    kind: 'desks',
    capacity: 0,
    rect: { x: 0, y: 0, w: MIN_RECT_SIZE, h: MIN_RECT_SIZE },
  }

  it('fills in defaults where everything is null', () => {
    const result = repaired({
      schemaVersion: null,
      name: null,
      floors: [null, { id: null, name: null, label: null, plan: null, areas: [null, { id: null, name: null, kind: null, capacity: null, rect: null }] }],
      teams: [
        null,
        {
          id: null,
          name: null,
          code: null,
          size: null,
          color: null,
          group: null,
          wishes: null,
          days: null,
          attendance: null,
          homeFloorId: null,
          seating: null,
          daySeating: null,
          notes: null,
        },
      ],
      settings: null,
      accepted: null,
    })
    expect(result).toStrictEqual({
      schemaVersion: 2,
      name: 'Office plan',
      domains: [],
      arts: [],
      floors: [{ id: expect.any(String), name: 'Floor 1', label: '1', plan: null, areas: [defaultArea] }],
      teams: [defaultTeam],
      settings: { attendance: 1, reserve: 0 },
      accepted: {},
    })
  })

  it('fills in defaults where every type is wrong', () => {
    const result = repaired({
      schemaVersion: '1',
      name: 5,
      floors: [
        7,
        'floor',
        { id: true, name: {}, label: [], plan: 'data:image/png;base64,AAAA', areas: 'none' },
        { id: 1, name: ['Floor'], label: 4, plan: 1, areas: [true, 'area', { id: {}, name: 1, kind: 2, capacity: '4', rect: 'here' }] },
      ],
      teams: [
        false,
        'team',
        {
          id: 3.5,
          name: ['Alpha'],
          code: {},
          size: '12',
          color: 0xff0000,
          group: 7,
          wishes: 'want',
          days: 'mon',
          attendance: '0.5',
          homeFloorId: {},
          seating: 'a1',
          daySeating: 3,
          notes: false,
        },
      ],
      settings: 'default',
      accepted: 'none',
    })
    expect(result).toStrictEqual({
      schemaVersion: 2,
      name: 'Office plan',
      domains: [],
      arts: [],
      floors: [
        { id: expect.any(String), name: 'Floor 1', label: '1', plan: null, areas: [] },
        { id: expect.any(String), name: 'Floor 2', label: '2', plan: null, areas: [defaultArea] },
      ],
      teams: [defaultTeam],
      settings: { attendance: 1, reserve: 0 },
      accepted: {},
    })
  })

  it('finds no fields in other kinds of objects that the browser can store', () => {
    const result = normalizeProject({
      floors: [new Map([['id', 'f1']]), { id: 'f1', plan: new Map(), areas: [{ id: 'a1', rect: new Float64Array([0.1, 0.1, 0.2, 0.2]) }] }],
      teams: [new Date(), { id: 't1', days: new Set(['mon']), wishes: new Map([['mon', 'want']]), seating: new Map([['a1', 2]]) }],
      settings: new Date(),
      accepted: new Map([['a', { note: 'n', detail: 'd' }]]),
    })
    expect(violations(result)).toEqual([])
    // A map or a date is an object without fields of its own: it becomes a thing with defaults.
    expect(result.floors.map((f) => f.name)).toEqual(['Floor 1', 'Floor 2'])
    expect(nth(result.floors, 1).areas).toStrictEqual([{ ...defaultArea, id: 'a1' }])
    expect(result.teams.map((t) => t.name)).toEqual(['Team 1', 'Team 2'])
    expect(nth(result.teams, 1)).toStrictEqual({ ...defaultTeam, id: 't1', name: 'Team 2', code: 'T2', color: TEAM_COLORS[1] })
    expect(result.settings).toStrictEqual({ attendance: 1, reserve: 0 })
    expect(result.accepted).toStrictEqual({})
  })

  it('reads objects only: arrays where objects are expected count as nothing', () => {
    const result = repaired({
      floors: [[{ id: 'f0' }], { id: 'f1', plan: ['data:image/png;base64,AAAA', 10, 10], areas: [[{ id: 'a0' }], { id: 'a1', rect: [0.1, 0.1, 0.2, 0.2] }] }],
      teams: [[{ id: 't0' }], { id: 't1', wishes: ['want'], seating: [1, 2], daySeating: [{}], days: { mon: true } }],
      settings: [0.5, 0.2],
      accepted: [{ note: 'n', detail: 'd' }],
    })
    expect(result.floors.map((f) => f.id)).toEqual(['f1'])
    expect(nth(result.floors, 0).plan).toBeNull()
    expect(nth(result.floors, 0).areas).toStrictEqual([{ ...defaultArea, id: 'a1' }])
    expect(result.teams).toStrictEqual([{ ...defaultTeam, id: 't1' }])
    expect(result.settings).toStrictEqual({ attendance: 1, reserve: 0 })
    expect(result.accepted).toStrictEqual({})
  })

  it('copies known fields only', () => {
    const clean = project(
      [{ ...floor('f1', [area('a1', 4)]), plan: { src: 'data:image/png;base64,AAAA', width: 10, height: 5 } }],
      [team('alpha', 3, ['mon', 'tue'], { a1: 3 }, { daySeating: { tue: {} } })],
    )
    clean.accepted = { 'seat-differs|tue|-|-|alpha': { note: 'ok', detail: 'd' } }
    const withExtras = {
      ...clean,
      extra: 1,
      onload: 'alert(1)',
      floors: clean.floors.map((f) => ({
        ...f,
        secret: true,
        plan: { ...f.plan, alt: 'x', onerror: 'alert(1)' },
        areas: f.areas.map((a) => ({ ...a, tooltip: '<img src=x onerror=alert(1)>', rect: { ...a.rect, z: 9 } })),
      })),
      teams: clean.teams.map((t) => ({
        ...t,
        password: 'x',
        members: ['Ann'],
        wishes: { ...t.wishes, sat: 'want' },
        daySeating: { ...t.daySeating, note: 'x' },
      })),
      settings: { ...clean.settings, theme: 'dark' },
      accepted: { 'seat-differs|tue|-|-|alpha': { note: 'ok', detail: 'd', by: 'x' } },
    }
    expect(repaired(withExtras)).toStrictEqual(clean)
  })

  it('is not fooled by __proto__, constructor and prototype keys', () => {
    const text = `{
      "__proto__": { "polluted": true, "name": "Evil" },
      "constructor": { "prototype": { "polluted": true } },
      "floors": [{
        "id": "f1",
        "__proto__": { "name": "Evil", "label": "666" },
        "areas": [
          { "id": "a1", "capacity": 4, "__proto__": { "kind": "no-seating", "capacity": 99 },
            "rect": { "__proto__": { "x": 0.5 }, "x": 0.25, "y": 0.25, "w": 0.25, "h": 0.25 } },
          { "id": "__proto__", "capacity": 4 },
          { "id": "constructor", "capacity": 4 }
        ]
      }],
      "teams": [{
        "id": "t1",
        "days": ["mon"],
        "__proto__": { "size": 99, "homeFloorId": "f1" },
        "wishes": { "__proto__": { "mon": "want" } },
        "seating": { "__proto__": 3, "constructor": 1, "prototype": 1, "a1": 2 },
        "daySeating": { "__proto__": { "mon": { "a1": 1 } } }
      }],
      "settings": { "__proto__": { "attendance": 0.5, "reserve": 0.5 } },
      "accepted": {
        "__proto__": { "note": "n", "detail": "d" },
        "constructor": { "note": "n", "detail": "d" },
        "prototype": { "note": "n", "detail": "d" },
        "toString": { "note": "n", "detail": "d" },
        "wish-unmet|mon|-|-|t1": { "note": "n", "detail": "d" }
      }
    }`
    const result = repaired(JSON.parse(text))
    const first = nth(result.floors, 0)
    const alpha = nth(result.teams, 0)

    expect(result.name).toBe('Office plan')
    expect(first.name).toBe('Floor 1')
    expect(first.label).toBe('1')
    expect(nth(first.areas, 0)).toStrictEqual({ id: 'a1', name: 'Area 1', kind: 'desks', capacity: 4, rect: { x: 0.25, y: 0.25, w: 0.25, h: 0.25 } })
    expect(first.areas.map((a) => a.id).filter((id) => id === '__proto__' || id === 'constructor')).toEqual([])
    expect(alpha.size).toBe(0)
    expect(alpha.homeFloorId).toBeNull()
    expect(alpha.wishes).toStrictEqual(noWishes)
    expect(alpha.seating).toStrictEqual({ a1: 2 })
    expect(Object.keys(alpha.seating)).toEqual(['a1'])
    expect(alpha.daySeating).toStrictEqual({})
    expect(result.settings).toStrictEqual({ attendance: 1, reserve: 0 })
    expect(Object.keys(result.accepted)).toEqual(['wish-unmet|mon|-|-|t1'])

    // Nothing leaked into a prototype: not of the results, not of all objects.
    for (const made of [result, first, alpha, alpha.seating, alpha.daySeating, alpha.wishes, result.settings, result.accepted]) {
      expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
    }
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
    expect('polluted' in {}).toBe(false)
  })

  it('reads nothing that an object merely inherits', () => {
    const inherited = Object.assign(Object.create({ name: 'Inherited', settings: { attendance: 0.5 } }), { floors: [], teams: [] })
    const result = normalizeProject(inherited)
    expect(result.name).toBe('Office plan')
    expect(result.settings).toStrictEqual({ attendance: 1, reserve: 0 })
  })

  it('survives numbers that JSON turns into infinity', () => {
    const text = `{
      "floors": [{ "id": "f1", "plan": { "src": "data:image/png;base64,AAAA", "width": 1e999, "height": 600 },
        "areas": [{ "id": "a1", "capacity": 1e999, "rect": { "x": 1e999, "y": -1e999, "w": 1e999, "h": -1e999 } }] }],
      "teams": [{ "id": "t1", "size": 1e999, "attendance": 1e999, "days": ["mon"], "seating": { "a1": 1e999 },
        "daySeating": { "mon": { "a1": -1e999 } } }],
      "settings": { "attendance": 1e999, "reserve": -1e999 }
    }`
    const read = parseProjectFile(text)
    if (!read.ok) throw new Error(read.error)
    const result = repaired(read.project)
    expect(nth(result.floors, 0).plan).toBeNull()
    expect(nth(nth(result.floors, 0).areas, 0).capacity).toBe(0)
    expect(nth(nth(result.floors, 0).areas, 0).rect).toStrictEqual({ x: 0, y: 0, w: MIN_RECT_SIZE, h: MIN_RECT_SIZE })
    expect(nth(result.teams, 0)).toMatchObject({ size: 0, attendance: null, seating: {}, daySeating: {} })
    expect(result.settings).toStrictEqual({ attendance: 1, reserve: 0 })
    expect(parseProjectFile('{ "schemaVersion": 1e999, "floors": [], "teams": [] }')).toStrictEqual({
      ok: false,
      error: 'This file was made with a newer version of the planner. Update the planner to open it.',
    })
  })

  it('does not change what it is given', () => {
    const input = {
      name: '  Plan  ',
      floors: [{ id: 'bad id', label: 'TOO LONG', areas: [{ id: 'a1', capacity: -4, rect: { x: 9, y: 9, w: 9, h: 9 } }, null] }],
      teams: [
        { id: 't1', days: ['fri', 'mon', 'mon'], seating: { a1: 2.6, ghost: 1 }, daySeating: { tue: { a1: 1 }, mon: { a1: 3 } }, color: 'RED' },
      ],
      settings: { attendance: 9, reserve: -9 },
      accepted: { x: { note: 'n'.repeat(900), detail: 'd' }, y: 1 },
    }
    const before = structuredClone(input)
    const result = normalizeProject(input)
    expect(input).toStrictEqual(before)
    // Nothing of the input is reused in the result either.
    expect(result.floors).not.toBe(input.floors)
    expect(nth(result.teams, 0).seating).not.toBe(nth(input.teams, 0).seating)
    expect(nth(result.teams, 0).seating).toStrictEqual({ a1: 3 })
  })

  it('changes nothing when it reads its own result again, directly or from a file', () => {
    const once = normalizeProject({
      name: ` ${'n'.repeat(119)} tail`,
      floors: [
        { id: 'f1', name: '', label: 'TOO LONG', areas: [{ id: 'a1', capacity: 3.5, rect: { x: 2, y: -1, w: 0, h: 9 } }, {}, { id: 'a1' }] },
        { id: 'f1', plan: { src: 'https://example.com/plan.png', width: 1, height: 1 } },
      ],
      teams: [
        { days: ['fri', 'mon'], seating: { a1: 1.5 }, daySeating: { mon: {}, fri: { a1: 1.6 } }, color: 'ABC', attendance: 7 },
        { id: 'toString', code: 'LONGCODE', homeFloorId: 'f1', group: 'g'.repeat(99) },
        {},
      ],
      settings: { attendance: -1, reserve: 3 },
      accepted: { a: { note: 'n'.repeat(999), detail: 'd' } },
    })
    expect(violations(once)).toEqual([])
    expect(normalizeProject(once)).toStrictEqual(once)
    expect(normalizeProject(normalizeProject(once))).toStrictEqual(once)
    expect(parseProjectFile(serializeProject(once))).toStrictEqual({ ok: true, project: once })
  })
})

describe('normalizeProject under random damage', () => {
  interface Slot {
    holder: Record<string | number, unknown>
    key: string | number
    path: string
  }

  /** Every place in a JSON value where a value sits: each field and each entry, at any depth. */
  function slotsIn(value: unknown, path = '$', found: Slot[] = []): Slot[] {
    if (typeof value !== 'object' || value === null) return found
    const holder = value as Record<string | number, unknown>
    const keys: (string | number)[] = Array.isArray(value) ? value.map((_, index) => index) : Object.keys(value)
    for (const key of keys) {
      const at = `${path}.${key}`
      found.push({ holder, key, path: at })
      slotsIn(holder[key], at, found)
    }
    return found
  }

  /** What a damaged or hostile file might hold in the place of a value. */
  const DAMAGE: readonly (() => unknown)[] = [
    () => null,
    () => '',
    () => 'x',
    () => 'mon',
    () => 'a1',
    () => 'f1',
    () => '__proto__',
    () => 'http://example.com/plan.png',
    () => 'y'.repeat(5000),
    () => 1e308,
    () => -1e308,
    () => 2 ** 53,
    () => Number.POSITIVE_INFINITY,
    () => Number.NaN,
    () => -0.4,
    () => 2,
    () => ({}),
    () => ({ id: 'a1', a1: 3, b1: -1, mon: { a1: 1 }, tue: {}, note: 'n', detail: 'd', x: 2, w: 2 }),
    () => JSON.parse('{ "__proto__": { "polluted": true }, "constructor": 1, "prototype": 2 }') as unknown,
    () => [],
    () => [null, 'mon', 'mon', 'fri', 7, {}, []],
    () => [{ id: 'a1' }, { id: 'a1' }, { id: 't1', days: ['mon'], seating: { a1: 1e9 } }],
  ]

  const base = project(
    [
      {
        ...floor('f1', [area('a1', 4), area('a2', 6), area('room', 8, { kind: 'no-seating' })], { name: 'Floor 1' }),
        plan: { src: 'data:image/png;base64,iVBORw0KGgo=', width: 1200, height: 800 },
      },
      floor('f2', [area('b1', 4), area('bench', 5, { kind: 'overflow' })], { name: 'Floor 2' }),
    ],
    [
      team('t1', 6, ['mon', 'wed'], { a1: 4, a2: 2 }, { daySeating: { wed: { b1: 4 } }, homeFloorId: 'f1', attendance: 0.8 }),
      team('t2', 4, ['tue'], { b1: 4 }, { domainId: 'claims', artId: 'intake', notes: 'Close to the door' }),
      team('t3', 9, ['mon', 'tue', 'fri'], { a2: 4, bench: 5 }, { daySeating: { fri: {} } }),
    ],
    { attendance: 0.9, reserve: 0.1 },
  )
  base.accepted = { 'overflow-used|mon|-|-|t3': { note: 'Fine for now', detail: '5 overflow seats' } }
  const baseText = JSON.stringify(base)

  /** Checks one damaged input; returns whether it was accepted. */
  function check(input: unknown, what: string): boolean {
    let result: Project
    try {
      // Frozen: writing to the input would throw something that is not a ProjectFormatError.
      result = normalizeProject(deepFreeze(input))
    } catch (error) {
      expect(error, what).toBeInstanceOf(ProjectFormatError)
      return false
    }
    expect(violations(result), what).toEqual([])
    expect(normalizeProject(result), what).toStrictEqual(result)
    return true
  }

  it('starts from a sound project', () => {
    expect(violations(base)).toEqual([])
    expect(repaired(JSON.parse(baseText))).toStrictEqual(base)
  })

  it('either refuses with a readable message or returns a sound project (800 mutations)', () => {
    const random = randomSource(20261127)
    const pick = <T>(list: readonly T[]): T => nth(list, Math.floor(random() * list.length))
    let accepted = 0
    let refused = 0
    for (let round = 0; round < 800; round += 1) {
      const damaged: unknown = JSON.parse(baseText)
      // Mostly one value is damaged; every fourth round three are.
      const changes = round % 4 === 3 ? 3 : 1
      const done: string[] = []
      for (let change = 0; change < changes; change += 1) {
        const slot = pick(slotsIn(damaged))
        const value = pick(DAMAGE)()
        slot.holder[slot.key] = value
        done.push(`${slot.path} = ${JSON.stringify(value).slice(0, 60)}`)
      }
      // Every other round the project arrives in the envelope of a file.
      const input = round % 2 === 0 ? damaged : { app: 'team-day-planner', schemaVersion: 1, savedAt: 'now', project: damaged }
      if (check(input, `round ${round}: ${done.join('; ')}`)) accepted += 1
      else refused += 1
    }
    // The run must have seen both outcomes to mean anything.
    expect(accepted).toBeGreaterThan(400)
    expect(refused).toBeGreaterThan(0)
    expect('polluted' in {}).toBe(false)
  })

  it('handles damage to the envelope itself', () => {
    const random = randomSource(7)
    for (let round = 0; round < 100; round += 1) {
      const envelope = JSON.parse(serializeProject(base)) as Record<string, unknown>
      const key = nth(['app', 'schemaVersion', 'savedAt', 'project'], round % 4)
      const value = nth(DAMAGE, Math.floor(random() * DAMAGE.length))()
      envelope[key] = value
      check(envelope, `round ${round}: ${key} = ${JSON.stringify(value).slice(0, 60)}`)
    }
  })
})

// ---------------------------------------------------------------------------
// Project files
// ---------------------------------------------------------------------------

describe('serializeProject', () => {
  const p = project([floor('f1', [area('a1', 4)])], [team('alpha', 3, ['mon'], { a1: 3 })])
  const savedAt = new Date('2026-11-27T09:30:00.000Z')

  it('writes the envelope with its keys in a fixed order', () => {
    const envelope = JSON.parse(serializeProject(p, savedAt)) as Record<string, unknown>
    expect(Object.keys(envelope)).toEqual(['app', 'schemaVersion', 'savedAt', 'project'])
    expect(envelope).toStrictEqual({ app: 'team-day-planner', schemaVersion: 2, savedAt: '2026-11-27T09:30:00.000Z', project: p })
  })

  it('indents with two spaces', () => {
    const text = serializeProject(p, savedAt)
    expect(text).toBe(
      JSON.stringify({ app: 'team-day-planner', schemaVersion: 2, savedAt: '2026-11-27T09:30:00.000Z', project: p }, null, 2),
    )
    expect(text.split('\n').slice(0, 6)).toEqual([
      '{',
      '  "app": "team-day-planner",',
      '  "schemaVersion": 2,',
      '  "savedAt": "2026-11-27T09:30:00.000Z",',
      '  "project": {',
      '    "schemaVersion": 2,',
    ])
  })

  it('stamps the file with the current time by default', () => {
    const before = Date.now()
    const envelope = JSON.parse(serializeProject(p)) as { savedAt: string }
    const stamp = Date.parse(envelope.savedAt)
    expect(stamp).toBeGreaterThanOrEqual(before)
    expect(stamp).toBeLessThanOrEqual(Date.now())
  })
})

describe('parseProjectFile', () => {
  const p = project([floor('f1', [area('a1', 4)])], [team('alpha', 3, ['mon'], { a1: 3 })])

  it('reads a file, a bare project, and a file that starts with a byte order mark', () => {
    expect(parseProjectFile(serializeProject(p))).toStrictEqual({ ok: true, project: p })
    expect(parseProjectFile(JSON.stringify(p))).toStrictEqual({ ok: true, project: p })
    expect(parseProjectFile(`\uFEFF${serializeProject(p)}\n`)).toStrictEqual({ ok: true, project: p })
  })

  it('repairs what it reads', () => {
    const read = parseProjectFile('{ "floors": [{ "areas": [{ "capacity": 2.6 }] }], "teams": [{ "size": -1 }] }')
    if (!read.ok) throw new Error(read.error)
    expect(violations(read.project)).toEqual([])
    expect(nth(nth(read.project.floors, 0).areas, 0).capacity).toBe(3)
  })

  it('says that an empty file is empty', () => {
    for (const text of ['', '   ', '\n\t\r\n', '\uFEFF']) {
      expect(parseProjectFile(text)).toStrictEqual({ ok: false, error: 'This file is empty.' })
    }
  })

  it('says that text which is not JSON is not a planner file', () => {
    for (const text of ['not json', '{', '{ "floors": [}', "{ 'floors': [] }", 'Day,Team,Code\r\nMonday,Alpha,ALP', '<html></html>']) {
      expect(parseProjectFile(text)).toStrictEqual({ ok: false, error: 'This file is not a planner file: it is not valid JSON.' })
    }
  })

  it('passes on why a project is refused', () => {
    for (const text of ['null', '42', '"text"', '[]', '{}', '{ "floors": [] }', '{ "project": 5 }']) {
      expect(parseProjectFile(text)).toStrictEqual({ ok: false, error: 'This is not a planner file.' })
    }
    expect(parseProjectFile('{ "schemaVersion": 3, "project": { "floors": [], "teams": [] } }')).toStrictEqual({
      ok: false,
      error: 'This file was made with a newer version of the planner. Update the planner to open it.',
    })
    expect(parseProjectFile(JSON.stringify({ floors: Array.from({ length: 201 }, () => ({})), teams: [] }))).toStrictEqual({
      ok: false,
      error: 'This file is too large to be a seating plan.',
    })
  })

  it('never throws, whatever it is handed', () => {
    for (const notText of [undefined, null, 42, {}, []]) {
      expect(parseProjectFile(notText as unknown as string)).toStrictEqual({ ok: false, error: 'This file could not be read.' })
    }
    // Nesting too deep for the JSON reader is a damaged file like any other.
    const deep = `${'['.repeat(200_000)}${']'.repeat(200_000)}`
    expect(parseProjectFile(deep).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// seatingCsv
// ---------------------------------------------------------------------------

describe('seatingCsv', () => {
  const header = 'Day,Team,Code,Domain,ART,People,Seats needed,Floor,Area,Seats'

  /** Reads CSV text back into rows of cells the way a spreadsheet does. */
  function readCsv(csv: string): string[][] {
    const text = csv.startsWith('\uFEFF') ? csv.slice(1) : csv
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let quoted = false
    for (let i = 0; i < text.length; i += 1) {
      const char = text.charAt(i)
      if (quoted) {
        if (char !== '"') {
          cell += char
        } else if (text.charAt(i + 1) === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else if (char === '"') {
        quoted = true
      } else if (char === ',') {
        row.push(cell)
        cell = ''
      } else if (char === '\r' && text.charAt(i + 1) === '\n') {
        row.push(cell)
        rows.push(row)
        row = []
        cell = ''
        i += 1
      } else {
        cell += char
      }
    }
    return rows
  }

  /** The lines of a CSV without quoted line breaks, checked for the mark and the line ends. */
  function lines(csv: string): string[] {
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    const body = csv.slice(1, -2)
    expect(body.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
    return body.split('\r\n')
  }

  it('is just the header for a plan without team days', () => {
    expect(seatingCsv(project([floor('f1', [area('a1', 4)])], [team('alpha', 3)]))).toBe(`\uFEFF${header}\r\n`)
  })

  it('starts with a byte order mark and ends every line with CRLF', () => {
    const csv = seatingCsv(project([floor('f1', [area('a1', 4)])], [team('alpha', 3, ['mon'], { a1: 3 })]))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toBe(`\uFEFF${header}\r\nMonday,Alpha,ALP,,,3,3,Floor f1,A1,3\r\n`)
  })

  it('orders rows by weekday, then team, then floor, then area', () => {
    const p = project(
      [
        floor('f1', [area('a1', 4), area('a2', 4)], { name: 'First floor' }),
        floor('f2', [area('b1', 6)], { name: 'Second floor' }),
      ],
      [
        // Days and seats are given out of order on purpose.
        team('beta', 6, ['tue', 'mon'], { b1: 3, a2: 2, a1: 1 }, { domainId: 'Claims', artId: 'Intake ART' }),
        team('alpha', 3, ['mon'], { a1: 3 }),
      ],
    )
    expect(lines(seatingCsv(p))).toEqual([
      header,
      'Monday,Beta,BET,Claims,Intake ART,6,6,First floor,A1,1',
      'Monday,Beta,BET,Claims,Intake ART,6,6,First floor,A2,2',
      'Monday,Beta,BET,Claims,Intake ART,6,6,Second floor,B1,3',
      'Monday,Alpha,ALP,,,3,3,First floor,A1,3',
      'Tuesday,Beta,BET,Claims,Intake ART,6,6,First floor,A1,1',
      'Tuesday,Beta,BET,Claims,Intake ART,6,6,First floor,A2,2',
      'Tuesday,Beta,BET,Claims,Intake ART,6,6,Second floor,B1,3',
    ])
  })

  it('names all five days in full', () => {
    const p = project([floor('f1', [area('a1', 4)])], [team('alpha', 1, ['mon', 'tue', 'wed', 'thu', 'fri'], { a1: 1 })])
    expect(readCsv(seatingCsv(p)).slice(1).map((row) => row[0])).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
  })

  it('gives a team day without seats one row with no floor, no area and 0 seats', () => {
    const p = project(
      [floor('f1', [area('a1', 4)], { name: 'First floor' })],
      [
        team('alpha', 5, ['mon', 'wed']),
        // No seats on Wednesday only; and seats in an area that is gone do not count.
        team('beta', 2, ['mon', 'wed'], { a1: 2 }, { daySeating: { wed: {} } }),
        team('gamma', 2, ['wed'], { ghost: 2 }),
        team('delta', 4),
      ],
    )
    expect(lines(seatingCsv(p))).toEqual([
      header,
      'Monday,Alpha,ALP,,,5,5,,,0',
      'Monday,Beta,BET,,,2,2,First floor,A1,2',
      'Wednesday,Alpha,ALP,,,5,5,,,0',
      'Wednesday,Beta,BET,,,2,2,,,0',
      'Wednesday,Gamma,GAM,,,2,2,,,0',
    ])
  })

  it('shows where a team sits on a day that differs', () => {
    const p = project(
      [floor('f1', [area('a1', 4), area('a2', 4)], { name: 'First floor' })],
      [team('alpha', 4, ['tue', 'thu'], { a1: 4 }, { daySeating: { thu: { a2: 3 } } })],
    )
    expect(lines(seatingCsv(p))).toEqual([
      header,
      'Tuesday,Alpha,ALP,,,4,4,First floor,A1,4',
      'Thursday,Alpha,ALP,,,4,4,First floor,A2,3',
    ])
  })

  it('counts the seats needed with the expected attendance', () => {
    const p = project(
      [floor('f1', [area('a1', 20)])],
      [team('alpha', 10, ['mon'], { a1: 5 }), team('beta', 10, ['mon'], { a1: 8 }, { attendance: 0.8 })],
      { attendance: 0.5 },
    )
    expect(lines(seatingCsv(p)).slice(1)).toEqual(['Monday,Alpha,ALP,,,10,5,Floor f1,A1,5', 'Monday,Beta,BET,,,10,8,Floor f1,A1,8'])
  })

  it('quotes fields with a comma, a quote or a line break, doubling the quotes', () => {
    const p = project(
      [floor('f1', [area('a1', 4, { name: 'North\nwing' })], { name: 'Floor 1, east' })],
      [team('alpha', 3, ['mon'], { a1: 3 }, { name: 'Claims "Intake"', code: 'C,I', domainId: 'Line one\r\nline two' })],
    )
    const csv = seatingCsv(p)
    expect(csv).toBe(
      `\uFEFF${header}\r\n` + 'Monday,"Claims ""Intake""","C,I","Line one\r\nline two",,3,3,"Floor 1, east","North\nwing",3\r\n',
    )
    expect(readCsv(csv)).toEqual([
      header.split(','),
      ['Monday', 'Claims "Intake"', 'C,I', 'Line one\r\nline two', '', '3', '3', 'Floor 1, east', 'North\nwing', '3'],
    ])
  })

  it('does not quote what needs no quotes', () => {
    const p = project(
      [floor('f1', [area('a1', 4, { name: "Team's corner; left" })])],
      [team('alpha', 3, ['mon'], { a1: 3 }, { name: 'Zürich équipe 4', artId: 'A = B' })],
    )
    expect(lines(seatingCsv(p))[1]).toBe("Monday,Zürich équipe 4,ALP,,A = B,3,3,Floor f1,Team's corner; left,3")
  })

  it('keeps a spreadsheet from running a text field as a formula', () => {
    const names = ['=SUM(A1:A9)', '+31 20 123', '-1 team', '@home', '\t=1+1', '\r=1+1', '=HYPERLINK("http://evil","x"),1']
    const p = project(
      [floor('f1', [area('a1', 40, { name: '+Extra' })], { name: '-1 Basement' })],
      names.map((name, i) => team(`t${i}`, 1, ['mon'], { a1: 1 }, { name, code: '=1', domainId: '@ops', artId: '-ART' })),
    )
    const rows = readCsv(seatingCsv(p)).slice(1)
    expect(rows.map((row) => row[1])).toEqual(names.map((name) => `'${name}`))
    for (const row of rows) {
      expect(row).toHaveLength(10)
      expect(row.slice(2, 5)).toEqual(["'=1", "'@ops", "'-ART"])
      expect(row.slice(7, 9)).toEqual(["'-1 Basement", "'+Extra"])
      // No cell starts with a character that begins a formula.
      for (const cell of row) expect(cell).not.toMatch(/^[=+\-@\t\r]/)
    }
    expect(seatingCsv(p)).toContain('"\'=HYPERLINK(""http://evil"",""x""),1"')
  })

  it('leaves text alone that merely contains such a character, and numbers always', () => {
    const p = project(
      [floor('f1', [area('a1', 4, { name: 'A-1' })], { name: 'Floor +1' })],
      [team('alpha', 0, ['mon'], {}, { name: 'R&D = fun', code: 'A@B', domainId: 'x-y' })],
    )
    expect(lines(seatingCsv(p))[1]).toBe('Monday,R&D = fun,A@B,x-y,,0,0,,,0')
  })

  it('writes any text so that it comes back as one cell (300 random names)', () => {
    const random = randomSource(42)
    const pieces = ['a', 'B', '1', ' ', ',', ';', '"', "'", '\n', '\r', '\r\n', '\t', '=', '+', '-', '@', 'é', '😀']
    const names = Array.from({ length: 300 }, () => randomText(random, pieces, 1 + Math.floor(random() * 12)))
    const p = project(
      [floor('f1', [area('a1', 1000)])],
      names.map((name, i) => team(`t${i}`, 1, ['mon'], { a1: 1 }, { name, code: name.slice(0, 4), domainId: name })),
    )
    /** The cell a spreadsheet must show for a text: the text itself, kept from being a formula. */
    const cell = (text: string) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text)

    const rows = readCsv(seatingCsv(p)).slice(1)
    expect(rows).toHaveLength(300)
    rows.forEach((row, i) => {
      const name = nth(names, i)
      expect(row, JSON.stringify(name)).toEqual(['Monday', cell(name), cell(name.slice(0, 4)), cell(name), '', '1', '1', 'Floor f1', 'A1', '1'])
    })
  })

  it('writes ten cells in every row of a real plan', () => {
    const rows = readCsv(seatingCsv(appProject()))
    // The header, a row for each of the 20 team days, and 4 more for the days on which a
    // team sits in more than one area (Claims Intake in two and three, Underwriting in two).
    expect(rows).toHaveLength(1 + 20 + 4)
    for (const row of rows) expect(row).toHaveLength(10)
    expect(rows.filter((row) => row[1] === 'Claims Intake').map((row) => [row[0], row[8], row[9]])).toEqual([
      ['Tuesday', 'NW 1', '6'],
      ['Tuesday', 'NW 2', '3'],
      ['Thursday', 'NW 1', '6'],
      ['Thursday', 'NW 2', '3'],
      ['Thursday', 'SE 1', '4'],
    ])
  })
})

describe('exportFileName', () => {
  const date = new Date('2026-11-27T10:00:00.000Z')

  it('is the name of the plan in lower case with the date', () => {
    expect(exportFileName(project([]), 'json', date)).toBe('test-plan-2026-11-27.json')
    expect(exportFileName({ ...project([]), name: '  Head Office: Plan #2 ' }, 'csv', date)).toBe('head-office-plan-2-2026-11-27.csv')
  })

  it('writes accented letters without their accents', () => {
    expect(exportFileName({ ...project([]), name: 'Büro Zürich, Étage 4' }, 'json', date)).toBe('buro-zurich-etage-4-2026-11-27.json')
  })

  it('falls back to "office-plan" when nothing of the name can be used', () => {
    expect(exportFileName({ ...project([]), name: '***' }, 'json', date)).toBe('office-plan-2026-11-27.json')
  })
})

// ---------------------------------------------------------------------------
// parseTeamsText
// ---------------------------------------------------------------------------

describe('parseTeamsText', () => {
  it('reads nothing from nothing', () => {
    expect(parseTeamsText('')).toStrictEqual({ rows: [], problems: [] })
    expect(parseTeamsText(' \n\t\n\r\n  ')).toStrictEqual({ rows: [], problems: [] })
  })

  it('reads lines separated by tabs, as copied from a spreadsheet', () => {
    expect(parseTeamsText('Claims Intake\t9\tTue Thu\tClaims\nUnderwriting\t10\tdi/do\tPolicy')).toStrictEqual({
      rows: [
        { name: 'Claims Intake', size: 9, days: ['tue', 'thu'], domain: 'Claims', art: '', line: 1 },
        { name: 'Underwriting', size: 10, days: ['tue', 'thu'], domain: 'Policy', art: '', line: 2 },
      ],
      problems: [],
    })
  })

  it('reads lines separated by semicolons', () => {
    expect(parseTeamsText('Claims Intake;9;Tue, Thu;Claims\nData Platform ; 6 ;; Digital')).toStrictEqual({
      rows: [
        { name: 'Claims Intake', size: 9, days: ['tue', 'thu'], domain: 'Claims', art: '', line: 1 },
        { name: 'Data Platform', size: 6, days: [], domain: 'Digital', art: '', line: 2 },
      ],
      problems: [],
    })
  })

  it('reads lines separated by commas, where each day is a field of its own', () => {
    expect(parseTeamsText('Claims Intake, 9, Tue, Thu, Claims\nArchitecture,4')).toStrictEqual({
      rows: [
        { name: 'Claims Intake', size: 9, days: ['tue', 'thu'], domain: 'Claims', art: '', line: 1 },
        { name: 'Architecture', size: 4, days: [], domain: '', art: '', line: 2 },
      ],
      problems: [],
    })
  })

  it('splits at tabs before semicolons, and at semicolons before commas', () => {
    const { rows, problems } = parseTeamsText('Smith, Jones; Co\t12\tMon; Wed\nSmith, Brown & Co;7;Mon, Wed')
    expect(problems).toEqual([])
    expect(rows).toStrictEqual([
      { name: 'Smith, Jones; Co', size: 12, days: ['mon', 'wed'], domain: '', art: '', line: 1 },
      { name: 'Smith, Brown & Co', size: 7, days: ['mon', 'wed'], domain: '', art: '', line: 2 },
    ])
  })

  it('chooses the separator for each line on its own', () => {
    const { rows, problems } = parseTeamsText('Alpha\t5\nBeta;6\nGamma,7')
    expect(problems).toEqual([])
    expect(rows.map((row) => [row.name, row.size])).toEqual([
      ['Alpha', 5],
      ['Beta', 6],
      ['Gamma', 7],
    ])
  })

  it('skips blank lines but counts them, whatever the line ends are', () => {
    const { rows, problems } = parseTeamsText('\r\nAlpha;5\r\n\r\n   \r\n;;;\r\n\t\t\r\nBeta;6\rGamma;7\n')
    expect(problems).toEqual([])
    expect(rows.map((row) => [row.name, row.line])).toEqual([
      ['Alpha', 2],
      ['Beta', 7],
      ['Gamma', 8],
    ])
  })

  it('skips a header line in silence', () => {
    const headers = [
      'Team\tSize\tDays\tGroup',
      'Name;People;Days',
      'Team name, Headcount, Team days, Department',
      'TEAM;FTE;DAYS;GROUP',
      '"Team";"Number of people";"Days"',
      'Naam;Aantal;Dagen;Afdeling',
      'Team;Größe;Tage;Abteilung',
      'Équipe;Effectif;Jours;Groupe',
      "Nom de l'équipe;Nombre de personnes;Jours",
      '\uFEFFTeam;Size',
      'Team',
      // One heading that is known is enough; the other columns may be called anything.
      'Team;FTE;Wanted days;Release train;Manager',
      'Squad\tSize\tOffice days (see sheet)',
    ]
    for (const header of headers) {
      expect(parseTeamsText(`${header}\nClaims Intake\t9\tTue`), header).toStrictEqual({
        rows: [{ name: 'Claims Intake', size: 9, days: ['tue'], domain: '', art: '', line: 2 }],
        problems: [],
      })
    }
  })

  it('finds the header after blank lines, but only as the first line with text', () => {
    expect(parseTeamsText('\n\nTeam;Size\nAlpha;5')).toStrictEqual({
      rows: [{ name: 'Alpha', size: 5, days: [], domain: '', art: '', line: 4 }],
      problems: [],
    })
    expect(parseTeamsText('Alpha;5\nTeam;Size').problems).toEqual(['Line 2: no team size found for Team'])
  })

  it('does not take a first line for a header when it has a number', () => {
    expect(parseTeamsText('Team 1;5').rows).toStrictEqual([{ name: 'Team 1', size: 5, days: [], domain: '', art: '', line: 1 }])
    expect(parseTeamsText('People;12;Mon').rows).toStrictEqual([{ name: 'People', size: 12, days: ['mon'], domain: '', art: '', line: 1 }])
    expect(parseTeamsText('Team;Size (max 5000)').problems).toEqual(['Line 1: no team size found for Team'])
  })

  it('reports a first line that is a team without a size instead of taking it for a header', () => {
    expect(parseTeamsText('Claims Intake\nUnderwriting;10')).toStrictEqual({
      rows: [{ name: 'Underwriting', size: 10, days: [], domain: '', art: '', line: 2 }],
      problems: ['Line 1: no team size found for Claims Intake'],
    })
    expect(parseTeamsText('Team Rocket;Claims unit').problems).toEqual(['Line 1: no team size found for Team Rocket'])
    // A team that is called like a heading, but with its days: a header lists no days.
    expect(parseTeamsText('People;Tue Thu').problems).toEqual(['Line 1: no team size found for People'])
    expect(parseTeamsText('Service\tdi\tOperations').problems).toEqual(['Line 1: no team size found for Service'])
  })

  it('reads the days in English', () => {
    const days = (field: string) => nth(parseTeamsText(`Alpha\t8\t${field}`).rows, 0).days
    expect(days('mon tue wed thu fri')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
    expect(days('Monday, Tuesday, Wednesday, Thursday and Friday')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
    expect(days('Tues Weds Thur')).toEqual(['tue', 'wed', 'thu'])
    expect(days('THURS')).toEqual(['thu'])
  })

  it('reads the days in Dutch', () => {
    const days = (field: string) => nth(parseTeamsText(`Alpha\t8\t${field}`).rows, 0).days
    expect(days('ma di wo do vr')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
    expect(days('Maandag, dinsdag, woensdag, donderdag en vrijdag')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
    expect(days('woe en vrij')).toEqual(['wed', 'fri'])
  })

  it('reads the days in German', () => {
    const days = (field: string) => nth(parseTeamsText(`Alpha\t8\t${field}`).rows, 0).days
    expect(days('Mo, Di, Mi, Do, Fr')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
    expect(days('Montag Dienstag Mittwoch Donnerstag Freitag')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
    expect(days('Dienstag und Donnerstag')).toEqual(['tue', 'thu'])
  })

  it('reads the days in French', () => {
    const days = (field: string) => nth(parseTeamsText(`Alpha\t8\t${field}`).rows, 0).days
    expect(days('lun mar mer jeu ven')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
    expect(days('Lundi, mardi, mercredi, jeudi et vendredi')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
    expect(days('Mar. et Jeu.')).toEqual(['tue', 'thu'])
  })

  it('knows every spelling of every day', () => {
    const spellings = {
      mon: 'mon monday ma maandag mo montag lun lundi',
      tue: 'tue tues tuesday di dinsdag dienstag mar mardi',
      wed: 'wed weds wednesday wo woe woensdag mi mittwoch mer mercredi',
      thu: 'thu thur thurs thursday do donderdag donnerstag jeu jeudi',
      fri: 'fri friday vr vrij vrijdag fr freitag ven vendredi',
    }
    for (const [day, words] of Object.entries(spellings)) {
      for (const word of words.split(' ')) {
        expect(nth(parseTeamsText(`Alpha\t8\t${word}`).rows, 0).days, word).toEqual([day])
      }
    }
  })

  it('ignores case, accents and the dot of an abbreviation', () => {
    const days = (field: string) => nth(parseTeamsText(`Alpha\t8\t${field}`).rows, 0).days
    expect(days('TUE. Thu.')).toEqual(['tue', 'thu'])
    expect(days('Mércredi / VENDREDI')).toEqual(['wed', 'fri'])
    expect(days('Dönnerstag')).toEqual(['thu'])
  })

  it('takes spaces, commas, slashes, plus signs and ampersands between days', () => {
    const days = (field: string) => nth(parseTeamsText(`Alpha\t8\t${field}`).rows, 0).days
    expect(days('Tue/Thu + Fri & mon, wed')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
    expect(days('di+do')).toEqual(['tue', 'thu'])
    expect(days('Mo&Mi')).toEqual(['mon', 'wed'])
    expect(days('lun , mar /  mer')).toEqual(['mon', 'tue', 'wed'])
  })

  it('does not take a hyphen between days: "Tue-Thu" could be two days or three', () => {
    expect(parseTeamsText('Alpha;8;Tue-Thu').rows).toStrictEqual([{ name: 'Alpha', size: 8, days: [], domain: 'Tue-Thu', art: '', line: 1 }])
  })

  it('merges several day fields, each day once, in week order', () => {
    expect(nth(parseTeamsText('Alpha\t8\tThu\tMon\tThu, Tue').rows, 0).days).toEqual(['mon', 'tue', 'thu'])
    // The days may come before the size.
    expect(parseTeamsText('Alpha;Fri Mon;8;Claims').rows).toStrictEqual([
      { name: 'Alpha', size: 8, days: ['mon', 'fri'], domain: 'Claims', art: '', line: 1 },
    ])
  })

  it('does not mistake a group for days', () => {
    const group = (field: string) => {
      const row = nth(parseTeamsText(`Alpha;8;${field}`).rows, 0)
      expect(row.days, field).toEqual([])
      return row.domain
    }
    for (const name of ['Marketing', 'Monday crew', 'Mon Sat', 'Friends', 'Dimanche', 'Sales and Marketing', 'and', 'Wed 2', 'Mo-Fr', 'x']) {
      expect(group(name)).toBe(name)
    }
  })

  it('takes the first other field as the domain and the second as the ART, and no more', () => {
    const { rows, problems } = parseTeamsText('Alpha\t8\t\tTue\tClaims\tSecond floor\tthird\nBeta;B2B;7;Thu;Later')
    expect(problems).toEqual([])
    expect(rows).toStrictEqual([
      { name: 'Alpha', size: 8, days: ['tue'], domain: 'Claims', art: 'Second floor', line: 1 },
      { name: 'Beta', size: 7, days: ['thu'], domain: 'B2B', art: 'Later', line: 2 },
    ])
  })

  it('reads sizes that come with a word or a fraction, and rounds them', () => {
    const size = (field: string) => nth(parseTeamsText(`Alpha;${field};Mon`).rows, 0).size
    expect(size('8')).toBe(8)
    expect(size('8.0')).toBe(8)
    expect(size('8 people')).toBe(8)
    expect(size('12 FTE')).toBe(12)
    expect(size('7,5 FTE')).toBe(8)
    expect(size('7.4')).toBe(7)
    expect(size('0')).toBe(0)
    expect(size('007')).toBe(7)
    expect(size('5000')).toBe(5000)
    expect(size('5000.4')).toBe(5000)
  })

  it('takes the first field after the name that starts with a number as the size', () => {
    expect(parseTeamsText('24/7 Support;Tue;6;12').rows).toStrictEqual([
      { name: '24/7 Support', size: 6, days: ['tue'], domain: '12', art: '', line: 1 },
    ])
    expect(parseTeamsText('Alpha;v2;3rd line;9').rows).toStrictEqual([{ name: 'Alpha', size: 3, days: [], domain: 'v2', art: '9', line: 1 }])
  })

  it('reports a line without a size', () => {
    const { rows, problems } = parseTeamsText('Alpha;5\nBeta;6\n\nClaims Intake;Tue;Claims\nGamma;about ten\nDelta;-3')
    expect(rows.map((row) => row.name)).toEqual(['Alpha', 'Beta'])
    expect(problems).toEqual([
      'Line 4: no team size found for Claims Intake',
      'Line 5: no team size found for Gamma',
      'Line 6: no team size found for Delta',
    ])
  })

  it('reports a size above 5000', () => {
    const { rows, problems } = parseTeamsText('Alpha;5001\nBeta;5000.5\nGamma;99999999999999999999999\nDelta;5000')
    expect(rows.map((row) => row.name)).toEqual(['Delta'])
    expect(problems).toEqual([
      'Line 1: the team size for Alpha must be between 0 and 5000',
      'Line 2: the team size for Beta must be between 0 and 5000',
      'Line 3: the team size for Gamma must be between 0 and 5000',
    ])
  })

  it('reports a line without a name', () => {
    expect(parseTeamsText(';9;Tue\n\t12\n"";3\nAlpha;4')).toStrictEqual({
      rows: [{ name: 'Alpha', size: 4, days: [], domain: '', art: '', line: 4 }],
      problems: ['Line 1: no team name found', 'Line 2: no team name found', 'Line 3: no team name found'],
    })
  })

  it('keeps the first of two lines with the same name and reports the second', () => {
    const text = ['Team;Size', 'Claims Intake;9;Tue', 'Alpha;5', 'Beta;6', 'Gamma;7', 'Delta;8', 'Claims Intake;4;Thu'].join('\n')
    const { rows, problems } = parseTeamsText(text)
    expect(problems).toEqual(['Line 7: Claims Intake appears twice; the second one was skipped'])
    expect(rows.filter((row) => row.name === 'Claims Intake')).toStrictEqual([
      { name: 'Claims Intake', size: 9, days: ['tue'], domain: '', art: '', line: 2 },
    ])
    expect(rows).toHaveLength(5)
  })

  it('compares names without regard to case and to spaces around them', () => {
    expect(parseTeamsText('Claims Intake;9\n  CLAIMS intake  ;4\nclaims  intake;5')).toStrictEqual({
      rows: [
        { name: 'Claims Intake', size: 9, days: [], domain: '', art: '', line: 1 },
        { name: 'claims  intake', size: 5, days: [], domain: '', art: '', line: 3 },
      ],
      problems: ['Line 2: CLAIMS intake appears twice; the second one was skipped'],
    })
  })

  it('does not count a line that could not be used as the first of two', () => {
    expect(parseTeamsText('Alpha\nAlpha;5')).toStrictEqual({
      rows: [{ name: 'Alpha', size: 5, days: [], domain: '', art: '', line: 2 }],
      problems: ['Line 1: no team size found for Alpha'],
    })
  })

  it('strips quotes around fields and reads quoted fields that contain the separator', () => {
    expect(parseTeamsText('"Claims, Intake",9,"Tue, Thu",Claims').rows).toStrictEqual([
      { name: 'Claims, Intake', size: 9, days: ['tue', 'thu'], domain: 'Claims', art: '', line: 1 },
    ])
    expect(parseTeamsText('"Claims, Intake";"9";"Tue, Thu";"Claims; Policy"').rows).toStrictEqual([
      { name: 'Claims, Intake', size: 9, days: ['tue', 'thu'], domain: 'Claims; Policy', art: '', line: 1 },
    ])
    expect(parseTeamsText("'Alpha';'8';'Tue';'Claims'").rows).toStrictEqual([
      { name: 'Alpha', size: 8, days: ['tue'], domain: 'Claims', art: '', line: 1 },
    ])
    expect(parseTeamsText(' "Alpha" \t "8" ').rows).toStrictEqual([{ name: 'Alpha', size: 8, days: [], domain: '', art: '', line: 1 }])
  })

  it('reads a doubled quote inside a quoted field as one quote, and other quotes as they are', () => {
    expect(nth(parseTeamsText('"The ""A"" team";3').rows, 0).name).toBe('The "A" team')
    expect(nth(parseTeamsText('The "A" team;3').rows, 0).name).toBe('The "A" team')
    expect(nth(parseTeamsText('5" screens;3').rows, 0).name).toBe('5" screens')
    expect(nth(parseTeamsText("'t Kantoor;3").rows, 0).name).toBe("'t Kantoor")
  })

  it('cuts a name at 120 characters and a domain and an ART at 60', () => {
    const row = nth(parseTeamsText(`${'n'.repeat(300)};5;${'d'.repeat(300)};${'a'.repeat(300)}`).rows, 0)
    expect(row.name).toBe('n'.repeat(120))
    expect(row.domain).toBe('d'.repeat(60))
    expect(row.art).toBe('a'.repeat(60))
  })

  it('reads the first text after the size as the domain and the second as the ART', () => {
    const { rows } = parseTeamsText('Claims Intake;9;Tue Thu;Non-Life;Claims ART\nBoard;3;Non-Life\nLoose;2;Mon')
    expect(rows.map((row) => [row.name, row.days, row.domain, row.art])).toEqual([
      ['Claims Intake', ['tue', 'thu'], 'Non-Life', 'Claims ART'],
      ['Board', [], 'Non-Life', ''],
      ['Loose', ['mon'], '', ''],
    ])
  })

  it('reads at most 500 teams and says so when there are more', () => {
    const teamLines = (count: number) => Array.from({ length: count }, (_, i) => `Team ${i + 1};${(i % 12) + 1};Tue`).join('\n')

    const exactly = parseTeamsText(teamLines(500))
    expect(exactly.rows).toHaveLength(500)
    expect(exactly.problems).toEqual([])

    const more = parseTeamsText(teamLines(640))
    expect(more.rows).toHaveLength(500)
    expect(nth(more.rows, 499)).toStrictEqual({ name: 'Team 500', size: 8, days: ['tue'], domain: '', art: '', line: 500 })
    expect(more.problems).toEqual(['Line 501: more than 500 teams were pasted; this line and everything after it was skipped'])
  })

  it('writes every problem as a sentence that starts with its line', () => {
    const { problems } = parseTeamsText('Alpha\n;4\nBeta;9000\nGamma;3\nGamma;3')
    expect(problems).toHaveLength(4)
    problems.forEach((problem, index) => expect(problem).toMatch(new RegExp(`^Line ${index === 3 ? 5 : index + 1}: \\S`)))
  })

  it('stays quick on text that is nothing like a team list', () => {
    const junk = [`a${'"'.repeat(200_000)}`, `Alpha;8;${'mon '.repeat(200_000)}`, `Beta;8;${'.'.repeat(200_000)}x`, ';'.repeat(200_000)]
    const started = performance.now()
    const { rows } = parseTeamsText(junk.join('\n'))
    expect(rows.map((row) => row.days)).toEqual([['mon'], []])
    // Milliseconds when every line is read in one pass; minutes if a step went over a line
    // again for each of its characters.
    expect(performance.now() - started).toBeLessThan(5000)
  })

  it('makes sound rows and readable problems of any text (500 random texts)', () => {
    const random = randomSource(1234)
    const pieces = [
      ...['Alpha', 'Team', 'Claims Intake', 'size', 'Marketing', 'and', 'é', '😀'],
      ...['8', '12 FTE', '7,5', '5001', '0', 'Tue', 'di', 'Thu.', 'Mo-Fr'],
      ...[',', ';', '\t', ' ', '\n', '\r\n', '"', "'", '/', '+', '&', '-', '.'],
    ]
    for (let round = 0; round < 500; round += 1) {
      const text = randomText(random, pieces, Math.floor(random() * 60))
      const what = `round ${round}: ${JSON.stringify(text)}`
      const { rows, problems } = parseTeamsText(text)
      const lineCount = text.split(/\r\n|\r|\n/).length

      for (const row of rows) {
        expect(row.name, what).not.toBe('')
        expect(row.name.trim(), what).toBe(row.name)
        expect(row.name.length, what).toBeLessThanOrEqual(120)
        expect(Number.isInteger(row.size) && row.size >= 0 && row.size <= 5000, what).toBe(true)
        expect(row.days, what).toEqual(WEEKDAYS.filter((day) => row.days.includes(day)))
        expect(row.domain.length, what).toBeLessThanOrEqual(60)
        expect(row.art.length, what).toBeLessThanOrEqual(60)
        expect(row.line >= 1 && row.line <= lineCount, what).toBe(true)
      }
      // No name twice, and the rows in the order of their lines.
      expect(new Set(rows.map((row) => row.name.toLowerCase())).size, what).toBe(rows.length)
      expect(rows.map((row) => row.line), what).toEqual(rows.map((row) => row.line).sort((a, b) => a - b))
      for (const problem of problems) expect(problem, what).toMatch(/^Line [1-9]\d*: \S/)
      // A line gives a row or a problem, never both and never two.
      const used = [...rows.map((row) => row.line), ...problems.map((problem) => Number(/^Line (\d+):/.exec(problem)?.[1]))]
      expect(new Set(used).size, what).toBe(used.length)
    }
  })
})

// ---------------------------------------------------------------------------
// CSV for spreadsheets that expect semicolons
// ---------------------------------------------------------------------------

describe('seatingCsv with semicolons', () => {
  it('picks the separator from the decimal sign of the region', () => {
    expect(csvSeparatorFor('en-US')).toBe(',')
    expect(csvSeparatorFor('en-GB')).toBe(',')
    expect(csvSeparatorFor('nl-BE')).toBe(';')
    expect(csvSeparatorFor('fr-BE')).toBe(';')
    expect(csvSeparatorFor('de-DE')).toBe(';')
    expect(csvSeparatorFor('fr-LU')).toBe(';')
    // Switzerland writes 1.5 with a point, but its spreadsheets still expect semicolons.
    expect(csvSeparatorFor('de-CH')).toBe(';')
    expect(csvSeparatorFor('fr-CH')).toBe(';')
    expect(csvSeparatorFor('fr-FR')).toBe(';')
  })

  it('falls back to a comma for a region it does not know', () => {
    expect(csvSeparatorFor('not a locale')).toBe(',')
  })

  it('separates with semicolons and quotes a name that contains one', () => {
    const p = project(
      [floor('f1', [area('a1', 4)], { name: 'Floor 1' })],
      [team('alpha', 3, ['mon'], { a1: 3 }, { name: 'Claims; intake', code: 'CI', domainId: 'Claims, north' })],
    )
    const lines = seatingCsv(p, ';').split('\r\n')
    expect(nth(lines, 0)).toBe('\uFEFFDay;Team;Code;Domain;ART;People;Seats needed;Floor;Area;Seats')
    // The semicolon in the name needs quotes now; the comma in the domain no longer does.
    expect(nth(lines, 1)).toBe('Monday;"Claims; intake";CI;Claims, north;;3;3;Floor 1;A1;3')
  })

  it('still separates with commas by default', () => {
    const p = project(
      [floor('f1', [area('a1', 4)], { name: 'Floor 1' })],
      [team('alpha', 3, ['mon'], { a1: 3 }, { name: 'Claims; intake', code: 'CI', domainId: 'Claims, north' })],
    )
    expect(nth(seatingCsv(p).split('\r\n'), 1)).toBe('Monday,Claims; intake,CI,"Claims, north",,3,3,Floor 1,A1,3')
  })
})

// ---------------------------------------------------------------------------
// Pasted team lists: found in review
// ---------------------------------------------------------------------------

describe('parseTeamsText on what spreadsheets really copy', () => {
  it('keeps a cell with a line break in it as one cell', () => {
    // Excel copies a two-line cell inside quotes, with the line break in it.
    const pasted = '"Claims\nIntake"\t9\tTue\nUnderwriting\t10\tWed'
    expect(parseTeamsText(pasted)).toStrictEqual({
      rows: [
        { name: 'Claims Intake', size: 9, days: ['tue'], domain: '', art: '', line: 1 },
        // Line numbers count the lines of the text, so this team starts on line 3.
        { name: 'Underwriting', size: 10, days: ['wed'], domain: '', art: '', line: 3 },
      ],
      problems: [],
    })
  })

  it('reads line by line when a quote is never closed, so one bad line does not swallow the rest', () => {
    const pasted = '"Claims Intake\t9\tTue\nUnderwriting\t10\tWed'
    const { rows, problems } = parseTeamsText(pasted)
    // The line with the open quote is reported; the next line is a team of its own.
    expect(rows.map((row) => [row.name, row.size, row.line])).toEqual([['Underwriting', 10, 2]])
    expect(problems).toHaveLength(1)
    expect(nth(problems, 0)).toMatch(/^Line 1:/)
  })

  it('takes plural day names for days', () => {
    const { rows } = parseTeamsText('Claims Intake\t9\tTuesdays and Thursdays\tClaims\nPolicy\t8\tdinsdagen en donderdagen')
    expect(rows.map((row) => [row.days, row.domain])).toEqual([
      [['tue', 'thu'], 'Claims'],
      [['tue', 'thu'], ''],
    ])
  })

  it('takes characters out of a name that cannot be stored', () => {
    const { rows } = parseTeamsText('Claims\u0000 Intake\t9\tTue')
    expect(nth(rows, 0).name).toBe('Claims Intake')
  })
})
