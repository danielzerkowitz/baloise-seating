import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { IconCheck } from '../icons'

/* Small surfaces that float next to something in the table: a team's colours, its expected
   attendance, the menu of a day or of a row.

   They are rendered in <body> and positioned on the window. The table scrolls sideways when
   the window is narrow, and a box that scrolls cuts off whatever hangs out of it; a list
   that drops out of the last row would be lost. */

const GAP = 4
const MARGIN = 8

const FOCUSABLE = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
}

/** Puts the popover under its anchor, or above it when there is no room below, and keeps
 *  it inside the window. */
function place(popover: HTMLElement, anchor: HTMLElement, align: 'start' | 'end'): void {
  const box = anchor.getBoundingClientRect()
  const width = popover.offsetWidth
  const height = popover.offsetHeight
  const maxLeft = document.documentElement.clientWidth - width - MARGIN
  const maxTop = document.documentElement.clientHeight - height - MARGIN
  const below = box.bottom + GAP
  const above = box.top - GAP - height
  const top = below > maxTop && above >= MARGIN ? above : below
  const left = align === 'start' ? box.left : box.right - width
  popover.style.left = `${Math.round(Math.max(MARGIN, Math.min(left, maxLeft)))}px`
  popover.style.top = `${Math.round(Math.max(MARGIN, Math.min(top, maxTop)))}px`
}

export interface PopoverProps {
  /** What the popover hangs under. A press on the anchor is left to the anchor's own
   *  handlers, so a button in it can open and close the popover. */
  anchorRef: RefObject<HTMLElement | null>
  /** Accessible name. */
  label: string
  role?: 'dialog' | 'menu'
  /** The edge of the anchor that the popover lines up with. */
  align?: 'start' | 'end'
  /** The popover should go away. `refocus` says whether the focus should return to where
   *  it came from; it is false after a press somewhere else, because the focus then
   *  belongs where the press went. */
  onClose: (refocus: boolean) => void
  /** The control that takes the focus when the popover opens. Default: the first one. */
  initialFocus?: (popover: HTMLElement) => HTMLElement | null
  className?: string
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}

/** Render it while it is open; unmount it to close. It asks to be closed (through `onClose`)
 *  on Escape, on a press outside, on Enter in one of its fields, and when the focus is
 *  tabbed out of it. */
export function Popover(props: PopoverProps) {
  const { anchorRef, label, role = 'dialog', align = 'start', onClose, initialFocus, className, children } = props
  const ref = useRef<HTMLDivElement>(null)

  // In place before the first paint, and kept next to the anchor while the page moves.
  useLayoutEffect(() => {
    const popover = ref.current
    const anchor = anchorRef.current
    if (!popover || !anchor) return
    const update = () => place(popover, anchor, align)
    update()
    window.addEventListener('resize', update)
    // Captured, because the scroll events of the regions that scroll here do not bubble.
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef, align])

  // The focus moves in once, when the popover opens. That is why this effect has no
  // dependencies: `initialFocus` is only asked at that moment.
  useLayoutEffect(() => {
    const popover = ref.current
    if (!popover) return
    const target = initialFocus?.(popover) ?? focusables(popover)[0] ?? popover
    // The popover is fixed to the window: there is nothing to scroll into view.
    target.focus({ preventScroll: true })
    // As when tabbing into a field: its text is selected, ready to be replaced.
    if (target instanceof HTMLInputElement) target.select()
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Escape closes this popover and nothing behind it.
      event.stopPropagation()
      onClose(true)
    }
    // Captured, so the popover hears both wherever the focus is and whoever else listens.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchorRef, onClose])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    props.onKeyDown?.(event)
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      // Enter in a field says the edit is done. The key press is ended here: what is left
      // of it would otherwise "click" the button that gets the focus back, and open the
      // popover again.
      event.preventDefault()
      onClose(true)
      return
    }
    if (event.key !== 'Tab') return
    const controls = focusables(event.currentTarget)
    const last = event.shiftKey ? controls[0] : controls[controls.length - 1]
    const backFromTheFrame = event.shiftKey && document.activeElement === event.currentTarget
    // Tabbing on from the last control (or back from the first) leaves the popover; a menu
    // is left by any Tab. The focus returns to where the popover came from, and the browser
    // then moves it on from there, as if the popover stood right behind its anchor.
    if (role === 'menu' || last === undefined || document.activeElement === last || backFromTheFrame) onClose(true)
  }

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      tabIndex={-1}
      className={className ? `popover teams-popover ${className}` : 'popover teams-popover'}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  )
}

export interface PopoverMenuItem {
  key: string
  label: string
  onSelect: () => void
  /** For an item that is one of several choices: true marks the current one with a check.
   *  Leave it out for a plain action. */
  current?: boolean
  /** A key that picks this item while the menu is open, shown at its right edge. */
  shortcut?: string
  danger?: boolean
  /** Draw a divider above this item. */
  separated?: boolean
}

/** A list of actions in a popover. Unlike the Menu primitive it has no button of its own, so
 *  it can open from a right click or a key as well; and it is not cut off by the table. */
export function PopoverMenu(props: {
  anchorRef: RefObject<HTMLElement | null>
  label: string
  items: PopoverMenuItem[]
  align?: 'start' | 'end'
  onClose: (refocus: boolean) => void
}) {
  const { items, onClose } = props
  const hasChoices = items.some((item) => item.current !== undefined)

  const select = (item: PopoverMenuItem) => {
    // Close first: an action that moves the focus itself then has the last word.
    onClose(true)
    item.onSelect()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    const at = buttons.findIndex((button) => button === document.activeElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % buttons.length
    else if (event.key === 'ArrowUp') next = at <= 0 ? buttons.length - 1 : at - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    if (next !== null) {
      event.preventDefault()
      event.stopPropagation()
      buttons[next]?.focus()
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const picked = items.find((item) => item.shortcut?.toLowerCase() === event.key.toLowerCase())
    if (picked) {
      event.preventDefault()
      event.stopPropagation()
      select(picked)
    }
  }

  return (
    <Popover
      anchorRef={props.anchorRef}
      label={props.label}
      role="menu"
      align={props.align}
      className="menu"
      onClose={onClose}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <div key={item.key} role="none">
          {item.separated ? <div className="menu__sep" role="separator" /> : null}
          {/* The check is only seen; aria-current tells which of the choices is in effect. */}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? 'menu__item menu__item--danger' : 'menu__item'}
            aria-current={item.current ? 'true' : undefined}
            aria-keyshortcuts={item.shortcut}
            onClick={() => select(item)}
          >
            {hasChoices ? <span className="teams-menu__check">{item.current ? <IconCheck /> : null}</span> : null}
            <span className="teams-menu__label">{item.label}</span>
            {item.shortcut ? (
              <kbd className="teams-menu__key" aria-hidden="true">
                {item.shortcut}
              </kbd>
            ) : null}
          </button>
        </div>
      ))}
    </Popover>
  )
}
