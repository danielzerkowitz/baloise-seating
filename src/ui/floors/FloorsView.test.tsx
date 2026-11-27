// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyProject, makeFloor } from '../../domain/model'
import { violations } from '../../domain/testkit'
import type { Area, Floor, Team } from '../../domain/types'
import { exampleTeams, startingProject } from '../../state/seed'
import { dispatch, getProject, projectStore, undo } from '../../state/store'
import { getUi, resetUi, setUi } from '../../state/ui'
import { ToastRegion } from '../primitives'
import { FloorsView } from './FloorsView'

/* The starting project has one floor, "Floor 4", with 34 traced areas: 66 desks, 32 overflow
   seats. NW 1 is its first area: six desks in the top left corner. */

const NW1 = 'f4-nw1'

function show() {
  return render(
    <>
      <FloorsView />
      <ToastRegion />
    </>,
  )
}

/** Toasts outlive a test; take away what an earlier one left. */
function dismissToasts() {
  const region = render(<ToastRegion />)
  for (const button of screen.queryAllByRole('button', { name: 'Dismiss' })) fireEvent.click(button)
  region.unmount()
}

function floorNamed(name: string): Floor {
  const floor = getProject().floors.find((f) => f.name === name)
  if (!floor) throw new Error(`No floor named ${name}`)
  return floor
}

function areaOf(id: string): Area {
  for (const floor of getProject().floors) {
    const area = floor.areas.find((a) => a.id === id)
    if (area) return area
  }
  throw new Error(`No area ${id}`)
}

function teamNamed(name: string): Team {
  const team = getProject().teams.find((t) => t.name === name)
  if (!team) throw new Error(`No team named ${name}`)
  return team
}

function addExampleTeams() {
  dispatch({ type: 'team/addMany', teams: exampleTeams(getProject()) })
}

/** jsdom lays nothing out. Give the sheet a size, so pointer positions mean something:
 *  1000 by 500 pixels, so 100 pixels are a tenth of the plan's width and a fifth of its height. */
function sheetOf(floorName: string): HTMLElement {
  const sheet = screen.getByRole('group', { name: `Areas of ${floorName}` })
  const box = { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500 }
  sheet.getBoundingClientRect = () => ({ ...box, toJSON: () => box })
  return sheet
}

function drag(sheet: HTMLElement, from: HTMLElement, start: [number, number], end: [number, number]) {
  fireEvent.pointerDown(from, { pointerId: 1, button: 0, clientX: start[0], clientY: start[1] })
  fireEvent.pointerMove(sheet, { pointerId: 1, buttons: 1, clientX: end[0], clientY: end[1] })
  fireEvent.pointerUp(sheet, { pointerId: 1, clientX: end[0], clientY: end[1] })
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const canUndo = () => projectStore.getSnapshot().canUndo
const undoOnce = () => act(() => undo())

beforeEach(() => {
  projectStore.load(startingProject())
  resetUi()
  dismissToasts()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FloorsView without a floor', () => {
  it('invites to add one', () => {
    projectStore.load(emptyProject())
    show()
    expect(screen.getByRole('heading', { name: 'No floor yet' })).toBeTruthy()
    expect(screen.getByText('Add a floor plan image, then draw a box around each group of desks.')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Add floor' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Draw area' })).toBeNull()
  })

  it('adds the first floor from the empty state, ready to draw on', () => {
    projectStore.load(emptyProject())
    show()
    fireEvent.click(screen.getAllByRole('button', { name: 'Add floor' })[1]!)
    const dialog = within(screen.getByRole('dialog', { name: 'Add a floor' }))
    expect((dialog.getByLabelText('Name') as HTMLInputElement).value).toBe('Floor 1')
    expect(dialog.queryByLabelText('Copy the areas of')).toBeNull()
    fireEvent.click(dialog.getByRole('button', { name: 'Add floor' }))

    expect(getProject().floors).toHaveLength(1)
    const floor = floorNamed('Floor 1')
    expect(floor).toMatchObject({ label: '1', plan: null, areas: [] })
    expect(getUi().floorId).toBe(floor.id)
    expect(screen.queryByRole('dialog')).toBeNull()
    // A floor without areas starts with the tool that makes them.
    expect(button('Draw area').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Drag a box around a group of desks.')).toBeTruthy()
    expect(document.activeElement).toBe(button('Floor 1, 0 desks'))
  })
})

