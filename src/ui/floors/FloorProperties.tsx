import { useId, useRef, useState } from 'react'
import { findFloor, floorCapacity, planAspect } from '../../domain/model'
import type { Floor, PlanImage } from '../../domain/types'
import { dispatch, getProject, undoAction } from '../../state/store'
import { plural } from '../format'
import { IconImage } from '../icons'
import { Field, SeverityIcon, toast } from '../primitives'
import { DraftInput } from './DraftInput'
import { PLAN_IMAGE_ACCEPT } from './readImage'
import { useFocusAfterRender } from './useFocusAfterRender'
import { usePlanImageReader } from './usePlanImageReader'

/** How far the width-to-height ratio of a new image may be from the old one before the
 *  areas, which are stored as fractions of the plan, visibly shift against the drawing. */
const SAME_PROPORTIONS = 0.02

/** The right-hand panel while no area is selected: the floor's name, sign and plan image,
 *  and how to set a floor up. Mount it with the floor's id as `key`. */
export function FloorProperties(props: { floor: Floor }) {
  const { floor } = props
  const imageHeading = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const chooseRef = useRef<HTMLButtonElement>(null)
  const focusLater = useFocusAfterRender()
  const [proportionsChanged, setProportionsChanged] = useState(false)
  const capacity = floorCapacity(floor)

  const reader = usePlanImageReader((image: PlanImage) => {
    // Reading takes a moment: compare with the floor as it is now, not as it was shown.
    const current = findFloor(getProject(), floor.id)
    if (!current) return
    const change = Math.abs(image.width / image.height / planAspect(current) - 1)
    dispatch({ type: 'floor/update', id: floor.id, patch: { plan: image } })
    setProportionsChanged(current.areas.length > 0 && change > SAME_PROPORTIONS)
  })

  const removeImage = () => {
    dispatch({ type: 'floor/update', id: floor.id, patch: { plan: null } })
    setProportionsChanged(false)
    reader.reset()
    toast(`Removed the image of ${floor.name}`, undoAction())
    // The button that was pressed goes with the image.
    focusLater(() => chooseRef.current)
  }

  return (
    <>
      <div className="panel__header">
        <h2 className="subtitle truncate">{floor.name}</h2>
      </div>

      <div className="panel__body">
        <div className="stack stack--loose">
          <Field label="Name">
            {({ id }) => (
              <DraftInput
                id={id}
                className="input"
                value={floor.name}
                onChange={(name) =>
                  dispatch(
                    { type: 'floor/update', id: floor.id, patch: { name } },
                    { coalesce: `floor-name-${floor.id}` },
                  )
                }
              />
            )}
          </Field>

          <Field label="Sign" hint="Shown large in the floor switcher">
            {({ id, describedBy }) => (
              <div className="floors-short">
                <DraftInput
                  id={id}
                  className="input"
                  maxLength={3}
                  aria-describedby={describedBy}
                  value={floor.label}
                  onChange={(label) =>
                    dispatch(
                      { type: 'floor/update', id: floor.id, patch: { label } },
                      { coalesce: `floor-sign-${floor.id}` },
                    )
                  }
                />
              </div>
            )}
          </Field>

          <div className="field" role="group" aria-labelledby={imageHeading}>
            <span className="field__label" id={imageHeading}>
              Floor plan image
            </span>
            {floor.plan ? (
              <div className="floors-preview">
                <img className="floors-preview__image" src={floor.plan.src} alt={`Floor plan of ${floor.name}`} />
              </div>
            ) : (
              <span className="field__hint">No image. The areas are drawn on a blank sheet.</span>
            )}
            <div className="row row--wrap">
              <button
                ref={chooseRef}
                type="button"
                className="btn btn--sm"
                disabled={reader.busy}
                onClick={() => fileRef.current?.click()}
              >
                <IconImage />
                {floor.plan ? 'Replace image' : 'Add image'}
              </button>
              {floor.plan ? (
                <button type="button" className="btn btn--sm" onClick={removeImage}>
                  Remove image
                </button>
              ) : null}
            </div>
            {/* The button above stands in for this field, which browsers draw in their own
                language and style. */}
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={PLAN_IMAGE_ACCEPT}
              onChange={(e) => {
                const file = e.target.files?.[0]
                // Empty it, so that choosing the same file again counts as a change.
                e.target.value = ''
                if (!file) return
                setProportionsChanged(false)
                reader.read(file)
              }}
            />
            {reader.busy ? (
              <span className="field__hint" role="status">
                Reading the image
              </span>
            ) : null}
            {reader.error ? (
              <span className="field__error" role="alert">
                {reader.error}
              </span>
            ) : null}
            {proportionsChanged ? (
              <p className="note note--warning">
                <SeverityIcon severity="warning" />
                <span>The new image has other proportions. Check that the areas still line up.</span>
              </p>
            ) : null}
          </div>

          <p className="muted small">
            {plural(floor.areas.length, 'area')}, {plural(capacity.desks, 'desk')} and{' '}
            {plural(capacity.overflow, 'overflow seat')}.
          </p>

          <div>
            <h3 className="list-heading">Setting up a floor</h3>
            <ol className="floors-steps">
              <li className="floors-steps__step">Add the floor plan image.</li>
              <li className="floors-steps__step">Draw a box around each group of desks and enter its seats.</li>
              <li className="floors-steps__step">Mark meeting rooms as No seating.</li>
            </ol>
          </div>
        </div>
      </div>
    </>
  )
}
