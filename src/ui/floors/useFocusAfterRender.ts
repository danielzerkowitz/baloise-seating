import { useCallback, useEffect, useState, type RefObject } from 'react'

type Finder = () => HTMLElement | null | undefined

/** Returns a function that moves the keyboard focus once the page shows the result of the
 *  edit that is being made. An edit often removes the element that had the focus (the box
 *  of a removed area) or creates the one that should get it (the Seats field of a new
 *  area), so the element can only be looked up after React has rendered: `find` runs then.
 *
 *  A text field gets its content selected, so that typing replaces it. */
export function useFocusAfterRender(): (find: Finder) => void {
  // A new object for every request, so asking for the same place twice focuses twice.
  const [request, setRequest] = useState<{ find: Finder } | null>(null)

  useEffect(() => {
    const element = request?.find()
    if (!element) return
    element.focus()
    if (element instanceof HTMLInputElement) element.select()
  }, [request])

  return useCallback((find: Finder) => setRequest({ find }), [])
}

/** Places in the Floors view that an edit sends the keyboard focus to. The element that
 *  plays the part at the moment carries `data-focus-target="<name>"`:
 *  - `seats`: the Seats field of the selected area
 *  - `selected-area`: the box of the selected area on the sheet
 *  - `tool`: the tool button that is pressed
 *  - `floor`: the row of the shown floor, or "Add floor" when there is no floor */
export type FocusTarget = 'seats' | 'selected-area' | 'tool' | 'floor'

export function findFocusTarget(within: ParentNode | null, target: FocusTarget): HTMLElement | null {
  return within?.querySelector<HTMLElement>(`[data-focus-target="${target}"]`) ?? null
}

/** Moves the focus to a target after the next render. With `if-lost` only when the edit
 *  left the focus nowhere, because the element that had it is gone. */
export type RequestFocus = (target: FocusTarget, when?: 'always' | 'if-lost') => void

export function useFocusTargets(root: RefObject<HTMLElement | null>): RequestFocus {
  const focusLater = useFocusAfterRender()
  return useCallback(
    (target, when = 'always') => {
      focusLater(() => {
        // A page whose focused element was removed reports its body as focused.
        const lost = document.activeElement === null || document.activeElement === document.body
        return when === 'always' || lost ? findFocusTarget(root.current, target) : null
      })
    },
    [focusLater, root],
  )
}
