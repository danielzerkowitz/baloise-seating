import { describe, expect, it } from 'vitest'
import { FLOOR4_AREAS, FLOOR4_PLAN_SIZE } from './floor4'
import { floorCapacity } from './model'
import { project, violations } from './testkit'
import type { Area, Floor, Rect } from './types'

const floor4: Floor = {
  id: 'floor-4',
  name: 'Floor 4',
  label: '4',
  plan: { src: '', ...FLOOR4_PLAN_SIZE },
  areas: FLOOR4_AREAS,
}

const ofKind = (kind: Area['kind']) => FLOOR4_AREAS.filter((a) => a.kind === kind)
const seats = (areas: readonly Area[]) => areas.reduce((total, a) => total + a.capacity, 0)

/** True when two rectangles share more than an edge. The tolerance absorbs the rounding of
 *  the stored fractions, so rectangles that only touch do not count. */
function overlap(a: Rect, b: Rect): boolean {
  const tolerance = 1e-9
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return width > tolerance && height > tolerance
}

function overlappingPairs(areas: readonly Area[]): string[] {
  const pairs: string[] = []
  areas.forEach((a, i) => {
    for (const b of areas.slice(i + 1)) if (overlap(a.rect, b.rect)) pairs.push(`${a.name} / ${b.name}`)
  })
  return pairs
}

describe('floor 4 as traced', () => {
  it('has 66 regular desks in 18 desk areas', () => {
    expect(ofKind('desks')).toHaveLength(18)
    expect(seats(ofKind('desks'))).toBe(66)
  })

  it('has 32 overflow seats in 5 areas', () => {
    expect(ofKind('overflow')).toHaveLength(5)
    expect(seats(ofKind('overflow'))).toBe(32)
  })

  it('has 11 rooms, which never count as capacity', () => {
    expect(ofKind('no-seating')).toHaveLength(11)
    expect(FLOOR4_AREAS).toHaveLength(18 + 5 + 11)
    expect(floorCapacity(floor4)).toEqual({ desks: 66, overflow: 32 })
  })

  it('gives every area a whole number of seats, one or more', () => {
    for (const area of FLOOR4_AREAS) {
      expect(Number.isInteger(area.capacity), area.name).toBe(true)
      expect(area.capacity, area.name).toBeGreaterThanOrEqual(1)
    }
  })

  it('gives every area its own id', () => {
    const ids = FLOOR4_AREAS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses ids that are safe as object keys, in HTML and in a file', () => {
    // Seats are stored in plain objects keyed by area id. A key that looks like a number
    // would be moved to the front of such an object, and a key like "__proto__" would not be
    // stored at all; lower-case words with hyphens, starting with the floor, are neither.
    for (const area of FLOOR4_AREAS) expect(area.id).toMatch(/^f4-[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('gives every area its own name', () => {
    const names = FLOOR4_AREAS.map((a) => a.name.trim().toLowerCase())
    expect(names.every((name) => name.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  it('is traced on a drawing of 2000 by 710 pixels', () => {
    expect(FLOOR4_PLAN_SIZE).toEqual({ width: 2000, height: 710 })
  })

  it('keeps every rectangle inside the plan', () => {
    for (const { name, rect } of FLOOR4_AREAS) {
      expect(rect.x, name).toBeGreaterThanOrEqual(0)
      expect(rect.y, name).toBeGreaterThanOrEqual(0)
      expect(rect.w, name).toBeGreaterThan(0)
      expect(rect.h, name).toBeGreaterThan(0)
      expect(rect.x + rect.w, name).toBeLessThanOrEqual(1)
      expect(rect.y + rect.h, name).toBeLessThanOrEqual(1)
    }
  })

  it('has no two desk areas that overlap', () => {
    expect(overlappingPairs(ofKind('desks'))).toEqual([])
  })

  it('has no two areas of any kind that overlap, so a click on the plan lands in one area', () => {
    expect(overlappingPairs(FLOOR4_AREAS)).toEqual([])
  })

  it('makes a sound project', () => {
    expect(violations(project([floor4]))).toEqual([])
  })
})
