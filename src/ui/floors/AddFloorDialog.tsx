import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { copyFloor, findFloor, floorLabelFromName, makeFloor } from '../../domain/model'
import type { Floor, PlanImage, Project } from '../../domain/types'
import { dispatch } from '../../state/store'
import { setUi } from '../../state/ui'
import { Dialog, Field } from '../primitives'
import { cx } from '../sheet/Sheet'
import { PLAN_IMAGE_ACCEPT } from './readImage'
import { usePlanImageReader } from './usePlanImageReader'

/** Asks for the name, sign and plan image of a new floor and adds it on top of the
 *  building. Mount it with a new `key` for every opening, so each one starts empty. */
export function AddFloorDialog(props: {
  open: boolean
  project: Project
  onClose: () => void
  /** The floor was added and is shown now. */
  onAdded: () => void
}) {
  const { open, project, onClose, onAdded } = props
  const formId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(() => `Floor ${project.floors.length + 1}`)
  const [nameMissing, setNameMissing] = useState(false)
  // Null while the sign follows the name; a text as soon as the planner has typed one.
  const [sign, setSign] = useState<string | null>(null)
  const [copyFromId, setCopyFromId] = useState('')
  const [image, setImage] = useState<PlanImage | null>(null)
  const [dropping, setDropping] = useState(false)
  const reader = usePlanImageReader(setImage)

  // A dialog puts the focus on its first control, the Close button. The name is where the
  // typing goes, selected so that the suggestion is replaced by it.
  useEffect(() => {
    if (!open) return
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [open])

  const copyFrom = findFloor(project, copyFromId)

  const pick = (file: File) => {
    // The image picked before is gone either way: the field now names this file.
    setImage(null)
    reader.read(file)
  }

  const clearImage = () => {
    setImage(null)
    reader.reset()
    if (fileRef.current) fileRef.current.value = ''
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    // Without this the browser opens the dropped file in place of the planner.
    e.preventDefault()
    setDropping(false)
    const files = e.dataTransfer.files
    const file = files[0]
    if (!file) return
    if (fileRef.current) {
      // Whatever the field named before is no longer what will be used.
      fileRef.current.value = ''
      try {
        // Name the dropped file there instead, as if it had been chosen in the field.
        if (files.length === 1) fileRef.current.files = files
      } catch {
        // Some browsers refuse; the preview below still shows what was dropped.
      }
    }
    pick(file)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (reader.busy) return
    const floorName = name.trim()
    if (floorName === '') {
      setNameMissing(true)
      nameRef.current?.focus()
      return
    }
    const label = sign?.trim() || floorLabelFromName(floorName)
    // Copied areas only line up with the drawing they were made on, so without a new
    // image the copy keeps the image of the floor it comes from.
    const floor: Floor = copyFrom
      ? { ...copyFloor(copyFrom, floorName, label), plan: image ?? copyFrom.plan }
      : makeFloor({ name: floorName, label, plan: image })
    dispatch({ type: 'floor/add', floor })
    setUi({ floorId: floor.id, selectedAreaId: null })
    onAdded()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a floor"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={reader.busy}>
            Add floor
          </button>
        </>
      }
    >
      <form id={formId} className="stack stack--loose" noValidate onSubmit={submit}>
        <Field label="Name" error={nameMissing ? 'Enter a name for the floor.' : null}>
          {({ id, describedBy, invalid }) => (
            <input
              ref={nameRef}
              id={id}
              className="input"
              value={name}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => {
                setName(e.target.value)
                setNameMissing(false)
              }}
            />
          )}
        </Field>

        <Field label="Sign" hint="Shown large in the floor switcher">
          {({ id, describedBy }) => (
            <div className="floors-short">
              <input
                id={id}
                className="input"
                maxLength={3}
                value={sign ?? floorLabelFromName(name)}
                aria-describedby={describedBy}
                onChange={(e) => setSign(e.target.value)}
              />
            </div>
          )}
        </Field>

        <Field
          label="Floor plan image"
          hint={
            copyFrom?.plan && !image
              ? `Without an image the new floor uses the image of ${copyFrom.name}.`
              : 'Without an image you get a blank sheet to draw on.'
          }
          error={reader.error}
        >
          {({ id, describedBy, invalid }) => (
            <div
              className={cx('floors-drop', dropping && 'floors-drop--over')}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return
                // Saying yes to the drag is what makes the drop arrive here.
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setDropping(true)
              }}
              onDragLeave={(e) => {
                // Moving on to a child of the zone also counts as leaving it; ignore that.
                if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
                  setDropping(false)
                }
              }}
              onDrop={onDrop}
            >
              <input
                ref={fileRef}
                id={id}
                className="floors-drop__file"
                type="file"
                accept={PLAN_IMAGE_ACCEPT}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) pick(file)
                  else clearImage()
                }}
              />
              <span className="small muted">PNG, JPG, WebP or SVG. You can also drop the file here.</span>
              {reader.busy ? (
                <span className="small muted" role="status">
                  Reading the image
                </span>
              ) : null}
              {image ? (
                <>
                  <div className="floors-preview">
                    <img className="floors-preview__image" src={image.src} alt="" />
                  </div>
                  <div className="row row--wrap small">
                    <span>
                      {image.width} by {image.height} pixels
                    </span>
                    <button type="button" className="link" onClick={clearImage}>
                      Remove image
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </Field>

        {project.floors.length > 0 ? (
          <Field label="Copy the areas of" hint="For floors with the same layout.">
            {({ id, describedBy }) => (
              <select
                id={id}
                className="select"
                value={copyFromId}
                aria-describedby={describedBy}
                onChange={(e) => setCopyFromId(e.target.value)}
              >
                <option value="">None</option>
                {/* Top floor first, as in the floor list. */}
                {[...project.floors].reverse().map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </form>
    </Dialog>
  )
}
