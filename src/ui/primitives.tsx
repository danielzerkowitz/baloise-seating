import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { TEAM_COLORS, normalizeHex, teamStyle } from '../domain/color'
import { IconCheck, IconClose, IconDesk, IconError, IconInfo, IconMinus, IconPlus, IconWarning } from './icons'

/* Shared building blocks. Views compose these and never restyle them; the matching
   classes live in styles/base.css. */

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog(props: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Buttons, right aligned. Put the main action last. */
  footer?: ReactNode
  wide?: boolean
  /** The control that takes the focus when the dialog opens. Without it the browser picks
   *  the first control, which is the close button. */
  initialFocus?: RefObject<HTMLElement | null>
}) {
  const { open, onClose, title, children, footer, wide, initialFocus } = props
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
      initialFocus?.current?.focus()
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close()
      else el.removeAttribute('open')
    }
  }, [open, initialFocus])

  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog--wide' : 'dialog'}
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onClose()
      }}
      onMouseDown={(e) => {
        // A press on the backdrop (the dialog element itself, outside its content) closes.
        if (e.target === ref.current) onClose()
      }}
    >
      {open ? (
        <>
          <div className="dialog__header">
            <h2 className="subtitle" id={titleId}>
              {title}
            </h2>
            <button type="button" className="btn btn--ghost btn--icon" aria-label="Close" onClick={onClose}>
              <IconClose />
            </button>
          </div>
          <div className="dialog__body">{children}</div>
          {footer ? <div className="dialog__footer">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  )
}

// ---------------------------------------------------------------------------
// Menu (a button that opens a list of actions)
// ---------------------------------------------------------------------------

export interface MenuItem {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  /** Draw a divider above this item. */
  separated?: boolean
}

export function Menu(props: {
  /** Accessible name of the button. */
  label: string
  /** What the button shows (text and/or icon). */
  children: ReactNode
  items: MenuItem[]
  buttonClassName?: string
  /** Which edge of the button the menu lines up with. */
  align?: 'start' | 'end'
  /** Tooltip of the button, when it has more to say than its label. */
  title?: string
  /** Gives the caller the button, for example to put the focus back on it. */
  buttonRef?: Ref<HTMLButtonElement>
}) {
  const { label, children, items, buttonClassName = 'btn', align = 'end' } = props
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const setButton = (el: HTMLButtonElement | null) => {
    buttonRef.current = el
    const outer = props.buttonRef
    if (typeof outer === 'function') outer(el)
    else if (outer) outer.current = el
  }
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    const first = listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus()
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (buttons.length === 0) return
    e.preventDefault()
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next = at
    if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % buttons.length
    if (e.key === 'ArrowUp') next = at <= 0 ? buttons.length - 1 : at - 1
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = buttons.length - 1
    buttons[next]?.focus()
  }

  return (
    <span className="menu-wrap" ref={wrapRef} onKeyDown={onKeyDown}>
      <button
        ref={setButton}
        type="button"
        className={buttonClassName}
        aria-label={label}
        title={props.title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open ? (
        <div ref={listRef} role="menu" aria-label={label} className={`popover menu menu--${align}`}>
          {items.map((item) => (
            <div key={item.key} role="none">
              {item.separated ? <div className="menu__sep" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                className={item.danger ? 'menu__item menu__item--danger' : 'menu__item'}
                disabled={item.disabled}
                onClick={() => {
                  close(true)
                  item.onSelect()
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

/** Whole-number input with minus and plus buttons. */
export function Stepper(props: {
  value: number
  onChange: (value: number) => void
  /** Accessible name, e.g. "Seats in NE 1". */
  label: string
  min?: number
  max?: number
  disabled?: boolean
}) {
  const { value, onChange, label, min = 0, max = Number.MAX_SAFE_INTEGER, disabled } = props
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)))
  // While the field has the focus it shows what is being typed, so it can be emptied and
  // retyped; the number is applied as soon as the text is one.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper__btn"
        aria-label={`Fewer: ${label}`}
        disabled={disabled || value <= min}
        onClick={() => {
          setDraft(null)
          onChange(clamp(value - 1))
        }}
      >
        <IconMinus />
      </button>
      <input
        className="stepper__value"
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={Number.isFinite(max) ? max : undefined}
        value={draft ?? value}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(clamp(n))
        }}
        onBlur={() => setDraft(null)}
      />
      <button
        type="button"
        className="stepper__btn"
        aria-label={`More: ${label}`}
        disabled={disabled || value >= max}
        onClick={() => {
          setDraft(null)
          onChange(clamp(value + 1))
        }}
      >
        <IconPlus />
      </button>
    </span>
  )
}

/** How full something is. When `value` exceeds `max` the bar turns into hatching: red, or
 *  amber with `tone="warning"` for a mark that may be passed (a reserve, not a limit). */
export function Meter(props: { value: number; max: number; label?: string; tone?: 'conflict' | 'warning' }) {
  const { value, max, label, tone = 'conflict' } = props
  const over = value > max
  const ratio = max > 0 ? value / max : value > 0 ? 1 : 0
  return (
    <span
      className={over ? (tone === 'warning' ? 'meter meter--warning' : 'meter meter--over') : 'meter'}
      style={{ '--value': String(ratio), display: 'block' } as CSSProperties}
      role="img"
      aria-label={label ?? `${value} of ${max}`}
    >
      <span className="meter__fill" />
    </span>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  title?: string
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string>(props: {
  label: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  small?: boolean
}) {
  const { label, options, value, onChange, small } = props
  return (
    <div className={small ? 'seg seg--sm' : 'seg'} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="seg__item"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A colour dot. */
export function Swatch(props: { color: string; large?: boolean }) {
  return (
    <span className={props.large ? 'swatch swatch--lg' : 'swatch'} style={teamStyle(props.color) as CSSProperties} />
  )
}

/** A team as a coloured pill. */
export function TeamChip(props: { color: string; children: ReactNode; outline?: boolean; title?: string }) {
  return (
    <span
      className={props.outline ? 'chip chip--outline' : 'chip'}
      style={teamStyle(props.color) as CSSProperties}
      title={props.title}
    >
      {props.children}
    </span>
  )
}

export type SeverityLevel = 'error' | 'todo' | 'warning' | 'info'

export const SEVERITY_NAME: Record<SeverityLevel, string> = {
  error: 'Conflict',
  todo: 'Still to seat',
  warning: 'Warning',
  info: 'Note',
}

export function SeverityIcon(props: { severity: SeverityLevel; withTitle?: boolean }) {
  const title = props.withTitle ? SEVERITY_NAME[props.severity] : undefined
  if (props.severity === 'error') return <IconError className="sev sev--error" title={title} />
  if (props.severity === 'todo') return <IconDesk className="sev sev--todo" title={title} />
  if (props.severity === 'warning') return <IconWarning className="sev sev--warning" title={title} />
  return <IconInfo className="sev sev--info" title={title} />
}

/** Label, optional hint and error around one form control. Pass the control as a function
 *  of the ids so label and descriptions are wired up. */
export function Field(props: {
  label: string
  hint?: string
  error?: string | null
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {props.label}
      </label>
      {props.children({ id, describedBy, invalid: Boolean(props.error) })}
      {props.hint ? (
        <span className="field__hint" id={hintId}>
          {props.hint}
        </span>
      ) : null}
      {props.error ? (
        <span className="field__error" id={errorId} role="alert">
          {props.error}
        </span>
      ) : null}
    </div>
  )
}

/** Pick one of the team colours, or type a hex value. */
export function ColorPicker(props: { value: string; onChange: (color: string) => void; label?: string }) {
  const { value, onChange, label = 'Colour' } = props
  const current = normalizeHex(value) ?? ''
  const [text, setText] = useState(current)
  const [typing, setTyping] = useState(false)
  // The field follows the colour, but not while someone types in it: "#2f6" on the way to
  // "#2f6fde" must not be turned into "#22ff66" under the cursor.
  useEffect(() => {
    if (!typing) setText(current)
  }, [current, typing])
  const commit = () => {
    const n = normalizeHex(text)
    if (n && n !== current) onChange(n)
  }
  return (
    <div className="color-picker" role="group" aria-label={label}>
      <div className="color-picker__grid">
        {TEAM_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="color-picker__option"
            style={teamStyle(c) as CSSProperties}
            aria-label={`Colour ${c}`}
            aria-pressed={c === current}
            onClick={() => onChange(c)}
          >
            {c === current ? <IconCheck /> : null}
          </button>
        ))}
      </div>
      <input
        className="input input--sm color-picker__hex"
        aria-label="Hex colour"
        value={text}
        spellCheck={false}
        onFocus={() => setTyping(true)}
        onChange={(e) => {
          setText(e.target.value)
          // A complete six-digit colour applies at once; the short form waits for Enter or
          // for leaving the field.
          if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) {
            const n = normalizeHex(e.target.value)
            if (n) onChange(n)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        onBlur={() => {
          commit()
          setTyping(false)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toasts: short confirmations with an optional action (usually "Undo")
// ---------------------------------------------------------------------------

export interface ToastAction {
  label: string
  run: () => void
  /** Says whether the action still does what the message promises. Once it has gone stale
   *  the toast keeps its message but loses the button (see `refreshToasts`). */
  stillValid?: () => boolean
}

interface ToastItem {
  id: number
  message: string
  action?: ToastAction
}

let toasts: ToastItem[] = []
let nextToastId = 1
const toastListeners = new Set<() => void>()

function emitToasts() {
  for (const l of [...toastListeners]) l()
}

function dismissToast(id: number) {
  const before = toasts.length
  toasts = toasts.filter((t) => t.id !== id)
  if (toasts.length !== before) emitToasts()
}

/** Takes the button off every toast whose action is no longer valid; the message stays
 *  until its time is up. Call it whenever the thing the actions refer to has changed (the
 *  app does so on every change of the plan). */
export function refreshToasts() {
  let changed = false
  toasts = toasts.map((t) => {
    if (!t.action?.stillValid || t.action.stillValid()) return t
    changed = true
    return { id: t.id, message: t.message }
  })
  if (changed) emitToasts()
}

/** Removes every toast (for tests). */
export function clearToasts() {
  if (toasts.length === 0) return
  toasts = []
  emitToasts()
}

/** Show a short message at the bottom of the screen. */
export function toast(message: string, action?: ToastAction) {
  const id = nextToastId++
  toasts = [...toasts.slice(-2), { id, message, action }]
  emitToasts()
  if (typeof window !== 'undefined') window.setTimeout(() => dismissToast(id), action ? 8000 : 5000)
}

export function ToastRegion() {
  const items = useSyncExternalStore(
    (l) => {
      toastListeners.add(l)
      return () => toastListeners.delete(l)
    },
    () => toasts,
    () => toasts,
  )
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.message}</span>
          {t.action ? (
            <button
              type="button"
              className="link"
              onClick={() => {
                if (!t.action?.stillValid || t.action.stillValid()) t.action?.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" className="btn btn--ghost btn--icon btn--sm toast__close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <IconClose />
          </button>
        </div>
      ))}
    </div>
  )
}
