import { useEffect, useMemo, useRef, useState } from 'react'
import { parseTeamsText } from '../../domain/files'
import type { Project } from '../../domain/types'
import { dispatch, undoAction } from '../../state/store'
import { daysShort, plural } from '../format'
import { Dialog, Field, SeverityIcon, toast } from '../primitives'
import { pasteSummary, planPaste, type PasteEffect } from './pasteTeams'

/** How many unusable lines the dialog spells out before it only counts them. */
const MAX_PROBLEMS_SHOWN = 8

const EFFECT_WORDS: Record<PasteEffect, string> = {
  add: 'New team',
  update: 'Updates the team in the plan',
  same: 'Already in the plan as pasted',
  kept: 'Already in the plan, left as it is',
}

const EXAMPLE = 'Claims Intake, 9, Tue Thu, Claims\nUnderwriting, 10, Tue Wed, Policy'

/** Add many teams at once from a list copied out of a spreadsheet. The dialog shows what it
 *  read and what will happen with every line before anything changes. */
export function PasteTeamsDialog(props: { project: Project; open: boolean; onClose: () => void }) {
  const { project, open } = props
  const [text, setText] = useState('')
  const [updateExisting, setUpdateExisting] = useState(true)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Runs after the dialog has opened itself, which would leave the focus on its close button.
  useEffect(() => {
    if (open) textRef.current?.focus()
  }, [open])

  const parsed = useMemo(() => parseTeamsText(text), [text])
  const plan = useMemo(() => planPaste(project, parsed.rows, updateExisting), [project, parsed, updateExisting])
  const effect = pasteSummary(plan, 'present')

  /** Every way out of the dialog comes through here, so it is empty the next time it opens. */
  const close = () => {
    setText('')
    setUpdateExisting(true)
    props.onClose()
  }

  const apply = () => {
    const done = pasteSummary(plan, 'past')
    if (done === null) return
    dispatch({ type: 'batch', actions: plan.actions })
    close()
    toast(done, undoAction())
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Paste teams from a spreadsheet"
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={effect === null} onClick={apply}>
            {effect ?? 'Add teams'}
          </button>
        </>
      }
    >
      <div className="stack stack--loose">
        <Field
          label="List of teams"
          hint="One team per line: name, size, days, group. Copy the columns straight from a spreadsheet."
        >
          {({ id, describedBy }) => (
            <textarea
              ref={textRef}
              id={id}
              className="textarea"
              rows={7}
              aria-describedby={describedBy}
              placeholder={EXAMPLE}
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>

        {parsed.rows.length > 0 ? (
          <table className="table" aria-label="Teams found in the text">
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col" className="num">
                  People
                </th>
                <th scope="col">Days</th>
                <th scope="col">Group</th>
                <th scope="col">What happens</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map(({ row, effect }) => (
                <tr key={row.line}>
                  <td>{row.name}</td>
                  <td className="num">{row.size}</td>
                  <td>{daysShort(row.days, 'none given')}</td>
                  <td>{row.group}</td>
                  <td>{EFFECT_WORDS[effect]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : text.trim() !== '' && parsed.problems.length === 0 ? (
          <p className="muted small">No teams found in this text. Start each line with a team's name and its size.</p>
        ) : null}

        {parsed.problems.length > 0 ? (
          <div className="note note--warning">
            <SeverityIcon severity="warning" withTitle />
            <div>
              <p>{plural(parsed.problems.length, 'line')} could not be used</p>
              <ul className="teams-paste__problems">
                {/* A pasted sheet with thousands of unusable lines must not become thousands of
                    list items: the first few say what is wrong, the count says how much. */}
                {parsed.problems.slice(0, MAX_PROBLEMS_SHOWN).map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
                {parsed.problems.length > MAX_PROBLEMS_SHOWN ? (
                  <li>and {parsed.problems.length - MAX_PROBLEMS_SHOWN} more</li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : null}

        <label className="teams-check">
          <input
            type="checkbox"
            className="teams-check__box"
            checked={updateExisting}
            onChange={(event) => setUpdateExisting(event.target.checked)}
          />
          Update teams that already exist
        </label>
      </div>
    </Dialog>
  )
}
