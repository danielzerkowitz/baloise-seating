import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from 'react'
import { floorCapacity, planAspect } from '../../domain/model'
import type { Area, Floor, Id, Rect } from '../../domain/types'
import { dispatch } from '../../state/store'
import { setUi } from '../../state/ui'
import { IconCursor, IconDrawArea } from '../icons'
import { Paper, Sheet, SheetViewport, cx, pointOnSheet, rectStyle } from '../sheet/Sheet'
import { AreaBox } from './AreaBox'
import { addArea, duplicateArea, removeArea } from './edits'
import {
  HANDLES,
  HANDLE_AXIS,
  areaAt,
  arrowDelta,
  centredRect,
  isDrawable,
  moveRect,
  rectBetween,
  resizeRect,
  type Handle,
  type Point,
  type ResizeAxis,
} from './rects'
import type { RequestFocus } from './useFocusAfterRender'

type Tool = 'select' | 'draw'

const HINT: Record<Tool, string> = {
  select: 'Drag to move, pull a handle to resize. Delete removes.',
  draw: 'Drag a box around a group of desks.',
}

/** A press on an area that travels less than this many pixels is a click, not a move. */
const CLICK_SLOP_PX = 3

/** A drag that is under way. The numbers it started from are kept in a ref, not in state:
 *  pointer events can arrive faster than React renders, and every position is worked out
 *  from where the drag began, never from the previous draft. */
type Drag = {
  pointerId: number
  /** Where the pointer went down, on the plan and on the screen. */
  start: Point
  startClient: Point
  /** False until the pointer has left the click slop. */
  moved: boolean
} & (
  | { kind: 'draw' }
  | { kind: 'move'; areaId: Id; origin: Rect }
  | { kind: 'resize'; areaId: Id; origin: Rect; handle: Handle }
)

/** What a drag looks like right now: the only copy of project data this view keeps, and
 *  only until the pointer is released. `areaId` is null for a box that is being drawn. */
interface Draft {
  areaId: Id | null
  rect: Rect
  /** The cursor to keep while the pointer is away from the box or handle it drags. */
  cursor: 'move' | ResizeAxis | null
}

function rectDuring(drag: Drag, point: Point): Rect {
  if (drag.kind === 'draw') return rectBetween(drag.start, point)
  const dx = point.x - drag.start.x
  const dy = point.y - drag.start.y
  return drag.kind === 'move' ? moveRect(drag.origin, dx, dy) : resizeRect(drag.origin, drag.handle, dx, dy)
}

/** True once the pointer of a drag is, or has been, clearly away from where it went down. */
function hasMoved(drag: Drag, e: { clientX: number; clientY: number }): boolean {
  return drag.moved || Math.hypot(e.clientX - drag.startClient.x, e.clientY - drag.startClient.y) >= CLICK_SLOP_PX
}

/** The area, and the handle if it was one, that a press on the sheet landed on. */
function pressedPart(target: EventTarget, floor: Floor): { area: Area; handle: Handle | null } | null {
  if (!(target instanceof Element)) return null
  const part = target.closest<HTMLElement>('[data-area-id]')
  const area = part ? floor.areas.find((a) => a.id === part.dataset.areaId) : undefined
  if (!part || !area) return null
  return { area, handle: HANDLES.find((handle) => handle === part.dataset.handle) ?? null }
}

/** Keeps the events of a drag coming to the sheet when the pointer leaves it. Not every
 *  environment can: jsdom has no pointer capture, and a browser refuses it for a pointer
 *  that is already up. The drag then only follows the pointer while it is over the sheet. */
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Go on without capture, as described above.
  }
}

function releasePointer(element: Element, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    // Nothing was captured, so there is nothing to release.
  }
}

/** True while a dialog or an open menu owns the keyboard. */
function keyboardIsTaken(target: EventTarget | null): boolean {
  if (document.querySelector('dialog[open]')) return true
  return target instanceof Element && target.closest('[role="menu"]') !== null
}

/** True when a key press is typing: text, a number, a choice in a list. */
function isField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))
}

/** The middle of the Floors view: the tools and the sheet on which areas are drawn, moved
 *  and resized. Mount it with the floor's id as `key`, so every floor starts with its own
 *  tool and without a drag. */
