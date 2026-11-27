import { describe, expect, it } from 'vitest'
import { FLOOR4_AREAS, FLOOR4_PLAN_SIZE } from './floor4'
import { areNeighbours, centerDistance, clusterAreas, nearestFirst, neighbourDistance, rectGap } from './geometry'
import { area, floor, project, row, violations } from './testkit'
import type { Area, Floor, Rect } from './types'

/* The examples use fractions that are exact in binary (quarters, eighths, sixteenths), so
   "touching" really is a gap of zero and the expected distances can be compared exactly. A
   floor from the test kit has no drawing: its sheet is twice as wide as it is high. */

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

/** A desk cluster of the usual size in these examples: an eighth wide, a quarter high. */
const desk = (id: string, x: number, y = 0.25): Area => area(id, 4, { rect: rect(x, y, 0.125, 0.25) })

function areaOf(f: Floor, id: string): Area {
  const found = f.areas.find((a) => a.id === id)
  if (!found) throw new Error(`no area ${id} on floor ${f.id}`)
  return found
}

const ids = (areas: readonly Area[]) => areas.map((a) => a.id)

describe('rectGap', () => {
  const a = rect(0, 0, 0.25, 0.25)

  it('is 0 for rectangles that overlap', () => {
    expect(rectGap(a, rect(0.125, 0.125, 0.25, 0.25), 2)).toBe(0)
  })

  it('is 0 when one rectangle lies inside the other', () => {
    expect(rectGap(rect(0, 0, 1, 1), rect(0.25, 0.25, 0.25, 0.25), 2)).toBe(0)
    expect(rectGap(rect(0.25, 0.25, 0.25, 0.25), rect(0, 0, 1, 1), 2)).toBe(0)
  })

  it('is 0 for rectangles that touch along an edge or only at a corner', () => {
    expect(rectGap(a, rect(0.25, 0, 0.25, 0.25), 2)).toBe(0)
    expect(rectGap(a, rect(0, 0.25, 0.25, 0.25), 2)).toBe(0)
    expect(rectGap(a, rect(0.25, 0.25, 0.25, 0.25), 2)).toBe(0)
  })

  it('measures a gap to the side in plan heights: the x difference times the aspect ratio', () => {
    const beside = rect(0.5, 0, 0.25, 0.25)
    expect(rectGap(a, beside, 1)).toBe(0.25)
    expect(rectGap(a, beside, 2)).toBe(0.5)
    expect(rectGap(a, beside, 4)).toBe(1)
  })

  it('measures a gap above or below as it is, whatever the aspect ratio', () => {
    const below = rect(0, 0.5, 0.25, 0.25)
    expect(rectGap(a, below, 1)).toBe(0.25)
    expect(rectGap(a, below, 4)).toBe(0.25)
  })

  it('ignores how far the rectangles are shifted along a gap they face each other across', () => {
    // Beside and half a rectangle lower: the facing edges still overlap, only x counts.
    expect(rectGap(a, rect(0.5, 0.125, 0.25, 0.25), 2)).toBe(0.5)
  })

  it('measures a diagonal gap from corner to corner', () => {
    // 0.1875 to the side (0.375 plan heights at aspect 2) and 0.5 down: a 3-4-5 triangle.
    expect(rectGap(a, rect(0.4375, 0.75, 0.25, 0.25), 2)).toBeCloseTo(0.625, 12)
  })

  it('is the same in both directions', () => {
    const b = rect(0.4375, 0.75, 0.25, 0.125)
    expect(rectGap(b, a, 2)).toBe(rectGap(a, b, 2))
  })
})

describe('centerDistance', () => {
  const a = rect(0, 0, 0.25, 0.25)

  it('is 0 for rectangles around the same centre, whatever their size', () => {
    expect(centerDistance(rect(0.25, 0.25, 0.5, 0.5), rect(0.375, 0.375, 0.25, 0.25), 2)).toBe(0)
  })

  it('multiplies the x difference by the aspect ratio', () => {
    const beside = rect(0.5, 0, 0.25, 0.25)
    expect(centerDistance(a, beside, 1)).toBe(0.5)
    expect(centerDistance(a, beside, 2)).toBe(1)
  })

  it('leaves the y difference as it is', () => {
    const below = rect(0, 0.5, 0.25, 0.25)
    expect(centerDistance(a, below, 1)).toBe(0.5)
    expect(centerDistance(a, below, 4)).toBe(0.5)
  })

  it('combines both directions', () => {
    // Centres 0.1875 apart sideways (0.375 at aspect 2) and 0.5 apart vertically.
    expect(centerDistance(a, rect(0.1875, 0.5, 0.25, 0.25), 2)).toBeCloseTo(0.625, 12)
  })

  it('is the same in both directions', () => {
    const b = rect(0.1875, 0.5, 0.25, 0.125)
    expect(centerDistance(b, a, 2)).toBe(centerDistance(a, b, 2))
  })
})

