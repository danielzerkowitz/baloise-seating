import { useRef, useState } from 'react'
import { useProject } from '../../state/store'
import { currentFloor, useUi } from '../../state/ui'
import { cx } from '../sheet/Sheet'
import { AddFloorDialog } from './AddFloorDialog'
import { AreaCanvas } from './AreaCanvas'
import { AreaProperties } from './AreaProperties'
import { FloorList } from './FloorList'
import { FloorProperties } from './FloorProperties'
import { useFocusTargets } from './useFocusAfterRender'
// After the components, so these rules follow the sheet's own in the page.
import './floors.css'

/** Setting up floors: choose a floor on the left, draw its seating areas on the plan in
 *  the middle, and edit the selected area, or the floor itself, on the right. */
export function FloorsView() {
  const project = useProject()
  const ui = useUi()
  const rootRef = useRef<HTMLDivElement>(null)
  const focusTarget = useFocusTargets(rootRef)
  // `round` counts the openings: a new key for each one gives the dialog a fresh form.
  const [adding, setAdding] = useState({ open: false, round: 0 })

  const floor = currentFloor(project, ui)
  // The selection is shared with the Plan view and may point at an area of another floor.
  const selectedArea = floor?.areas.find((area) => area.id === ui.selectedAreaId)

  const openAddFloor = () => setAdding(({ round }) => ({ open: true, round: round + 1 }))
  const closeAddFloor = () => setAdding(({ round }) => ({ open: false, round }))

  return (
    <div className={cx('view floors', !floor && 'floors--bare')} ref={rootRef}>
      <FloorList project={project} shownFloorId={floor?.id ?? null} onAddFloor={openAddFloor} />

      {floor ? (
        <>
          <AreaCanvas
            key={floor.id}
            floor={floor}
            selectedAreaId={selectedArea?.id ?? null}
            focusTarget={focusTarget}
          />
          <aside className="floors-side panel" aria-label={selectedArea ? 'Area properties' : 'Floor properties'}>
            {selectedArea ? (
              <AreaProperties key={selectedArea.id} project={project} area={selectedArea} focusTarget={focusTarget} />
            ) : (
              <FloorProperties key={floor.id} floor={floor} />
            )}
          </aside>
        </>
      ) : (
        <section className="floors-canvas floors-canvas--empty" aria-label="Plan">
          <div className="empty">
            <h2 className="empty__title">No floor yet</h2>
            <p className="empty__text">Add a floor plan image, then draw a box around each group of desks.</p>
            <button type="button" className="btn btn--primary" onClick={openAddFloor}>
              Add floor
            </button>
          </div>
        </section>
      )}

      <AddFloorDialog
        key={adding.round}
        open={adding.open}
        project={project}
        onClose={closeAddFloor}
        onAdded={() => {
          closeAddFloor()
          // The button that opened the dialog may be gone (the empty state's is): go on
          // at the new floor's row.
          focusTarget('floor')
        }}
      />
    </div>
  )
}
