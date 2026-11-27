import { useEffect, useRef } from 'react'
import type { Team } from '../../domain/types'
import { dispatch } from '../../state/store'
import { Dialog, Field } from '../primitives'
import { MAX_NOTES_LENGTH } from './limits'
import { teamLabel } from './teamActions'

/** Notes about one team. Open while `team` is given. Nothing is saved until "Save notes". */
export function TeamNotesDialog(props: { team: Team | null; onClose: () => void }) {
  const { team, onClose } = props
  const open = team !== null
  // The dialog renders its content afresh every time it opens, so the field can simply
  // start from the saved notes and be read when they are saved.
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Runs after the dialog has opened itself, which would leave the focus on its close button.
  useEffect(() => {
    if (open) textRef.current?.focus()
  }, [open])

  const save = () => {
    if (team && textRef.current) {
      dispatch({ type: 'team/update', id: team.id, patch: { notes: textRef.current.value.trim() } })
    }
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={team ? `Notes for ${teamLabel(team)}` : 'Notes'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={save}>
            Save notes
          </button>
        </>
      }
    >
      {team ? (
        <Field label="Notes" hint="Notes are saved in the plan file. Do not put personal data here.">
          {({ id, describedBy }) => (
            <textarea
              ref={textRef}
              id={id}
              className="textarea"
              rows={6}
              maxLength={MAX_NOTES_LENGTH}
              aria-describedby={describedBy}
              defaultValue={team.notes}
            />
          )}
        </Field>
      ) : null}
    </Dialog>
  )
}
