import { MIN_RECT_SIZE, clampRect } from '../../domain/model'
import type { Area, Rect } from '../../domain/types'

/* Rectangle arithmetic for editing areas on the sheet. Everything is in fractions of the
   plan (0..1), like the rectangles a project stores. Pure, so it is tested without a
   browser. */

export interface Point {
  x: number
  y: number
}

/** The eight places a selected area can be pulled at: corners and edge middles, named by
 *  compass direction with the top of the plan as north. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type Handle = (typeof HANDLES)[number]

/** Which edges a handle pulls: -1 is the left or top edge, 1 the right or bottom edge and
 *  0 neither. The same numbers place the handle on the rectangle. */
const HANDLE_EDGES: Record<Handle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
}

/** The line a handle moves along, which is also the name of its resize cursor. */
export type ResizeAxis = 'ns' | 'ew' | 'nwse' | 'nesw'

export const HANDLE_AXIS: Record<Handle, ResizeAxis> = {
  nw: 'nwse',
  n: 'ns',
  ne: 'nesw',
  e: 'ew',
  se: 'nwse',
  s: 'ns',
  sw: 'nesw',
  w: 'ew',
}

/** One press of an arrow key moves things by a quarter of a percent of the plan. */
export const NUDGE = 0.0025
/** With Shift held: a whole percent. */
export const NUDGE_BIG = 0.01
/** A duplicate sits this far right of and below its original, so both stay visible. */
export const DUPLICATE_OFFSET = 0.02

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** A ten-thousandth of the plan is far below a pixel on any screen. Rounding to it keeps
 *  floating point noise (0.30000000000000004) out of nudges and out of saved files. */
const round = (n: number) => Math.round(n * 10000) / 10000

/** A rectangle as it may be stored: rounded, inside the plan, at least the minimum size. */
export function tidyRect(rect: Rect): Rect {
  return clampRect({ x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) })
}

/** The rectangle spanned by two points, whichever way the pointer was dragged. It may be
 *  smaller than an area is allowed to be: see `isDrawable`. */
export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: round(Math.min(a.x, b.x)),
    y: round(Math.min(a.y, b.y)),
    w: round(Math.abs(a.x - b.x)),
    h: round(Math.abs(a.y - b.y)),
  }
}

/** True when a dragged box is big enough to become an area. Anything smaller was a click
 *  or a slip of the hand. */
export function isDrawable(rect: Rect): boolean {
  return rect.w >= MIN_RECT_SIZE && rect.h >= MIN_RECT_SIZE
}

/** The rectangle moved by a distance, stopping at the edges of the plan. Its size stays. */
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  return tidyRect({ ...rect, x: rect.x + dx, y: rect.y + dy })
}

/** The rectangle after pulling one of its handles by a distance. The pulled edges stop at
 *  the edge of the plan and just before the opposite edge, which stays where it is: an area
 *  never flips over and never gets smaller than the minimum size. */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number): Rect {
  const pulls = HANDLE_EDGES[handle]
  let left = rect.x
  let right = rect.x + rect.w
  let top = rect.y
  let bottom = rect.y + rect.h
  if (pulls.x < 0) left = clamp(left + dx, 0, right - MIN_RECT_SIZE)
  if (pulls.x > 0) right = clamp(right + dx, left + MIN_RECT_SIZE, 1)
  if (pulls.y < 0) top = clamp(top + dy, 0, bottom - MIN_RECT_SIZE)
  if (pulls.y > 0) bottom = clamp(bottom + dy, top + MIN_RECT_SIZE, 1)
  return tidyRect({ x: left, y: top, w: right - left, h: bottom - top })
}

/** Where a handle sits on a rectangle. */
export function handlePoint(rect: Rect, handle: Handle): Point {
  const at = HANDLE_EDGES[handle]
  return { x: rect.x + (rect.w * (at.x + 1)) / 2, y: rect.y + (rect.h * (at.y + 1)) / 2 }
}

/** The distance an arrow key stands for, or null for any other key. */
export function arrowDelta(key: string, big: boolean): Point | null {
  const step = big ? NUDGE_BIG : NUDGE
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 }
    case 'ArrowRight':
      return { x: step, y: 0 }
    case 'ArrowUp':
      return { x: 0, y: -step }
    case 'ArrowDown':
      return { x: 0, y: step }
    default:
      return null
  }
}

/** The area drawn on top at a point of the plan, if any. Later areas are painted over
 *  earlier ones, so the last hit is the one the planner sees there. */
export function areaAt(areas: readonly Area[], point: Point): Area | undefined {
  return areas.findLast(
    ({ rect }) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h,
  )
}

/** A box the size of a typical desk cluster in the middle of the plan: the starting point
 *  for an area that is added without drawing it. `aspect` is the plan's width divided by its
 *  height; the box is as high as it is wide on screen. */
export function centredRect(aspect: number): Rect {
  const w = 0.1
  const h = clamp(w * aspect, MIN_RECT_SIZE, 0.5)
  return tidyRect({ x: (1 - w) / 2, y: (1 - h) / 2, w, h })
}
