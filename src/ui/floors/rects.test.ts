import { describe, expect, it } from 'vitest'
import { MIN_RECT_SIZE } from '../../domain/model'
import { area } from '../../domain/testkit'
import type { Rect } from '../../domain/types'
import {
  HANDLES,
  NUDGE,
  NUDGE_BIG,
  areaAt,
  arrowDelta,
  centredRect,
  handlePoint,
  isDrawable,
  moveRect,
  rectBetween,
  resizeRect,
  tidyRect,
} from './rects'

const box: Rect = { x: 0.2, y: 0.3, w: 0.2, h: 0.1 }

function inside(rect: Rect): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= 1 + 1e-9 && rect.y + rect.h <= 1 + 1e-9
}

describe('tidyRect', () => {
  it('rounds away floating point noise', () => {
    const noisy = { x: 0.1 + 0.2, y: 0.30000000000000004, w: 0.1, h: 0.1 }
    expect(noisy.x).not.toBe(0.3)
    expect(tidyRect(noisy)).toEqual({ x: 0.3, y: 0.3, w: 0.1, h: 0.1 })
  })

  it('keeps a rectangle inside the plan and at least the minimum size', () => {
    const rect = tidyRect({ x: 0.95, y: -0.2, w: 0.2, h: 0 })
    expect(rect.w).toBe(0.2)
    expect(rect.h).toBe(MIN_RECT_SIZE)
    expect(rect.y).toBe(0)
    expect(inside(rect)).toBe(true)
  })
})

describe('rectBetween', () => {
  it('spans two points whichever way the drag went', () => {
    const forward = rectBetween({ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.5 })
    const backward = rectBetween({ x: 0.3, y: 0.5 }, { x: 0.1, y: 0.2 })
    expect(forward).toEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.3 })
    expect(backward).toEqual(forward)
  })
})

describe('isDrawable', () => {
  it('needs the minimum size in both directions', () => {
    expect(isDrawable({ x: 0, y: 0, w: MIN_RECT_SIZE, h: MIN_RECT_SIZE })).toBe(true)
    expect(isDrawable({ x: 0, y: 0, w: 0.3, h: MIN_RECT_SIZE / 2 })).toBe(false)
    expect(isDrawable({ x: 0, y: 0, w: 0, h: 0 })).toBe(false)
  })
})

describe('moveRect', () => {
  it('moves by the distance and keeps the size', () => {
    expect(moveRect(box, 0.05, -0.1)).toEqual({ x: 0.25, y: 0.2, w: 0.2, h: 0.1 })
  })

  it('stops at the edges of the plan', () => {
    expect(moveRect(box, -1, -1)).toEqual({ x: 0, y: 0, w: 0.2, h: 0.1 })
    const far = moveRect(box, 1, 1)
    expect(far).toEqual({ x: 0.8, y: 0.9, w: 0.2, h: 0.1 })
    expect(inside(far)).toBe(true)
  })

  it('gives back an equal rectangle for no movement, so nothing is recorded', () => {
    expect(moveRect(box, 0, 0)).toEqual(box)
  })

  it('does not drift when nudged there and back', () => {
    let rect = box
    for (let i = 0; i < 7; i += 1) rect = moveRect(rect, NUDGE, NUDGE)
    for (let i = 0; i < 7; i += 1) rect = moveRect(rect, -NUDGE, -NUDGE)
    expect(rect).toEqual(box)
  })
})