describe('neighbourDistance', () => {
  it('is three quarters of the median shorter side of the seating areas', () => {
    // Shorter sides in plan heights at aspect 2: 0.125, 0.25 and 0.5.
    const f = floor('1', [
      area('small', 2, { rect: rect(0, 0, 0.0625, 0.5) }),
      area('medium', 4, { rect: rect(0.25, 0, 0.125, 0.5) }),
      area('large', 8, { rect: rect(0.5, 0, 0.5, 0.5) }),
    ])
    expect(neighbourDistance(f)).toBe(0.25 * 0.75)
  })

  it('measures the sides in plan heights, so it follows the shape of the drawing', () => {
    const areas = [area('a', 4, { rect: rect(0, 0, 0.0625, 0.5) })]
    // Without a drawing (aspect 2) the area is 0.125 wide and 0.5 high.
    expect(neighbourDistance(floor('1', areas))).toBe(0.125 * 0.75)
    // On a drawing eight times as wide as high it is 0.5 by 0.5.
    const wide: Floor = { ...floor('1', areas), plan: { src: '', width: 1600, height: 200 } }
    expect(neighbourDistance(wide)).toBe(0.5 * 0.75)
  })

  it('counts overflow areas but not rooms', () => {
    // One small desk (shorter side 0.125) and two big areas (0.5). As overflow areas the big
    // ones set the median; as rooms they do not count and the small desk is all there is.
    const small = area('small', 2, { rect: rect(0, 0, 0.0625, 0.25) })
    const big = (id: string, kind: Area['kind'], y: number) => area(id, 8, { kind, rect: rect(0.25, y, 0.25, 0.5) })
    const withOverflow = floor('1', [small, big('o1', 'overflow', 0), big('o2', 'overflow', 0.5)])
    const withRooms = floor('1', [small, big('r1', 'no-seating', 0), big('r2', 'no-seating', 0.5)])
    expect(neighbourDistance(withOverflow)).toBe(0.5 * 0.75)
    expect(neighbourDistance(withRooms)).toBe(0.125 * 0.75)
  })

  it('is a tenth of the plan height on a floor without seating areas', () => {
    expect(neighbourDistance(floor('1', []))).toBe(0.1)
    expect(neighbourDistance(floor('1', [area('room', 8, { kind: 'no-seating' })]))).toBe(0.1)
  })
})

describe('areNeighbours', () => {
  it('is true for areas that touch or overlap', () => {
    const f = floor('1', [desk('a', 0.25), desk('b', 0.375), desk('c', 0.3125)])
    expect(areNeighbours(f, areaOf(f, 'a'), areaOf(f, 'b'))).toBe(true)
    expect(areNeighbours(f, areaOf(f, 'a'), areaOf(f, 'c'))).toBe(true)
  })

  it('is true up to the neighbour distance and false beyond it', () => {
    // Desks 0.25 by 0.25 plan heights: the limit is 0.1875 plan heights, 0.09375 of the width.
    const f = floor('1', [desk('a', 0), desk('atLimit', 0.125 + 0.09375), desk('beyond', 0.125 + 0.09375 + 0.125 + 0.1)])
    expect(neighbourDistance(f)).toBe(0.1875)
    expect(areNeighbours(f, areaOf(f, 'a'), areaOf(f, 'atLimit'))).toBe(true)
    expect(areNeighbours(f, areaOf(f, 'atLimit'), areaOf(f, 'beyond'))).toBe(false)
    expect(areNeighbours(f, areaOf(f, 'a'), areaOf(f, 'beyond'))).toBe(false)
  })

  it('counts a gap exactly at the limit in spite of rounding noise', () => {
    // 0.1 + 0.075 is not exactly 0.175 in binary; the areas are still at the limit.
    const a = area('a', 4, { rect: rect(0.1, 0.1, 0.1, 0.2) })
    const b = area('b', 4, { rect: rect(0.275, 0.1, 0.1, 0.2) })
    const f = floor('1', [a, b])
    expect(areNeighbours(f, a, b)).toBe(true)
  })

  it('is the same in both directions', () => {
    const f = floor('1', [desk('a', 0), desk('b', 0.125), desk('far', 0.75)])
    for (const first of f.areas) {
      for (const second of f.areas) expect(areNeighbours(f, first, second)).toBe(areNeighbours(f, second, first))
    }
  })

  it('looks at the gap between the edges, not at the centres', () => {
    // A long bench next to a small desk: the centres are far apart, the edges touch.
    const bench = area('bench', 8, { rect: rect(0, 0.25, 0.75, 0.25) })
    const small = desk('small', 0.75)
    const f = floor('1', [bench, small])
    expect(areNeighbours(f, bench, small)).toBe(true)
  })
})