describe('FloorsView with the starting floor', () => {
  it('shows the floor, its totals and how to set it up', () => {
    show()
    expect(button('Floor 4, 66 desks').getAttribute('aria-pressed')).toBe('true')
    const totals = within(screen.getByRole('list', { name: 'Totals of Floor 4' })).getAllByRole('listitem')
    expect(totals.map((item) => item.textContent)).toEqual(['34 areas', '66 desks', '32 overflow seats'])
    expect(button('Select').getAttribute('aria-pressed')).toBe('true')
    expect(button('Draw area').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('Drag to move, pull a handle to resize. Delete removes.')).toBeTruthy()
    // Every area is a button on the sheet.
    const sheet = within(screen.getByRole('group', { name: 'Areas of Floor 4' }))
    expect(sheet.getAllByRole('button')).toHaveLength(34)
    expect(sheet.getByRole('button', { name: 'NW 1: 6 desks' })).toBeTruthy()
    expect(sheet.getByRole('button', { name: 'Touchdown bench: 5 overflow seats' })).toBeTruthy()
    expect(sheet.getByRole('button', { name: 'Meeting room 4.7: no seating' })).toBeTruthy()
    // No area selected: the panel is about the floor.
    const panel = within(screen.getByRole('complementary', { name: 'Floor properties' }))
    expect((panel.getByLabelText('Name') as HTMLInputElement).value).toBe('Floor 4')
    expect((panel.getByLabelText('Sign') as HTMLInputElement).value).toBe('4')
    expect(panel.getByText('34 areas, 66 desks and 32 overflow seats.')).toBeTruthy()
    expect(panel.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Add the floor plan image.',
      'Draw a box around each group of desks and enter its seats.',
      'Mark meeting rooms as No seating.',
    ])
  })

  it('renders with example teams and shows who uses an area', () => {
    addExampleTeams()
    const intake = teamNamed('Claims Intake')
    const admin = teamNamed('Policy Admin')
    dispatch({ type: 'seat/set', teamId: intake.id, areaId: NW1, seats: 4, scope: 'all' })
    dispatch({ type: 'seat/set', teamId: admin.id, areaId: NW1, seats: 2, scope: 'wed' })
    show()
    fireEvent.click(button('NW 1: 6 desks'))

    const panel = within(screen.getByRole('complementary', { name: 'Area properties' }))
    expect(panel.getByRole('heading', { name: 'Used by' })).toBeTruthy()
    const uses = panel.getAllByRole('listitem').map((item) => item.textContent)
    // Policy Admin only sits here on its Wednesday.
    expect(uses).toEqual([`${intake.code}Claims IntakeTue, Thu`, `${admin.code}Policy AdminWed`])
    expect(panel.queryByText(/Teams are still placed here/)).toBeNull()

    // Turning the area into a room keeps the teams and warns about them.
    fireEvent.click(panel.getByRole('radio', { name: 'No seating' }))
    expect(areaOf(NW1).kind).toBe('no-seating')
    expect(
      panel.getByText('Teams are still placed here. They show up as conflicts until you move them.'),
    ).toBeTruthy()
    expect(teamNamed('Claims Intake').seating[NW1]).toBe(4)
    expect(violations(getProject())).toEqual([])
  })

  it('edits the name, use and seats of the selected area', () => {
    show()
    fireEvent.click(button('NW 1: 6 desks'))
    expect(getUi().selectedAreaId).toBe(NW1)
    const panel = within(screen.getByRole('complementary', { name: 'Area properties' }))
    expect(panel.getByRole('heading', { name: 'Area' })).toBeTruthy()

    const name = panel.getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'North' } })
    fireEvent.change(name, { target: { value: 'North-west A' } })
    expect(areaOf(NW1).name).toBe('North-west A')
    // An emptied name is not stored; leaving the field brings the stored one back.
    fireEvent.change(name, { target: { value: '' } })
    expect(areaOf(NW1).name).toBe('North-west A')
    expect(name.value).toBe('')
    fireEvent.blur(name)
    expect(name.value).toBe('North-west A')
    // Typing is one undo step.
    undoOnce()
    expect(areaOf(NW1).name).toBe('NW 1')
    expect(canUndo()).toBe(false)

    const seats = panel.getByLabelText('Seats') as HTMLInputElement
    expect(seats.value).toBe('6')
    fireEvent.change(seats, { target: { value: '8' } })
    expect(areaOf(NW1).capacity).toBe(8)
    fireEvent.change(seats, { target: { value: '' } })
    fireEvent.change(seats, { target: { value: '2.5' } })
    expect(areaOf(NW1).capacity).toBe(8)
    fireEvent.blur(seats)
    expect(seats.value).toBe('8')

    expect((panel.getByRole('radio', { name: 'Desks' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(panel.getByRole('radio', { name: 'Overflow seats' }))
    expect(areaOf(NW1).kind).toBe('overflow')
    expect(button('NW 1: 8 overflow seats')).toBeTruthy()
    expect(violations(getProject())).toEqual([])
  })

  it('keeps what was typed when a press on the sheet closes the panel', () => {
    show()
    const sheet = sheetOf('Floor 4')
    fireEvent.click(button('NW 1: 6 desks'))
    const name = screen.getByLabelText('Name')
    name.focus()
    fireEvent.change(name, { target: { value: 'North-west A ' } })
    expect(areaOf(NW1).name).toBe('North-west A ')
    // On the empty sheet: deselects, and the field goes with the panel.
    fireEvent.pointerDown(sheet, { pointerId: 1, button: 0, clientX: 500, clientY: 250 })
    fireEvent.pointerUp(sheet, { pointerId: 1, clientX: 500, clientY: 250 })
    expect(getUi().selectedAreaId).toBeNull()
    // The space left over from typing is not part of the name.
    expect(areaOf(NW1).name).toBe('North-west A')
  })

  it('draws an area and puts the cursor in its Seats field', () => {
    show()
    fireEvent.click(button('Draw area'))
    expect(screen.getByText('Drag a box around a group of desks.')).toBeTruthy()
    const sheet = sheetOf('Floor 4')

    drag(sheet, sheet, [400, 150], [600, 250])
    const areas = floorNamed('Floor 4').areas
    expect(areas).toHaveLength(35)
    const drawn = areas[34]!
    expect(drawn).toMatchObject({ name: 'Area 35', kind: 'desks', capacity: 4 })
    expect(drawn.rect).toEqual({ x: 0.4, y: 0.3, w: 0.2, h: 0.2 })
    expect(getUi().selectedAreaId).toBe(drawn.id)
    const seats = screen.getByLabelText('Seats') as HTMLInputElement
    expect(document.activeElement).toBe(seats)
    fireEvent.change(seats, { target: { value: '6' } })
    expect(areaOf(drawn.id).capacity).toBe(6)

    // The tool stays, so the next cluster is the next drag: here from bottom right to top left.
    expect(button('Draw area').getAttribute('aria-pressed')).toBe('true')
    drag(sheet, sheet, [900, 450], [700, 400])
    const second = floorNamed('Floor 4').areas[35]!
    expect(second.name).toBe('Area 36')
    expect(second.rect).toEqual({ x: 0.7, y: 0.8, w: 0.2, h: 0.1 })
    expect(document.activeElement).toBe(screen.getByLabelText('Seats'))

    // Escape leaves the tool, also from the field the cursor was put in.
    fireEvent.keyDown(screen.getByLabelText('Seats'), { key: 'Escape' })
    expect(button('Select').getAttribute('aria-pressed')).toBe('true')
    expect(getUi().selectedAreaId).toBe(second.id)
    expect(violations(getProject())).toEqual([])
  })

  it('takes a click with the Draw tool as a click, not as an area', () => {
    show()
    fireEvent.click(button('Draw area'))
    const sheet = sheetOf('Floor 4')
    // On NW 1 (its middle is at about 7% and 18% of the plan): selects it.
    drag(sheet, sheet, [66, 88], [67, 89])
    expect(getUi().selectedAreaId).toBe(NW1)
    // On the empty sheet: deselects.
    drag(sheet, sheet, [500, 250], [500, 250])
    expect(getUi().selectedAreaId).toBeNull()
    expect(floorNamed('Floor 4').areas).toHaveLength(34)
    expect(canUndo()).toBe(false)
  })

  it('moves an area by dragging it, as one undo step', () => {
    show()
    const sheet = sheetOf('Floor 4')
    const before = areaOf(NW1).rect
    // 50 pixels right and 25 down are 5% of the plan each way.
    drag(sheet, button('NW 1: 6 desks'), [60, 80], [110, 105])
    const after = areaOf(NW1).rect
    expect(after.x).toBeCloseTo(before.x + 0.05, 4)
    expect(after.y).toBeCloseTo(before.y + 0.05, 4)
    expect(after.w).toBe(before.w)
    expect(after.h).toBe(before.h)
    expect(getUi().selectedAreaId).toBe(NW1)
    undoOnce()
    expect(areaOf(NW1).rect).toEqual(before)
    expect(canUndo()).toBe(false)
  })

  it('shows the area where it is being dragged, and nothing changes until it is dropped', () => {
    show()
    const sheet = sheetOf('Floor 4')
    const box = button('NW 1: 6 desks')
    const before = areaOf(NW1).rect
    fireEvent.pointerDown(box, { pointerId: 1, button: 0, clientX: 60, clientY: 80 })
    // 100 pixels to the right: a tenth of the plan.
    fireEvent.pointerMove(sheet, { pointerId: 1, buttons: 1, clientX: 160, clientY: 80 })
    expect(parseFloat(box.style.left)).toBeCloseTo((before.x + 0.1) * 100, 6)
    expect(areaOf(NW1).rect).toEqual(before)
    // Escape calls the drag off.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(parseFloat(box.style.left)).toBeCloseTo(before.x * 100, 6)
    fireEvent.pointerUp(sheet, { pointerId: 1, clientX: 160, clientY: 80 })
    expect(areaOf(NW1).rect).toEqual(before)
    expect(canUndo()).toBe(false)
  })

  it('lets go of an area when the release of the pointer was missed', () => {
    show()
    const sheet = sheetOf('Floor 4')
    const box = button('NW 1: 6 desks')
    const before = areaOf(NW1).rect
    fireEvent.pointerDown(box, { pointerId: 1, button: 0, clientX: 60, clientY: 80 })
    fireEvent.pointerMove(sheet, { pointerId: 1, buttons: 1, clientX: 160, clientY: 80 })
    expect(parseFloat(box.style.left)).toBeCloseTo((before.x + 0.1) * 100, 6)
    // The pointer comes back with nothing pressed: the button was released somewhere else.
    fireEvent.pointerMove(sheet, { pointerId: 1, buttons: 0, clientX: 300, clientY: 200 })
    expect(parseFloat(box.style.left)).toBeCloseTo(before.x * 100, 6)
    fireEvent.pointerMove(sheet, { pointerId: 1, buttons: 0, clientX: 400, clientY: 300 })
    expect(parseFloat(box.style.left)).toBeCloseTo(before.x * 100, 6)
    expect(areaOf(NW1).rect).toEqual(before)
    expect(canUndo()).toBe(false)
  })

  it('calls a drag off when the pointer is taken away from the sheet', () => {
    show()
    const sheet = sheetOf('Floor 4')
    const box = button('NW 1: 6 desks')
    const before = areaOf(NW1).rect
    fireEvent.pointerDown(box, { pointerId: 1, button: 0, clientX: 60, clientY: 80 })
    fireEvent.pointerMove(sheet, { pointerId: 1, buttons: 1, clientX: 160, clientY: 80 })
    // On a touch screen the pressed box hands the pointer over to the sheet: not an end.
    fireEvent.lostPointerCapture(box, { pointerId: 1 })
    expect(parseFloat(box.style.left)).toBeCloseTo((before.x + 0.1) * 100, 6)
    // The sheet itself losing it is.
    fireEvent.lostPointerCapture(sheet, { pointerId: 1 })
    expect(parseFloat(box.style.left)).toBeCloseTo(before.x * 100, 6)
    fireEvent.pointerUp(sheet, { pointerId: 1, clientX: 160, clientY: 80 })
    expect(areaOf(NW1).rect).toEqual(before)
    expect(canUndo()).toBe(false)
  })

  it('takes a press without movement as a click that selects', () => {
    show()
    const sheet = sheetOf('Floor 4')
    const before = areaOf(NW1).rect
    drag(sheet, button('NW 1: 6 desks'), [60, 80], [61, 81])
    expect(getUi().selectedAreaId).toBe(NW1)
    expect(areaOf(NW1).rect).toEqual(before)
    expect(canUndo()).toBe(false)
    // A press on the empty sheet deselects.
    fireEvent.pointerDown(sheet, { pointerId: 1, button: 0, clientX: 500, clientY: 250 })
    fireEvent.pointerUp(sheet, { pointerId: 1, clientX: 500, clientY: 250 })
    expect(getUi().selectedAreaId).toBeNull()
  })

  it('resizes the selected area by its handles, with the pointer and with the keyboard', () => {
    show()
    const sheet = sheetOf('Floor 4')
    fireEvent.click(button('NW 1: 6 desks'))
    const before = areaOf(NW1).rect
    expect(within(sheet).getAllByRole('button', { name: /of NW 1\. Resize with the arrow keys\.$/ })).toHaveLength(8)

    // 100 pixels right and 50 down are a tenth of the plan each way.
    drag(sheet, button(/^Bottom right corner of NW 1/), [100, 100], [200, 150])
    const pulled = areaOf(NW1).rect
    expect(pulled.x).toBe(before.x)
    expect(pulled.y).toBe(before.y)
    expect(pulled.w).toBeCloseTo(before.w + 0.1, 4)
    expect(pulled.h).toBeCloseTo(before.h + 0.1, 4)

    // An arrow key on a handle moves that edge, not the area.
    fireEvent.keyDown(button(/^Left edge of NW 1/), { key: 'ArrowLeft' })
    const widened = areaOf(NW1).rect
    expect(widened.x).toBeCloseTo(before.x - 0.0025, 4)
    expect(widened.x + widened.w).toBeCloseTo(pulled.x + pulled.w, 4)
    expect(widened.y).toBe(before.y)
    expect(violations(getProject())).toEqual([])
  })

  it('nudges, duplicates and removes the selected area with the keyboard', () => {
    show()
    fireEvent.click(button('NW 1: 6 desks'))
    const before = areaOf(NW1).rect

    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    fireEvent.keyDown(document.body, { key: 'ArrowDown', shiftKey: true })
    const nudged = areaOf(NW1).rect
    expect(nudged.x).toBeCloseTo(before.x + 0.005, 4)
    expect(nudged.y).toBeCloseTo(before.y + 0.01, 4)
    // A burst of nudges is one undo step.
    undoOnce()
    expect(areaOf(NW1).rect).toEqual(before)
    expect(canUndo()).toBe(false)

    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true })
    const areas = floorNamed('Floor 4').areas
    expect(areas).toHaveLength(35)
    const copy = areas[34]!
    expect(copy).toMatchObject({ name: 'Area 35', kind: 'desks', capacity: 6 })
    expect(copy.rect.x).toBeCloseTo(before.x + 0.02, 4)
    expect(copy.rect.y).toBeCloseTo(before.y + 0.02, 4)
    expect(copy.rect.w).toBe(before.w)
    expect(copy.rect.h).toBe(before.h)
    expect(getUi().selectedAreaId).toBe(copy.id)
    expect(document.activeElement).toBe(button('Area 35: 6 desks'))

    fireEvent.keyDown(document.activeElement!, { key: 'Delete' })
    expect(floorNamed('Floor 4').areas).toHaveLength(34)
    expect(getUi().selectedAreaId).toBeNull()
    expect(screen.getByText('Removed Area 35')).toBeTruthy()
    // The box that had the focus is gone; the keyboard goes on at the tools.
    expect(document.activeElement).toBe(button('Select'))
    fireEvent.click(button('Undo'))
    expect(floorNamed('Floor 4').areas).toHaveLength(35)
    expect(violations(getProject())).toEqual([])
  })

  it('leaves the keys to a field that is being typed in', () => {
    show()
    fireEvent.click(button('NW 1: 6 desks'))
    const before = areaOf(NW1).rect
    const name = screen.getByLabelText('Name')
    name.focus()
    for (const key of ['Backspace', 'Delete', 'ArrowLeft', 'ArrowDown']) fireEvent.keyDown(name, { key })
    fireEvent.keyDown(name, { key: 'd', ctrlKey: true })
    expect(floorNamed('Floor 4').areas).toHaveLength(34)
    expect(areaOf(NW1).rect).toEqual(before)
    // Escape there keeps the area whose name is being typed.
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(getUi().selectedAreaId).toBe(NW1)
    // Away from a field, Escape deselects.
    fireEvent.keyDown(button('NW 1: 6 desks'), { key: 'Escape' })
    expect(getUi().selectedAreaId).toBeNull()
  })

  it('duplicates and removes an area with the buttons, and says who lost seats', () => {
    addExampleTeams()
    const intake = teamNamed('Claims Intake')
    dispatch({ type: 'seat/set', teamId: intake.id, areaId: NW1, seats: 6, scope: 'all' })
    show()
    fireEvent.click(button('NW 1: 6 desks'))

    fireEvent.click(button('Duplicate'))
    const copy = floorNamed('Floor 4').areas[34]!
    expect(copy).toMatchObject({ name: 'Area 35', kind: 'desks', capacity: 6 })
    expect(getUi().selectedAreaId).toBe(copy.id)
    expect(document.activeElement).toBe(button('Area 35: 6 desks'))

    fireEvent.click(button('NW 1: 6 desks'))
    const remove = button('Remove area')
    remove.focus()
    fireEvent.click(remove)
    expect(floorNamed('Floor 4').areas.some((area) => area.id === NW1)).toBe(false)
    expect(screen.getByText('Removed NW 1. 1 team lost its seats there.')).toBeTruthy()
    expect(teamNamed('Claims Intake').seating).toEqual({})
    expect(document.activeElement).toBe(button('Select'))
    expect(violations(getProject())).toEqual([])

    fireEvent.click(button('Undo'))
    expect(areaOf(NW1).capacity).toBe(6)
    expect(teamNamed('Claims Intake').seating).toEqual({ [NW1]: 6 })
  })

  it('adds an area without a pointer', () => {
    show()
    fireEvent.click(button('Add an area in the middle'))
    const added = floorNamed('Floor 4').areas[34]!
    expect(added.name).toBe('Area 35')
    // In the middle of the plan.
    expect(added.rect.x + added.rect.w / 2).toBeCloseTo(0.5, 3)
    expect(added.rect.y + added.rect.h / 2).toBeCloseTo(0.5, 3)
    expect(getUi().selectedAreaId).toBe(added.id)
    expect(document.activeElement).toBe(screen.getByLabelText('Seats'))
    expect(violations(getProject())).toEqual([])
  })

  it('makes every edit once when React runs its effects twice, as the app does in development', () => {
    render(
      <StrictMode>
        <FloorsView />
      </StrictMode>,
    )
    const sheet = sheetOf('Floor 4')
    fireEvent.click(button('NW 1: 6 desks'))
    const before = areaOf(NW1).rect
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(areaOf(NW1).rect.x).toBeCloseTo(before.x + 0.0025, 6)
    fireEvent.keyDown(document.body, { key: 'd', metaKey: true })
    expect(floorNamed('Floor 4').areas).toHaveLength(35)
    fireEvent.click(button('Draw area'))
    drag(sheet, sheet, [400, 150], [600, 250])
    expect(floorNamed('Floor 4').areas).toHaveLength(36)
    expect(document.activeElement).toBe(screen.getByLabelText('Seats'))
    expect(violations(getProject())).toEqual([])
  })

  it('lands on the area that was chosen in the Plan view', () => {
    setUi({ view: 'floors', selectedAreaId: 'f4-ne1' })
    show()
    const panel = within(screen.getByRole('complementary', { name: 'Area properties' }))
    expect((panel.getByLabelText('Name') as HTMLInputElement).value).toBe('NE 1')
    expect(button('NE 1: 4 desks').getAttribute('aria-pressed')).toBe('true')
  })

  it('takes a selected area on another floor as no selection', () => {
    const roof = makeFloor({ name: 'Roof' })
    dispatch({ type: 'floor/add', floor: roof })
    setUi({ floorId: roof.id, selectedAreaId: NW1 })
    show()
    expect(screen.getByRole('complementary', { name: 'Floor properties' })).toBeTruthy()
    expect(button('Roof, 0 desks').getAttribute('aria-pressed')).toBe('true')
    // Choosing another floor clears the selection for good.
    fireEvent.click(button('Floor 4, 66 desks'))
    expect(getUi()).toMatchObject({ floorId: 'floor-4', selectedAreaId: null })
  })
})

