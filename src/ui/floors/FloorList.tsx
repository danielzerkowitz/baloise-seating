import { useId, useRef } from 'react'
import { floorCapacity } from '../../domain/model'
import type { Id, Project } from '../../domain/types'
import { dispatch } from '../../state/store'
import { setUi } from '../../state/ui'
import { plural } from '../format'
import { IconDots, IconPlus } from '../icons'
import { Menu, type MenuItem } from '../primitives'
import { duplicateFloor, removeFloor } from './edits'
import { findFocusTarget, useFocusAfterRender } from './useFocusAfterRender'

/** The floors of the building, top floor first, to choose which one is set up. */
export function FloorList(props: { project: Project; shownFloorId: Id | null; onAddFloor: () => void }) {
  const { project, shownFloorId, onAddFloor } = props
  const headingId = useId()
  const listRef = useRef<HTMLElement>(null)
  const focusLater = useFocusAfterRender()
  const topIndex = project.floors.length - 1

  /** The "More" button in the row of a floor. */
  const moreButtonOf = (floorId: Id): HTMLElement | null => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-floor-id]') ?? []
    for (const row of rows) {
      if (row.dataset.floorId === floorId) return row.querySelector<HTMLElement>('[aria-haspopup="menu"]')
    }
    return null
  }

  const move = (floorId: Id, by: 1 | -1) => {
    dispatch({ type: 'floor/move', id: floorId, by })
    // Changing the order takes the row out of the page for a moment, and the focus with
    // it. Put it back on the same menu, so the floor can be moved another step.
    focusLater(() => moreButtonOf(floorId))
  }

  const remove = (floorId: Id) => {
    removeFloor(floorId)
    // The row and its menu are gone: go on at the floor that is shown now.
    focusLater(() => findFocusTarget(listRef.current, 'floor'))
  }

  // Stored lowest floor first; a building is read from the top down.
  const rows = project.floors.map((floor, index) => ({ floor, index })).reverse()

  return (
    <section className="floors-list" aria-labelledby={headingId} ref={listRef}>
      <div className="floors-list__head">
        <h2 className="subtitle" id={headingId}>
          Floors
        </h2>
        <button
          type="button"
          className="btn btn--sm"
          data-focus-target={rows.length === 0 ? 'floor' : undefined}
          onClick={onAddFloor}
        >
          <IconPlus />
          Add floor
        </button>
      </div>
      {rows.length > 0 ? (
        <ul className="floors-list__rows">
          {rows.map(({ floor, index }) => {
            const shown = floor.id === shownFloorId
            const desks = plural(floorCapacity(floor).desks, 'desk')
            const items: MenuItem[] = [
              // Up is towards the top of the building: later in the stored order.
              { key: 'up', label: 'Move up', disabled: index === topIndex, onSelect: () => move(floor.id, 1) },
              { key: 'down', label: 'Move down', disabled: index === 0, onSelect: () => move(floor.id, -1) },
              { key: 'duplicate', label: 'Duplicate', onSelect: () => duplicateFloor(floor.id) },
              {
                key: 'remove',
                label: 'Remove floor',
                danger: true,
                separated: true,
                onSelect: () => remove(floor.id),
              },
            ]
            return (
              <li key={floor.id} className="floors-row" data-floor-id={floor.id}>
                <button
                  type="button"
                  className="floors-row__main"
                  aria-pressed={shown}
                  aria-label={`${floor.name}, ${desks}`}
                  data-focus-target={shown ? 'floor' : undefined}
                  onClick={() => setUi({ floorId: floor.id, selectedAreaId: null })}
                >
                  <span className="floors-row__sign sign">{floor.label}</span>
                  <span className="floors-row__text">
                    <span className="floors-row__name truncate">{floor.name}</span>
                    <span className="floors-row__meta">{desks}</span>
                  </span>
                </button>
                <Menu
                  label={`More for ${floor.name}`}
                  items={items}
                  buttonClassName="btn btn--ghost btn--icon btn--sm"
                >
                  <IconDots />
                </Menu>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
