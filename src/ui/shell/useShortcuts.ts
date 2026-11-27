import { useEffect } from 'react'
import { WEEKDAYS } from '../../domain/types'
import { getProject, redo, undo } from '../../state/store'
import { currentFloor, getUi, setUi } from '../../state/ui'

/* Keyboard shortcuts of the whole app. Escape and N belong to the Plan view and are not
   handled here. */

/** Input types without text in them: there is no typing to protect there. */
const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

/** True when the keys belong to the element that has the focus: in a text field the browser's
 *  own editing keys (Ctrl+Z included) must keep working, and digits are text. */
function isTyping(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLInputElement) return !NOT_TEXT.has(element.type)
  return element.closest('[contenteditable]:not([contenteditable="false"])') !== null
}

/** 0 to 4 for the keys 1 to 5, otherwise -1. */
function dayKeyIndex(event: KeyboardEvent): number {
  if (event.ctrlKey || event.metaKey || event.altKey || event.getModifierState('AltGraph')) return -1
  // On AZERTY keyboards the number row types punctuation unless Shift is held, so go by
  // the place of the key as well as by the character it types.
  const numberRow = /^Digit([1-5])$/.exec(event.code)
  return ['1', '2', '3', '4', '5'].indexOf(numberRow?.[1] ?? event.key)
}

/** -1 for "[" (a floor down), 1 for "]" (a floor up), otherwise 0. */
function floorKeyStep(event: KeyboardEvent): -1 | 0 | 1 {
  // Many European keyboards need AltGr or Option to type a bracket, and Windows reports
  // AltGr as Ctrl+Alt. Only Cmd and a plain Ctrl mean a shortcut of the browser.
  if (event.metaKey || (event.ctrlKey && !event.altKey)) return 0
  if (event.key === '[') return -1
  if (event.key === ']') return 1
  return 0
}

/** Shows the floor above (1) or below (-1) the current one, when there is one. */
function stepFloor(by: -1 | 1): void {
  const project = getProject()
  const floor = currentFloor(project, getUi())
  if (!floor) return
  // Floors are stored lowest first.
  const next = project.floors[project.floors.indexOf(floor) + by]
  // An area selected on the floor we leave is not on the floor we go to.
  if (next) setUi({ floorId: next.id, selectedAreaId: null })
}

function onKeyDown(event: KeyboardEvent): void {
  // A browser that fills in a field for you announces it as a key press without a key.
  if (event.defaultPrevented || typeof event.key !== 'string') return
  if (isTyping(document.activeElement) || document.querySelector('dialog[open]')) return

  const key = event.key.toLowerCase()
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === 'y') {
    event.preventDefault()
    redo()
    return
  }

  if (getUi().view !== 'plan') return

  const day = WEEKDAYS[dayKeyIndex(event)]
  if (day) {
    event.preventDefault()
    setUi({ day })
    return
  }
  const step = floorKeyStep(event)
  if (step !== 0) {
    event.preventDefault()
    stepFloor(step)
  }
}

/** Ctrl or Cmd + Z undoes, Ctrl or Cmd + Shift + Z and Ctrl + Y redo. In the Plan view, 1
 *  to 5 choose Monday to Friday, and "[" and "]" go a floor down and up. None of it while
 *  typing in a field or while a dialog is open. */
export function useShortcuts(): void {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