export function AreaCanvas(props: { floor: Floor; selectedAreaId: Id | null; focusTarget: RequestFocus }) {
  const { floor, selectedAreaId, focusTarget } = props
  // A floor without areas can only be drawn on, so it starts with that tool.
  const [tool, setTool] = useState<Tool>(() => (floor.areas.length === 0 ? 'draw' : 'select'))
  const [draft, setDraft] = useState<Draft | null>(null)
  const drag = useRef<Drag | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const capacity = floorCapacity(floor)

  const endDrag = () => {
    const ending = drag.current
    drag.current = null
    setDraft(null)
    if (ending && sheetRef.current) releasePointer(sheetRef.current, ending.pointerId)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // A press on the sheet ends any typing. The browser only takes the focus away after
    // this event, when the press may already have closed the panel with the field in it;
    // leaving the field now lets it store what it holds.
    const focused = document.activeElement
    if (focused instanceof HTMLElement && isField(focused)) focused.blur()
    // A drag whose end never arrived must not swallow the next one.
    endDrag()
    const sheet = e.currentTarget
    const begin = {
      pointerId: e.pointerId,
      start: pointOnSheet(sheet, e.clientX, e.clientY),
      startClient: { x: e.clientX, y: e.clientY },
      moved: false,
    }
    if (tool === 'draw') {
      drag.current = { ...begin, kind: 'draw' }
    } else {
      const pressed = pressedPart(e.target, floor)
      if (!pressed) {
        setUi({ selectedAreaId: null })
        return
      }
      const { area, handle } = pressed
      setUi({ selectedAreaId: area.id })
      drag.current = handle
        ? { ...begin, kind: 'resize', areaId: area.id, origin: area.rect, handle }
        : { ...begin, kind: 'move', areaId: area.id, origin: area.rect }
    }
    capturePointer(sheet, e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== e.pointerId) return
    if (e.buttons === 0) {
      // Nothing is pressed any more, so the release went elsewhere (a context menu opened,
      // the window lost the pointer). Without this the area would stick to the pointer.
      endDrag()
      return
    }
    // A new box follows the pointer from the first pixel. An existing area only starts to
    // move once the press is clearly not a click.
    current.moved = hasMoved(current, e)
    if (current.kind !== 'draw' && !current.moved) return
    const rect = rectDuring(current, pointOnSheet(e.currentTarget, e.clientX, e.clientY))
    if (current.kind === 'draw') setDraft({ areaId: null, rect, cursor: null })
    else if (current.kind === 'move') setDraft({ areaId: current.areaId, rect, cursor: 'move' })
    else setDraft({ areaId: current.areaId, rect, cursor: HANDLE_AXIS[current.handle] })
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const finished = drag.current
    if (!finished || finished.pointerId !== e.pointerId) return
    const rect = rectDuring(finished, pointOnSheet(e.currentTarget, e.clientX, e.clientY))
    endDrag()
    if (finished.kind !== 'draw') {
      // One undo step for the whole drag. A press without movement only selected the area.
      if (hasMoved(finished, e)) dispatch({ type: 'area/update', id: finished.areaId, patch: { rect } })
      return
    }
    if (isDrawable(rect)) {
      // The seats are the one thing only the planner knows: put the cursor there.
      if (addArea(floor.id, rect)) focusTarget('seats')
    } else {
      // Too small for an area, so it was a click: on a box it selects, elsewhere it
      // deselects, as with the Select tool.
      setUi({ selectedAreaId: areaAt(floor.areas, finished.start)?.id ?? null })
    }
  }

  /** The pointer was taken away (the window lost it, a touch was cancelled): no edit. */
  const onPointerLost = (e: PointerEvent<HTMLDivElement>) => {
    // On a touch screen the pressed box holds the pointer first and loses it to the sheet
    // as the drag starts. That event bubbles up to here and is not the end of anything.
    if (e.type === 'lostpointercapture' && e.target !== e.currentTarget) return
    if (drag.current?.pointerId === e.pointerId) endDrag()
  }

  const addInTheMiddle = () => {
    if (addArea(floor.id, centredRect(planAspect(floor)))) focusTarget('seats')
  }

  // Shortcuts work wherever the focus is, as long as nobody is typing: a click on a box
  // does not move the focus there in every browser.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || keyboardIsTaken(e.target)) return

    if (e.key === 'Escape') {
      // One step back per press: out of a drag, out of drawing, out of the selection.
      // Someone who is typing keeps the area whose field they are in.
      if (drag.current) {
        endDrag()
      } else if (tool === 'draw') {
        setTool('select')
      } else if (selectedAreaId !== null && !isField(e.target)) {
        setUi({ selectedAreaId: null })
        // The handles go with the selection; one of them may have had the focus.
        focusTarget('tool', 'if-lost')
      }
      return
    }

    const area = floor.areas.find((a) => a.id === selectedAreaId)
    if (!area || drag.current || isField(e.target)) return
    const command = e.ctrlKey || e.metaKey

    const step = command || e.altKey ? null : arrowDelta(e.key, e.shiftKey)
    if (step) {
      // Otherwise the arrow keys scroll the plan.
      e.preventDefault()
      dispatch(
        { type: 'area/update', id: area.id, patch: { rect: moveRect(area.rect, step.x, step.y) } },
        { coalesce: `nudge-${area.id}` },
      )
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !command && !e.altKey && !e.shiftKey) {
      // Otherwise Backspace takes some browsers a page back.
      e.preventDefault()
      removeArea(area.id)
      // The box, its handles and its properties are gone, and the focus with them if it
      // was there.
      focusTarget('tool', 'if-lost')
    } else if ((e.key === 'd' || e.key === 'D') && command && !e.altKey && !e.shiftKey && !e.repeat) {
      // The browser would bookmark the page.
      e.preventDefault()
      if (duplicateArea(area.id)) focusTarget('selected-area')
    }
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return (
    <section className="floors-canvas" aria-label={`Plan of ${floor.name}`}>
      <div className="floors-toolbar">
        <div className="floors-tools" role="group" aria-label="Tool">
          <button
            type="button"
            className="btn btn--sm"
            aria-pressed={tool === 'select'}
            data-focus-target={tool === 'select' ? 'tool' : undefined}
            onClick={() => setTool('select')}
          >
            <IconCursor />
            Select
          </button>
          <button
            type="button"
            className="btn btn--sm"
            aria-pressed={tool === 'draw'}
            data-focus-target={tool === 'draw' ? 'tool' : undefined}
            onClick={() => setTool('draw')}
          >
            <IconDrawArea />
            Draw area
          </button>
        </div>
        {/* Drawing needs a pointer. This button, which only shows while it has the focus, is
            the way in for the keyboard: from there the arrow keys move the new area and its
            handles resize it. */}
        <button type="button" className="btn btn--sm floors-keyboard-add" onClick={addInTheMiddle}>
          Add an area in the middle
        </button>
        <ul className="floors-tally" aria-label={`Totals of ${floor.name}`}>
          <Count value={floor.areas.length} one="area" many="areas" />
          <Count value={capacity.desks} one="desk" many="desks" />
          <Count value={capacity.overflow} one="overflow seat" many="overflow seats" />
        </ul>
        <p className="floors-toolbar__hint muted small" aria-live="polite">
          {HINT[tool]}
        </p>
      </div>
      <SheetViewport resetKey={floor.id}>
        <Paper>
          <Sheet
            floor={floor}
            ref={sheetRef}
            className={cx(tool === 'draw' && 'floors-sheet--draw', draft?.cursor && `floors-cursor--${draft.cursor}`)}
            role="group"
            aria-label={`Areas of ${floor.name}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerLost}
            onLostPointerCapture={onPointerLost}
          >
            {floor.areas.map((area) => (
              <AreaBox
                key={area.id}
                area={area}
                rect={draft?.areaId === area.id ? draft.rect : area.rect}
                selected={area.id === selectedAreaId}
                tool={tool}
              />
            ))}
            {draft && draft.areaId === null ? <div className="floors-draft" style={rectStyle(draft.rect)} /> : null}
          </Sheet>
        </Paper>
      </SheetViewport>
    </section>
  )
}

/** One number of the tally: "34 areas", with the number as a sign numeral. */
function Count(props: { value: number; one: string; many: string }) {
  return (
    <li className="floors-tally__item">
      <span className="floors-tally__number sign">{props.value}</span> {props.value === 1 ? props.one : props.many}
    </li>
  )
}
