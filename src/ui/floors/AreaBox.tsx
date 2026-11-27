import type { KeyboardEvent } from 'react'
import { isSeatable } from '../../domain/model'
import type { Area, Rect } from '../../domain/types'
import { dispatch } from '../../state/store'
import { setUi } from '../../state/ui'
import { plural } from '../format'
import { cx, rectStyle } from '../sheet/Sheet'
import { HANDLES, HANDLE_AXIS, arrowDelta, handlePoint, resizeRect, type Handle } from './rects'

const HANDLE_NAME: Record<Handle, string> = {
  nw: 'Top left corner',
  n: 'Top edge',
  ne: 'Top right corner',
  e: 'Right edge',
  se: 'Bottom right corner',
  s: 'Bottom edge',
  sw: 'Bottom left corner',
  w: 'Left edge',
}

function describe(area: Area): string {
  if (area.kind === 'desks') return `${area.name}: ${plural(area.capacity, 'desk')}`
  if (area.kind === 'overflow') return `${area.name}: ${plural(area.capacity, 'overflow seat')}`
  return `${area.name}: no seating`
}

/** One area on the sheet of the Floors view: a box that shows its use, with handles to
 *  resize it while it is selected.
 *
 *  Presses and drags are handled by the sheet (see AreaCanvas), which recognises the box
 *  and its handles by their `data-area-id` and `data-handle` attributes. What is handled
 *  here is the keyboard: Enter or Space on the box selects it, arrow keys on a handle
 *  resize. */
export function AreaBox(props: {
  area: Area
  /** Where to draw it: the stored rectangle, or a draft while the area is being dragged. */
  rect: Rect
  selected: boolean
  tool: 'select' | 'draw'
}) {
  const { area, rect, selected, tool } = props
  const label = describe(area)

  const onHandleKeyDown = (handle: Handle) => (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const step = arrowDelta(e.key, e.shiftKey)
    if (!step) return
    // Also keeps the canvas from moving the whole area with the same key press.
    e.preventDefault()
    dispatch(
      { type: 'area/update', id: area.id, patch: { rect: resizeRect(area.rect, handle, step.x, step.y) } },
      { coalesce: `resize-${area.id}` },
    )
  }

  return (
    <>
      <button
        type="button"
        className={cx(
          'floors-box',
          `floors-box--${area.kind}`,
          selected && 'floors-box--selected',
          // With the Draw tool a press goes through to the sheet, so that a new box can
          // start on top of an existing one.
          tool === 'draw' && 'floors-box--inert',
        )}
        style={rectStyle(rect)}
        data-area-id={area.id}
        data-focus-target={selected ? 'selected-area' : undefined}
        aria-pressed={selected}
        aria-label={label}
        title={label}
        onClick={() => setUi({ selectedAreaId: area.id })}
      >
        <span className={cx('floors-box__tag', selected && 'floors-box__tag--selected')}>
          <span className="truncate">{area.name}</span>
          {isSeatable(area.kind) ? <span className="floors-box__seats sign">{area.capacity}</span> : null}
        </span>
      </button>
      {selected && tool === 'select'
        ? HANDLES.map((handle) => {
            const at = handlePoint(rect, handle)
            return (
              <button
                key={handle}
                type="button"
                className={`floors-handle floors-cursor--${HANDLE_AXIS[handle]}`}
                style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
                data-area-id={area.id}
                data-handle={handle}
                aria-label={`${HANDLE_NAME[handle]} of ${area.name}. Resize with the arrow keys.`}
                onKeyDown={onHandleKeyDown(handle)}
              />
            )
          })
        : null}
    </>
  )
}