describe('clusterAreas', () => {
  const f = floor('1', row(['a', 'b', 'c', 'd', 'e'], 4))

  it('puts areas that are next to each other in one group', () => {
    expect(clusterAreas(f, ['a', 'b'])).toEqual([['a', 'b']])
  })

  it('connects a chain through the areas in between', () => {
    expect(areNeighbours(f, areaOf(f, 'a'), areaOf(f, 'e'))).toBe(false)
    expect(clusterAreas(f, ['a', 'b', 'c', 'd', 'e'])).toEqual([['a', 'b', 'c', 'd', 'e']])
  })

  it('does not connect through an area that is not part of the selection', () => {
    expect(clusterAreas(f, ['a', 'c'])).toEqual([['a'], ['c']])
    expect(clusterAreas(f, ['a', 'b', 'd', 'e'])).toEqual([
      ['a', 'b'],
      ['d', 'e'],
    ])
  })

  it('ignores ids that are not on the floor', () => {
    const upstairs = floor('2', row(['x', 'y'], 4))
    expect(clusterAreas(f, ['a', 'ghost', 'b'])).toEqual([['a', 'b']])
    expect(clusterAreas(f, ['a', ...ids(upstairs.areas)])).toEqual([['a']])
    expect(clusterAreas(f, ids(upstairs.areas))).toEqual([])
  })

  it('keeps the floor order of groups and members, whatever order was asked', () => {
    expect(clusterAreas(f, ['e', 'd', 'b', 'a'])).toEqual([
      ['a', 'b'],
      ['d', 'e'],
    ])
    expect(clusterAreas(f, ['c', 'e', 'a'])).toEqual([['a'], ['c'], ['e']])
  })

  it('orders the groups by their first area on the floor, also when that area joins a later one', () => {
    // On the plan: left and middle side by side, far on its own. In the list far comes second.
    const mixed = floor('1', [desk('left', 0), desk('far', 0.75), desk('middle', 0.125)])
    expect(clusterAreas(mixed, ['middle', 'far', 'left'])).toEqual([['left', 'middle'], ['far']])
  })

  it('counts an id once when it is given twice', () => {
    expect(clusterAreas(f, ['a', 'a', 'b', 'a'])).toEqual([['a', 'b']])
  })

  it('gives no groups for an empty selection', () => {
    expect(clusterAreas(f, [])).toEqual([])
    expect(clusterAreas(floor('empty', []), ['a'])).toEqual([])
  })
})

