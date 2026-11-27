// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFloor } from '../../domain/model'
import { startingProject } from '../../state/seed'
import { dispatch, getProject, projectStore } from '../../state/store'
import { getUi, resetUi, setUi } from '../../state/ui'
import { useShortcuts } from './useShortcuts'

function Harness() {
  useShortcuts()
  return (
    <>
      <input aria-label="A text field" />
      <input type="checkbox" aria-label="A checkbox" />
      <button type="button">A button</button>
    </>
  )
}

/** A key pressed while nothing in particular has the focus. */
function press(key: string, modifiers: KeyboardEventInit = {}): void {
  fireEvent.keyDown(document.body, { key, ...modifiers })
}

function rename(name: string): void {
  act(() => dispatch({ type: 'project/rename', name }))
}

beforeEach(() => {
  projectStore.load(startingProject())
  resetUi()
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('useShortcuts: undo and redo', () => {
  it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z and Ctrl+Y', () => {
    render(<Harness />)
    rename('First')
    rename('Second')

    press('z', { ctrlKey: true })
    expect(getProject().name).toBe('First')

    press('Z', { ctrlKey: true, shiftKey: true })
    expect(getProject().name).toBe('Second')

    press('z', { ctrlKey: true })
    press('y', { ctrlKey: true })
    expect(getProject().name).toBe('Second')
  })

  it('takes Cmd for Ctrl, except with Y', () => {
    render(<Harness />)
    rename('First')

    press('z', { metaKey: true })
    expect(getProject().name).toBe('Office plan')

    press('y', { metaKey: true })
    expect(getProject().name).toBe('Office plan')

    press('z', { metaKey: true, shiftKey: true })
    expect(getProject().name).toBe('First')
  })

  it('works in every view', () => {
    render(<Harness />)
    rename('First')
    setUi({ view: 'floors' })

    press('z', { ctrlKey: true })

    expect(getProject().name).toBe('Office plan')
  })
})

describe('useShortcuts: the Plan view', () => {
  it('chooses Monday to Friday with 1 to 5', () => {
    render(<Harness />)

    press('3')
    expect(getUi().day).toBe('wed')
    press('5')
    expect(getUi().day).toBe('fri')
    press('1')
    expect(getUi().day).toBe('mon')

    press('6')
    press('0')
    expect(getUi().day).toBe('mon')
  })

  it('goes by the number row on keyboards where it types punctuation', () => {
    render(<Harness />)

    press('é', { code: 'Digit2' })

    expect(getUi().day).toBe('tue')
  })

  it('leaves the keys to the browser when Ctrl, Cmd or Alt is held', () => {
    render(<Harness />)

    press('2', { ctrlKey: true })
    press('3', { metaKey: true })
    press('4', { altKey: true })

    expect(getUi().day).toBe('mon')
  })

  it('goes a floor down with "[" and up with "]"', () => {
    render(<Harness />)
    act(() => dispatch({ type: 'floor/add', floor: makeFloor({ name: 'Floor 5' }) }))
    act(() => dispatch({ type: 'floor/add', floor: makeFloor({ name: 'Floor 6' }) }))
    const [four, five, six] = getProject().floors.map((floor) => floor.id)
    setUi({ selectedAreaId: 'f4-ne1' })

    // Nothing chosen yet means the top floor.
    press('[')
    expect(getUi().floorId).toBe(five)
    expect(getUi().selectedAreaId).toBeNull()
    press('[')
    expect(getUi().floorId).toBe(four)
    press('[')
    expect(getUi().floorId).toBe(four)

    press(']')
    press(']')
    expect(getUi().floorId).toBe(six)
    press(']')
    expect(getUi().floorId).toBe(six)
  })

  it('takes a bracket typed with AltGr, but not Ctrl or Cmd with a bracket', () => {
    render(<Harness />)
    act(() => dispatch({ type: 'floor/add', floor: makeFloor({ name: 'Floor 5' }) }))
    const [four, five] = getProject().floors.map((floor) => floor.id)

    press('[', { ctrlKey: true })
    press('[', { metaKey: true })
    expect(getUi().floorId).toBeNull()

    press('[', { ctrlKey: true, altKey: true })
    expect(getUi().floorId).toBe(four)

    press(']', { altKey: true })
    expect(getUi().floorId).toBe(five)
  })

  it('keeps days and floors as they are in the other views', () => {
    render(<Harness />)
    act(() => dispatch({ type: 'floor/add', floor: makeFloor({ name: 'Floor 5' }) }))
    setUi({ view: 'teams' })

    press('4')
    press('[')

    expect(getUi().day).toBe('mon')
    expect(getUi().floorId).toBeNull()
  })
})

describe('useShortcuts: when the keys belong to something else', () => {
  it('does nothing while typing in a text field', () => {
    render(<Harness />)
    rename('First')
    screen.getByLabelText('A text field').focus()

    fireEvent.keyDown(screen.getByLabelText('A text field'), { key: 'z', ctrlKey: true })
    fireEvent.keyDown(screen.getByLabelText('A text field'), { key: '2' })

    expect(getProject().name).toBe('First')
    expect(getUi().day).toBe('mon')
  })

  it('does nothing inside editable text', () => {
    render(<Harness />)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = 0
    document.body.append(editable)
    editable.focus()

    fireEvent.keyDown(editable, { key: '2' })

    expect(getUi().day).toBe('mon')
  })

  it('still works with the focus on a button or a checkbox', () => {
    render(<Harness />)
    rename('First')

    screen.getByLabelText('A checkbox').focus()
    fireEvent.keyDown(screen.getByLabelText('A checkbox'), { key: 'z', ctrlKey: true })
    expect(getProject().name).toBe('Office plan')

    screen.getByRole('button', { name: 'A button' }).focus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'A button' }), { key: '4' })
    expect(getUi().day).toBe('thu')
  })

  it('does nothing while a dialog is open', () => {
    render(<Harness />)
    rename('First')
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)

    press('z', { ctrlKey: true })
    press('2')

    expect(getProject().name).toBe('First')
    expect(getUi().day).toBe('mon')
  })

  it('leaves a key alone that something else has handled already', () => {
    render(<Harness />)
    const handled = (event: KeyboardEvent) => event.preventDefault()
    document.body.addEventListener('keydown', handled)

    press('2')
    document.body.removeEventListener('keydown', handled)

    expect(getUi().day).toBe('mon')
  })

  it('survives a key event without a key, as a browser sends when it fills in a field', () => {
    render(<Harness />)
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', onError)

    document.body.dispatchEvent(new Event('keydown', { bubbles: true }))
    window.removeEventListener('error', onError)

    expect(errors).toEqual([])
    expect(getUi().day).toBe('mon')
  })

  it('stops listening when the app goes away', () => {
    const { unmount } = render(<Harness />)
    unmount()

    press('2')

    expect(getUi().day).toBe('mon')
  })
})
