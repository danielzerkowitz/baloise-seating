import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { planAspect } from '../../domain/model'
import type { Floor, Rect } from '../../domain/types'
import { IconFit, IconZoomIn, IconZoomOut } from '../icons'
import './sheet.css'

/* The drawing sheet: a floor plan with things positioned on top of it. Used by the Plan
   view (seating), the Floors view (editing areas) and print. */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** CSS position for a rectangle given in fractions of the plan. */
export function rectStyle(rect: Rect): CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  }
}

/** Where a pointer is on a sheet element, in fractions of the plan (clamped to 0..1). */
export function pointOnSheet(sheet: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const box = sheet.getBoundingClientRect()
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  return {
    x: box.width > 0 ? clamp((clientX - box.left) / box.width) : 0,
    y: box.height > 0 ? clamp((clientY - box.top) / box.height) : 0,
  }
}

/** The plan image (or a blank grid for a floor without a drawing) with `children` layered
 *  on top. Children position themselves absolutely, usually with `rectStyle`. */
export function Sheet(
  props: {
    floor: Floor
    children?: ReactNode
    ref?: Ref<HTMLDivElement>
  } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>,
) {
  const { floor, children, ref, className, style, ...rest } = props
  return (
    <div
      ref={ref}
      className={cx('sheet', className)}
      style={{ ...style, aspectRatio: String(planAspect(floor)) }}
      {...rest}
    >
      {floor.plan ? (
        <img className="sheet__plan" src={floor.plan.src} alt="" draggable={false} />
      ) : (
        <div className="sheet__blank" aria-hidden="true" />
      )}
      {children}
    </div>
  )
}

/** The white paper a sheet lies on, with room for a legend and title block below it. */
export function Paper(props: { children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={cx('paper', props.className)}>
      {props.children}
      {props.footer ? <div className="paper__footer">{props.footer}</div> : null}
    </div>
  )
}

const MIN_ZOOM = 1
const MAX_ZOOM = 5

/** A scrollable, zoomable window onto a paper. Zoom 1 fits the paper to the width.
 *  Ctrl or Cmd + wheel (or a trackpad pinch) zooms around the pointer; scrolling pans. */
export function SheetViewport(props: {
  children: ReactNode
  /** Extra controls shown next to the zoom buttons. */
  tools?: ReactNode
  /** When this value changes (another floor), zoom goes back to fit. */
  resetKey?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  // Scroll position to restore after a zoom so the point under the cursor stays put.
  const anchor = useRef<{ fx: number; fy: number; ox: number; oy: number } | null>(null)

  const zoomTo = (next: number, at?: { clientX: number; clientY: number }) => {
    const el = scrollRef.current
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    if (el) {
      const box = el.getBoundingClientRect()
      const ox = at ? at.clientX - box.left : box.width / 2
      const oy = at ? at.clientY - box.top : box.height / 2
      const fx = el.scrollWidth > 0 ? (el.scrollLeft + ox) / el.scrollWidth : 0
      const fy = el.scrollHeight > 0 ? (el.scrollTop + oy) / el.scrollHeight : 0
      anchor.current = { fx, fy, ox, oy }
    }
    zoomRef.current = clamped
    setZoom(clamped)
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    const a = anchor.current
    if (!el || !a) return
    el.scrollLeft = a.fx * el.scrollWidth - a.ox
    el.scrollTop = a.fy * el.scrollHeight - a.oy
    anchor.current = null
  }, [zoom])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), e)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    zoomRef.current = 1
    setZoom(1)
  }, [props.resetKey])

  return (
    <div className="viewport">
      <div className="viewport__scroll" ref={scrollRef}>
        <div className="viewport__stage" style={{ width: `${zoom * 100}%` }}>
          {props.children}
        </div>
      </div>
      <div className="viewport__tools" role="group" aria-label="Zoom">
        {props.tools}
        <button
          type="button"
          className="btn btn--icon btn--sm"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomTo(zoom / 1.4)}
        >
          <IconZoomOut />
        </button>
        <span className="viewport__zoom sign" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="btn btn--icon btn--sm"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomTo(zoom * 1.4)}
        >
          <IconZoomIn />
        </button>
        <button
          type="button"
          className="btn btn--icon btn--sm"
          aria-label="Fit to width"
          disabled={zoom === 1}
          onClick={() => zoomTo(1)}
        >
          <IconFit />
        </button>
      </div>
    </div>
  )
}