describe('nearestFirst', () => {
  const anchor = desk('anchor', 0.375)

  it('puts the candidate with the smaller gap to the anchor first', () => {
    const near = desk('near', 0.53125)
    const far = desk('far', 0.75)
    const f = floor('1', [anchor, far, near])
    expect(ids(nearestFirst(f, [anchor], [far, near]))).toEqual(['near', 'far'])
    expect(ids(nearestFirst(f, [anchor], [near, far]))).toEqual(['near', 'far'])
  })

  it('breaks a tie in gap by the nearer centre', () => {
    // Both touch the anchor. The desk beside it has its centre 0.25 away, the tall block
    // below it 0.375; in the floor list the tall block comes first.
    const beside = desk('beside', 0.5)
    const below = area('below', 8, { rect: rect(0.375, 0.5, 0.125, 0.5) })
    const f = floor('1', [anchor, below, beside])
    expect(ids(nearestFirst(f, [anchor], [below, beside]))).toEqual(['beside', 'below'])
  })

  it('breaks a full tie by the order of the areas on the floor', () => {
    const left = desk('left', 0.25)
    const right = desk('right', 0.5)
    expect(ids(nearestFirst(floor('1', [anchor, right, left]), [anchor], [left, right]))).toEqual(['right', 'left'])
    expect(ids(nearestFirst(floor('1', [anchor, left, right]), [anchor], [right, left]))).toEqual(['left', 'right'])
  })

  it('measures from the closest of several anchors', () => {
    const west = desk('west', 0)
    const east = desk('east', 0.875)
    const nearWest = desk('nearWest', 0.25)
    const nearEast = desk('nearEast', 0.6875)
    const f = floor('1', [west, east, nearWest, nearEast])
    // nearWest is 0.125 from west, nearEast only 0.0625 from east.
    expect(ids(nearestFirst(f, [west, east], [nearWest, nearEast]))).toEqual(['nearEast', 'nearWest'])
    expect(ids(nearestFirst(f, [west], [nearWest, nearEast]))).toEqual(['nearWest', 'nearEast'])
  })

  it('keeps the floor order when there is no anchor to measure from', () => {
    const f = floor('1', row(['a', 'b', 'c', 'd'], 4))
    const candidates = [areaOf(f, 'd'), areaOf(f, 'b'), areaOf(f, 'a'), areaOf(f, 'c')]
    expect(ids(nearestFirst(f, [], candidates))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns the candidates themselves in a new list and leaves its inputs as they were', () => {
    const near = desk('near', 0.53125)
    const far = desk('far', 0.75)
    const f = floor('1', [anchor, far, near])
    const anchors = [anchor]
    const candidates = [far, near]
    const ordered = nearestFirst(f, anchors, candidates)
    expect(ordered).not.toBe(candidates)
    expect(ordered[0]).toBe(near)
    expect(ordered[1]).toBe(far)
    expect(candidates).toEqual([far, near])
    expect(anchors).toEqual([anchor])
  })

  it('returns nothing when there are no candidates', () => {
    expect(nearestFirst(floor('1', [anchor]), [anchor], [])).toEqual([])
  })
})

describe('on the real floor 4', () => {
  const floor4: Floor = {
    id: 'floor-4',
    name: 'Floor 4',
    label: '4',
    plan: { src: '', ...FLOOR4_PLAN_SIZE },
    areas: FLOOR4_AREAS,
  }

  /** Areas are looked up by id: the names on the drawing are placeholders and may change. */
  function at(id: string): Area {
    const found = FLOOR4_AREAS.find((a) => a.id === id)
    if (!found) throw new Error(`no area ${id} on floor 4`)
    return found
  }

  const NORTH = ['f4-n1', 'f4-n2', 'f4-n3']
  const NORTH_EAST = ['f4-ne1', 'f4-ne2', 'f4-ne3', 'f4-ne4']
  const SOUTH_EAST = ['f4-se1', 'f4-se2', 'f4-se3', 'f4-se4', 'f4-se5']

  it.each([
    ['N 1, N 2 and N 3', NORTH],
    ['NE 1 to NE 4', NORTH_EAST],
    ['SE 1 to SE 5', SOUTH_EAST],
  ])('sees %s as one group', (_row, areaIds) => {
    expect(clusterAreas(floor4, areaIds)).toEqual([areaIds])
  })

  it('does not see the north row and the south-east row as neighbours', () => {
    for (const north of NORTH) {
      for (const southEast of SOUTH_EAST) {
        expect(areNeighbours(floor4, at(north), at(southEast)), `${north} / ${southEast}`).toBe(false)
      }
    }
    expect(clusterAreas(floor4, [...NORTH, ...SOUTH_EAST])).toEqual([NORTH, SOUTH_EAST])
  })

  it('keeps the three rows apart when all desks are grouped', () => {
    const desks = FLOOR4_AREAS.filter((a) => a.kind === 'desks').map((a) => a.id)
    const groups = clusterAreas(floor4, desks)
    expect(groups).toContainEqual(NORTH)
    expect(groups).toContainEqual(NORTH_EAST)
    expect(groups).toContainEqual(SOUTH_EAST)
    // Every desk area ends up in exactly one group.
    expect(groups.flat().sort()).toEqual([...desks].sort())
  })

  it('does not let rounding noise decide between two equally near areas', () => {
    // N 1 and N 3 are both 24 pixels from N 2. In floating point the two gaps differ in the
    // sixteenth digit, which must not count: the nearer centre decides (142 against 143
    // pixels), so N 1 comes first whatever order the candidates are given in.
    const n1 = at('f4-n1')
    const n2 = at('f4-n2')
    const n3 = at('f4-n3')
    expect(ids(nearestFirst(floor4, [n2], [n3, n1]))).toEqual(['f4-n1', 'f4-n3'])
    expect(ids(nearestFirst(floor4, [n2], [n1, n3]))).toEqual(['f4-n1', 'f4-n3'])
  })

  it('grows outward from the end of the north-east row one neighbour at a time', () => {
    const northEast = NORTH_EAST.map((id) => at(id))
    expect(ids(nearestFirst(floor4, [at('f4-ne4')], northEast))).toEqual(['f4-ne4', 'f4-ne3', 'f4-ne2', 'f4-ne1'])
  })
})

describe('row, the test builder', () => {
  const lengths = [1, 2, 5, 8, 9, 12, 20]
  const rowOf = (length: number) => row(Array.from({ length }, (_, i) => `r${i + 1}`), 4)

  it('makes neighbours in the list neighbours on the plan, and only those', () => {
    for (const length of lengths) {
      const f = floor('1', rowOf(length))
      f.areas.forEach((a, i) => {
        f.areas.forEach((b, j) => {
          expect(areNeighbours(f, a, b), `${a.id} / ${b.id} in a row of ${length}`).toBe(Math.abs(i - j) <= 1)
        })
      })
    }
  })

  it('stays inside the plan however long the row is', () => {
    for (const length of lengths) {
      expect(violations(project([floor('1', rowOf(length))])), `a row of ${length}`).toEqual([])
    }
  })
})
