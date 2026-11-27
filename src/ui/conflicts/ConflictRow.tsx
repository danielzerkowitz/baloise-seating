import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { suggestFixes, type Fix } from '../../domain/fixes'
import { WEEKDAY_SHORT, type Project, type Weekday } from '../../domain/types'
import { dispatch, getProject, undoAction } from '../../state/store'
import { showOnPlan } from '../../state/ui'
import { daysLong } from '../format'
import { SeverityIcon, toast } from '../primitives'
import { leadIssue, type IssueRow } from './groupIssues'

interface RowProps {
  row: IssueRow
  /** The day the planner is looking at: the row speaks about this day when it covers it. */
  day?: Weekday
  project: Project
  /** Called when the row changes the plan, so the list can keep hold of the focus when the
   *  pressed button disappears with the row. */
  onActed: () => void
}

/** "Also Thu, Fri": the days a row covers besides the one its title is about. */
function OtherDays(props: { days: readonly Weekday[] }) {
  if (props.days.length === 0) return null
  return (
    <p className="conflicts-also small muted">
      <span aria-hidden="true">Also</span>
      {props.days.map((day) => (
        <span key={day} className="badge badge--quiet" aria-hidden="true">
          {WEEKDAY_SHORT[day]}
        </span>
      ))}
      <span className="visually-hidden">Also on {daysLong(props.days)}</span>
    </p>
  )
}

/** An open conflict, to-do, warning or note with what can be done about it. */
export function ConflictRow(props: RowProps) {
  const { row, day, project, onActed } = props
  const issue = leadIssue(row, day)
  const [fixing, setFixing] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [note, setNote] = useState('')
  const titleId = useId()
  const fixesId = useId()
  const acceptButton = useRef<HTMLButtonElement>(null)
  const cancelled = useRef(false)

  // Looking for fixes can be costly, so only do it for a row that shows them.
  const fixes = useMemo(() => (fixing ? suggestFixes(project, issue) : []), [fixing, project, issue])

  // After "Cancel" the form is gone; put the focus back on the button that opened it.
  useEffect(() => {
    if (accepting || !cancelled.current) return
    cancelled.current = false
    acceptButton.current?.focus()
  }, [accepting])

  const canAccept = row.severity === 'warning' || row.severity === 'info'

  const applyFix = (fix: Fix) => {
    const before = getProject()
    onActed()
    dispatch(fix.action)
    // "Undo" must take back this fix, so only offer it when the fix changed something.
    if (getProject() !== before) toast(fix.label, undoAction())
  }

  const accept = () => {
    setAccepting(false)
    setNote('')
    onActed()
    dispatch({
      type: 'batch',
      actions: row.issues.map((each) => ({
        type: 'issue/accept' as const,
        id: each.id,
        note: note.trim(),
        detail: each.detail,
      })),
    })
  }

  const cancelAccepting = () => {
    cancelled.current = true
    setAccepting(false)
    setNote('')
  }

  return (
    <li className="conflicts-row">
      <span className="conflicts-icon">
        <SeverityIcon severity={row.severity} />
      </span>
      <div className="conflicts-body">
        <p className="conflicts-title" id={titleId}>
          {issue.title}
        </p>
        <OtherDays days={row.days.filter((d) => d !== issue.day)} />
        {issue.detail ? <p className="conflicts-detail small muted">{issue.detail}</p> : null}

        {accepting ? (
          <form
            className="conflicts-accept"
            onSubmit={(e) => {
              e.preventDefault()
              accept()
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              // Escape belongs to this form here, not to the plan behind it.
              e.stopPropagation()
              cancelAccepting()
            }}
          >
            <input
              className="input input--sm conflicts-accept-input"
              aria-label="Why is this fine? (optional)"
              placeholder="Why is this fine? (optional)"
              value={note}
              autoFocus
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="submit" className="btn btn--sm btn--primary">
              Accept
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={cancelAccepting}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="conflicts-actions">
            <button
              type="button"
              className="link"
              aria-describedby={titleId}
              onClick={() =>
                showOnPlan({ day: issue.day, floorId: issue.floorId, areaId: issue.areaId, teamId: issue.teamIds[0] })
              }
            >
              Show
            </button>
            <button
              type="button"
              className="link"
              aria-describedby={titleId}
              aria-expanded={fixing}
              aria-controls={fixing ? fixesId : undefined}
              onClick={() => setFixing((open) => !open)}
            >
              Fix
            </button>
            {canAccept ? (
              <button
                ref={acceptButton}
                type="button"
                className="link"
                aria-describedby={titleId}
                onClick={() => {
                  setFixing(false)
                  setAccepting(true)
                }}
              >
                Accept
              </button>
            ) : null}
          </div>
        )}

        {fixing ? (
          <div className="conflicts-fixes" id={fixesId}>
            {fixes.length === 0 ? (
              <p className="small muted">No automatic fix. Change it on the plan.</p>
            ) : (
              fixes.map((fix) => (
                <button
                  key={fix.id}
                  type="button"
                  className="btn btn--sm conflicts-fix"
                  title={fix.explanation}
                  onClick={() => applyFix(fix)}
                >
                  <span className="conflicts-fix-label">{fix.label}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** A warning or note the planner accepted: what it was, why it is fine, and a way back. */
export function AcceptedRow(props: RowProps) {
  const { row, day, project, onActed } = props
  const issue = leadIssue(row, day)
  const titleId = useId()
  // A row can hold days that were accepted at different moments; show the first reason given.
  const reason = [issue, ...row.issues].map((each) => project.accepted[each.id]?.note.trim()).find(Boolean)

  const reopen = () => {
    onActed()
    dispatch({ type: 'batch', actions: row.issues.map((each) => ({ type: 'issue/unaccept' as const, id: each.id })) })
  }

  return (
    <li className="conflicts-row">
      <span className="conflicts-icon">
        <SeverityIcon severity={row.severity} />
      </span>
      <div className="conflicts-body">
        <p className="conflicts-title" id={titleId}>
          {issue.title}
        </p>
        <OtherDays days={row.days.filter((d) => d !== issue.day)} />
        {reason ? <p className="conflicts-detail small muted">{reason}</p> : null}
        <div className="conflicts-actions">
          <button type="button" className="link" aria-describedby={titleId} onClick={reopen}>
            Reopen
          </button>
        </div>
      </div>
    </li>
  )
}