describe('resizeRect', () => {
  it('pulls only the edges of the handle', () => {
    expect(resizeRect(box, 'e', 0.1, 0.5)).toEqual({ x: 0.2, y: 0.3, w: 0.3, h: 0.1 })
    expect(resizeRect(box, 's', 0.5, 0.1)).toEqual({ x: 0.2, y: 0.3, w: 0.2, h: 0.2 })
    expect(resizeRect(box, 'w', -0.1, 0.5)).toEqual({ x: 0.1, y: 0.3, w: 0.3, h: 0.1 })
    expect(resizeRect(box, 'n', 0.5, -0.1)).toEqual({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 })
  })

  it('pulls two edges at a corner and leaves the opposite corner where it is', () => {
    expect(resizeRect(box, 'se', 0.1, 0.1)).toEqual({ x: 0.2, y: 0.3, w: 0.3, h: 0.2 })
    const pulled = resizeRect(box, 'nw', -0.1, -0.1)
    expect(pulled).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.2 })
    expect(pulled.x + pulled.w).toBeCloseTo(box.x + box.w, 9)
    expect(pulled.y + pulled.h).toBeCloseTo(box.y + box.h, 9)
  })

  it('stops at the minimum size instead of flipping over', () => {
    const squeezed = resizeRect(box, 'e', -0.9, 0)
    expect(squeezed.x).toBe(box.x)
    expect(squeezed.w).toBe(MIN_RECT_SIZE)
    const fromLeft = resizeRect(box, 'w', 0.9, 0)
    expect(fromLeft.w).toBe(MIN_RECT_SIZE)
    expect(fromLeft.x + fromLeft.w).toBeCloseTo(box.x + box.w, 9)
  })

  it('stops at the edges of the plan', () => {
    for (const handle of HANDLES) {
      for (const [dx, dy] of [
        [2, 2],
        [-2, -2],
        [2, -2],
        [-2, 2],
      ] as const) {
        const rect = resizeRect(box, handle, dx, dy)
        expect(inside(rect)).toBe(true)
        expect(rect.w).toBeGreaterThanOrEqual(MIN_RECT_SIZE)
        expect(rect.h).toBeGreaterThanOrEqual(MIN_RECT_SIZE)
      }
    }
  })
})

describe('handlePoint', () => {
  it('puts the handles on the corners and the middles of the edges', () => {
    expect(handlePoint(box, 'nw')).toEqual({ x: 0.2, y: 0.3 })
    const bottomRight = handlePoint(box, 'se')
    expect(bottomRight.x).toBeCloseTo(0.4, 9)
    expect(bottomRight.y).toBeCloseTo(0.4, 9)
    const top = handlePoint(box, 'n')
    expect(top.x).toBeCloseTo(0.3, 9)
    expect(top.y).toBe(0.3)
    const right = handlePoint(box, 'e')
    expect(right.x).toBeCloseTo(0.4, 9)
    expect(right.y).toBeCloseTo(0.35, 9)
  })
})

describe('arrowDelta', () => {
  it('turns arrow keys into a small step, or a bigger one', () => {
    expect(arrowDelta('ArrowRight', false)).toEqual({ x: NUDGE, y: 0 })
    expect(arrowDelta('ArrowLeft', false)).toEqual({ x: -NUDGE, y: 0 })
    expect(arrowDelta('ArrowDown', true)).toEqual({ x: 0, y: NUDGE_BIG })
    expect(arrowDelta('ArrowUp', true)).toEqual({ x: 0, y: -NUDGE_BIG })
  })

  it('knows no other keys', () => {
    expect(arrowDelta('Enter', false)).toBeNull()
    expect(arrowDelta('a', true)).toBeNull()
  })
})

describe('areaAt', () => {
  const below = area('below', 4, { rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 } })
  const above = area('above', 4, { rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 } })

  it('finds the area at a point', () => {
    expect(areaAt([below, above], { x: 0.15, y: 0.15 })?.id).toBe('below')
    expect(areaAt([below, above], { x: 0.65, y: 0.65 })?.id).toBe('above')
  })

  it('takes the one drawn on top where areas overlap', () => {
    expect(areaAt([below, above], { x: 0.4, y: 0.4 })?.id).toBe('above')
    expect(areaAt([above, below], { x: 0.4, y: 0.4 })?.id).toBe('below')
  })

  it('finds nothing on the empty sheet', () => {
    expect(areaAt([below, above], { x: 0.9, y: 0.05 })).toBeUndefined()
  })
})

describe('centredRect', () => {
  it('sits in the middle of the plan and looks square on a wide plan', () => {
    const rect = centredRect(2)
    expect(rect).toEqual({ x: 0.45, y: 0.4, w: 0.1, h: 0.2 })
  })

  it('stays inside a very wide plan', () => {
    const rect = centredRect(20)
    expect(rect.h).toBe(0.5)
    expect(inside(rect)).toBe(true)
  })
})