describe('FloorsView: floors', () => {
  it('adds a floor through the dialog and shows it', () => {
    show()
    fireEvent.click(button('Add floor'))
    const dialog = within(screen.getByRole('dialog', { name: 'Add a floor' }))
    const name = dialog.getByLabelText('Name') as HTMLInputElement
    const sign = dialog.getByLabelText('Sign') as HTMLInputElement
    expect(name.value).toBe('Floor 2')
    expect(document.activeElement).toBe(name)
    // The sign follows the name until it is typed itself.
    expect(sign.value).toBe('2')
    fireEvent.change(name, { target: { value: 'Floor 5' } })
    expect(sign.value).toBe('5')
    fireEvent.change(sign, { target: { value: 'V' } })
    fireEvent.change(name, { target: { value: 'Fifth floor' } })
    expect(sign.value).toBe('V')
    fireEvent.click(dialog.getByRole('button', { name: 'Add floor' }))

    expect(getProject().floors.map((floor) => floor.name)).toEqual(['Floor 4', 'Fifth floor'])
    const added = floorNamed('Fifth floor')
    expect(added).toMatchObject({ label: 'V', plan: null, areas: [] })
    expect(getUi()).toMatchObject({ floorId: added.id, selectedAreaId: null })
    expect(screen.queryByRole('dialog')).toBeNull()
    // Top floor first in the list, and the new one is shown.
    const rows = within(screen.getByRole('region', { name: 'Floors' })).getAllByRole('button', { name: /desks$/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Fifth floor, 0 desks', 'Floor 4, 66 desks'])
    expect(button('Fifth floor, 0 desks').getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(button('Fifth floor, 0 desks'))
    expect(violations(getProject())).toEqual([])
  })

  it('asks for a name and adds nothing without one', () => {
    show()
    fireEvent.click(button('Add floor'))
    const dialog = within(screen.getByRole('dialog', { name: 'Add a floor' }))
    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Add floor' }))
    expect(dialog.getByText('Enter a name for the floor.')).toBeTruthy()
    expect(getProject().floors).toHaveLength(1)
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // The next opening starts fresh.
    fireEvent.click(button('Add floor'))
    const again = within(screen.getByRole('dialog', { name: 'Add a floor' }))
    expect((again.getByLabelText('Name') as HTMLInputElement).value).toBe('Floor 2')
    expect(again.queryByText('Enter a name for the floor.')).toBeNull()
  })

  it('copies the areas of a floor with the same layout', () => {
    show()
    fireEvent.click(button('Add floor'))
    const dialog = within(screen.getByRole('dialog', { name: 'Add a floor' }))
    expect(dialog.getByText('Without an image you get a blank sheet to draw on.')).toBeTruthy()
    fireEvent.change(dialog.getByLabelText('Copy the areas of'), { target: { value: 'floor-4' } })
    expect(dialog.getByText('Without an image the new floor uses the image of Floor 4.')).toBeTruthy()
    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'Floor 3' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Add floor' }))

    const original = floorNamed('Floor 4')
    const copy = floorNamed('Floor 3')
    expect(copy.label).toBe('3')
    expect(copy.plan).toEqual(original.plan)
    expect(copy.areas.map(({ name, kind, capacity, rect }) => ({ name, kind, capacity, rect }))).toEqual(
      original.areas.map(({ name, kind, capacity, rect }) => ({ name, kind, capacity, rect })),
    )
    // New ids throughout: the two floors are edited apart.
    expect(violations(getProject())).toEqual([])
    // It has areas, so it opens with the Select tool.
    expect(button('Select').getAttribute('aria-pressed')).toBe('true')
  })

  it('shows what is wrong with a file under the image field', async () => {
    show()
    fireEvent.click(button('Add floor'))
    const dialog = within(screen.getByRole('dialog', { name: 'Add a floor' }))
    const file = dialog.getByLabelText('Floor plan image')
    fireEvent.change(file, { target: { files: [new File(['%PDF-1.7'], 'floor-5.pdf', { type: 'application/pdf' })] } })
    expect(await dialog.findByText('This is a PDF. Export the page as PNG or JPG and add that.')).toBeTruthy()
    expect(file.getAttribute('aria-invalid')).toBe('true')
    // The floor can still be added, on a blank sheet.
    fireEvent.click(dialog.getByRole('button', { name: 'Add floor' }))
    expect(floorNamed('Floor 2').plan).toBeNull()
  })

  it('takes a dropped image as the plan of the new floor', async () => {
    vi.stubGlobal('Image', imageOfSize(1200, 800))
    show()
    fireEvent.click(button('Add floor'))
    const dialog = within(screen.getByRole('dialog', { name: 'Add a floor' }))
    const zone = dialog.getByLabelText('Floor plan image').parentElement!
    const file = new File(['png bytes'], 'floor-5.png', { type: 'image/png' })
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(await dialog.findByText('1200 by 800 pixels')).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: 'Add floor' }))
    expect(floorNamed('Floor 2').plan).toEqual({
      src: `data:image/png;base64,${btoa('png bytes')}`,
      width: 1200,
      height: 800,
    })
  })

  it('duplicates a floor and moves floors up and down', () => {
    // A sign that was typed by hand, not the "4" that the name would give.
    dispatch({ type: 'floor/update', id: 'floor-4', patch: { label: 'IV' } })
    show()
    fireEvent.click(button('More for Floor 4'))
    // The only floor is top and bottom at once.
    expect(screen.getByRole('menuitem', { name: 'Move up' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('menuitem', { name: 'Move down' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))

    expect(getProject().floors.map((floor) => floor.name)).toEqual(['Floor 4', 'Floor 4 copy'])
    const copy = floorNamed('Floor 4 copy')
    expect(copy.label).toBe('IV')
    expect(copy.plan).toEqual(floorNamed('Floor 4').plan)
    expect(copy.areas).toHaveLength(34)
    expect(getUi().floorId).toBe(copy.id)
    expect(button('Floor 4 copy, 66 desks').getAttribute('aria-pressed')).toBe('true')
    expect(violations(getProject())).toEqual([])

    // The copy is the top floor: it can only go down.
    fireEvent.click(button('More for Floor 4 copy'))
    expect(screen.getByRole('menuitem', { name: 'Move up' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }))
    expect(getProject().floors.map((floor) => floor.name)).toEqual(['Floor 4 copy', 'Floor 4'])
    expect(document.activeElement).toBe(button('More for Floor 4 copy'))

    fireEvent.click(button('More for Floor 4 copy'))
    expect(screen.getByRole('menuitem', { name: 'Move down' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }))
    expect(getProject().floors.map((floor) => floor.name)).toEqual(['Floor 4', 'Floor 4 copy'])
  })

  it('removes a floor, says who lost seats, and brings it back on Undo', () => {
    addExampleTeams()
    dispatch({ type: 'seat/set', teamId: teamNamed('Claims Intake').id, areaId: NW1, seats: 6, scope: 'all' })
    dispatch({ type: 'seat/set', teamId: teamNamed('Underwriting').id, areaId: 'f4-ne1', seats: 4, scope: 'tue' })
    setUi({ selectedAreaId: NW1 })
    show()

    fireEvent.click(button('More for Floor 4'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove floor' }))
    expect(getProject().floors).toHaveLength(0)
    expect(screen.getByText('Removed Floor 4. 2 teams lost their seats there.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'No floor yet' })).toBeTruthy()
    expect(getUi().selectedAreaId).toBeNull()
    expect(teamNamed('Claims Intake').seating).toEqual({})
    expect(violations(getProject())).toEqual([])
    // The row with its menu is gone; the keyboard goes on at "Add floor".
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Add floor' })[0])

    fireEvent.click(button('Undo'))
    expect(getProject().floors.map((floor) => floor.name)).toEqual(['Floor 4'])
    expect(teamNamed('Claims Intake').seating).toEqual({ [NW1]: 6 })
    expect(button('Floor 4, 66 desks').getAttribute('aria-pressed')).toBe('true')
  })

  it('says nothing about teams when a floor without seated teams is removed', () => {
    show()
    fireEvent.click(button('More for Floor 4'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove floor' }))
    expect(screen.getByText('Removed Floor 4')).toBeTruthy()
  })

  it('renames the floor and changes its sign', () => {
    show()
    const panel = within(screen.getByRole('complementary', { name: 'Floor properties' }))
    fireEvent.change(panel.getByLabelText('Name'), { target: { value: 'Fourth floor' } })
    fireEvent.change(panel.getByLabelText('Sign'), { target: { value: 'IV' } })
    expect(floorNamed('Fourth floor').label).toBe('IV')
    expect(panel.getByRole('heading', { name: 'Fourth floor' })).toBeTruthy()
    expect(button('Fourth floor, 66 desks')).toBeTruthy()
    // An emptied sign is not stored.
    fireEvent.change(panel.getByLabelText('Sign'), { target: { value: '' } })
    expect(floorNamed('Fourth floor').label).toBe('IV')
  })

  it('removes and replaces the plan image, and the areas keep their places', async () => {
    vi.stubGlobal('Image', imageOfSize(1000, 1000))
    const { container } = show()
    const areasBefore = floorNamed('Floor 4').areas
    const panel = within(screen.getByRole('complementary', { name: 'Floor properties' }))
    expect(panel.getByRole('img', { name: 'Floor plan of Floor 4' })).toBeTruthy()

    fireEvent.click(panel.getByRole('button', { name: 'Remove image' }))
    expect(floorNamed('Floor 4').plan).toBeNull()
    expect(screen.getByText('Removed the image of Floor 4')).toBeTruthy()
    expect(panel.queryByRole('button', { name: 'Remove image' })).toBeNull()
    expect(document.activeElement).toBe(panel.getByRole('button', { name: 'Add image' }))
    fireEvent.click(button('Undo'))
    expect(floorNamed('Floor 4').plan).not.toBeNull()

    // A square image in place of one that is nearly three times as wide as high.
    const file = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(file, { target: { files: [new File(['png bytes'], 'new.png', { type: 'image/png' })] } })
    expect(
      await panel.findByText('The new image has other proportions. Check that the areas still line up.'),
    ).toBeTruthy()
    expect(floorNamed('Floor 4').plan).toMatchObject({ width: 1000, height: 1000 })
    expect(floorNamed('Floor 4').areas).toEqual(areasBefore)
    expect(panel.getByRole('button', { name: 'Replace image' })).toBeTruthy()

    // A file that is no image is reported, and the plan stays.
    fireEvent.change(file, { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } })
    expect(await panel.findByText('Use a PNG, JPG, WebP or SVG image.')).toBeTruthy()
    expect(floorNamed('Floor 4').plan).toMatchObject({ width: 1000, height: 1000 })
  })
})

/** jsdom decodes no images. This stand-in reports a size as soon as it is given a source. */
function imageOfSize(width: number, height: number) {
  return class {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = 0
    naturalHeight = 0

    set src(_value: string) {
      queueMicrotask(() => {
        this.naturalWidth = width
        this.naturalHeight = height
        this.onload?.()
      })
    }
  }
}
