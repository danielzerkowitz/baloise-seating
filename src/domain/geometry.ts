import { planAspect } from './model'
import type { Area, Floor, Id, Rect } from './types'

/* Where areas are relative to each other. Rectangles are stored as fractions of the plan's
   width and height; distances here are in units of the plan's HEIGHT so that horizontal and
   vertical distances compare (x differences are multiplied by the aspect ratio). */

/** Distances are computed from fractions in floating point, so two distances that are equal
 *  on the drawing can differ in their last digits. A difference below this is no difference. */
const NOISE = 1e-9

/** Shortest distance between the edges of two rectangles. 0 when they touch or overlap. */
export function rectGap(a: Rect, b: Rect, aspect: number): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)) * aspect
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))
  return Math.hypot(dx, dy)
}

/** Distance between the centres of two rectangles. */
export function centerDistance(a: Rect, b: Rect, aspect: number): number {
  const dx = (a.x + a.w / 2 - (b.x + b.w / 2)) * aspect
  const dy = a.y + a.h / 2 - (b.y + b.h / 2)
  return Math.hypot(dx, dy)
}

/** How far apart two areas may be and still count as "next to each other" on this floor:
 *  three quarters of the typical (median) shorter side of the floor's seating areas. This
 *  scales with the drawing, so it works for plans of any size and zoom. */
export function neighbourDistance(floor: Floor): number {
  const aspect = planAspect(floor)
  const sides = floor.areas
    .filter((a) => a.kind !== 'no-seating')
    .map((a) => Math.min(a.rect.w * aspect, a.rect.h))
    .sort((x, y) => x - y)
  const median = sides[Math.floor(sides.length / 2)]
  return median === undefined ? 0.1 : median * 0.75
}

/** True when two areas of the floor are next to each other. */
export function areNeighbours(floor: Floor, a: Area, b: Area): boolean {
  return rectGap(a.rect, b.rect, planAspect(floor)) <= neighbourDistance(floor) + NOISE
}

/** Splits the given areas of a floor into groups of areas that are next to each other,
 *  directly or through other areas of the same selection. Ids that are not on the floor are
 *  ignored. Groups and their members keep the floor's area order. */
export function clusterAreas(floor: Floor, areaIds: readonly Id[]): Id[][] {
  const wanted = new Set(areaIds)
  const areas = floor.areas.filter((a) => wanted.has(a.id))
  const aspect = planAspect(floor)
  const limit = neighbourDistance(floor) + NOISE
  const groupOf = new Map<Id, number>()
  const groups: Id[][] = []
  for (const start of areas) {
    if (groupOf.has(start.id)) continue
    const index = groups.length
    const members: Area[] = [start]
    groupOf.set(start.id, index)
    for (let i = 0; i < members.length; i += 1) {
      const current = members[i]
      if (!current) continue
      for (const other of areas) {
        if (groupOf.has(other.id)) continue
        if (rectGap(current.rect, other.rect, aspect) <= limit) {
          groupOf.set(other.id, index)
          members.push(other)
        }
      }
    }
    const ids = new Set(members.map((m) => m.id))
    groups.push(areas.filter((a) => ids.has(a.id)).map((a) => a.id))
  }
  return groups
}

/** The candidates ordered by distance from a set of anchor areas (nearest edge first, then
 *  nearest centre, then floor order), for growing a seating outward from where a team sits. */
export function nearestFirst(floor: Floor, anchors: readonly Area[], candidates: readonly Area[]): Area[] {
  const aspect = planAspect(floor)
  const order = new Map(floor.areas.map((a, i) => [a.id, i]))
  // Distances are compared on a grid as fine as the noise, so that two candidates that are
  // equally far on the drawing really tie and the next criterion decides.
  const steady = (distance: number) => Math.round(distance / NOISE) * NOISE
  const score = (c: Area) => {
    let gap = Number.POSITIVE_INFINITY
    let center = Number.POSITIVE_INFINITY
    for (const anchor of anchors) {
      gap = Math.min(gap, rectGap(anchor.rect, c.rect, aspect))
      center = Math.min(center, centerDistance(anchor.rect, c.rect, aspect))
    }
    return { gap: steady(gap), center: steady(center) }
  }
  return candidates
    .map((c) => ({ c, ...score(c) }))
    .sort(
      (p, q) =>
        p.gap - q.gap || p.center - q.center || (order.get(p.c.id) ?? 0) - (order.get(q.c.id) ?? 0),
    )
    .map((p) => p.c)
}
