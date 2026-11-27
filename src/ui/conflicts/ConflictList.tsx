import { useId, useRef } from 'react'
import { SEVERITY_ORDER, isAccepted, summarizeIssues, type Issue, type Severity } from '../../domain/conflicts'
import type { Weekday } from '../../domain/types'
import { useIssues, useProject } from '../../state/store'
import { IconCheck } from '../icons'
import { AcceptedRow, ConflictRow } from './ConflictRow'
import { groupIssues, putDayFirst } from './groupIssues'
import './conflicts.css'

const SECTION_NAME: Record<Severity, string> = {
  error: 'Conflicts',
  todo: 'Still to seat',
  warning: 'Warnings',
  info: 'Notes',
}

/** Everything that is wrong, unfinished or worth knowing in the plan, most serious first,
 *  each with a way to see it on the plan and to fix or accept it. With `day`, what concerns
 *  that day comes first in every section. */
export function ConflictList(props: { day?: Weekday }) {
  const { day } = props
  const project = useProject()
  const issues = useIssues()
  const headingId = useId()

  const open: Issue[] = []
  const accepted: Issue[] = []
  for (const issue of issues) (isAccepted(project, issue) ? accepted : open).push(issue)

  const openRows = groupIssues(open)
  const acceptedRows = groupIssues(accepted)
  const sections = SEVERITY_ORDER.map((severity) => {
    const rows = openRows.filter((row) => row.severity === severity)
    return { severity, rows: day ? putDayFirst(rows, day) : rows }
  }).filter((section) => section.rows.length > 0)

  /* The numbers next to the headings are the ones the top bar and the Plan view show: a
     problem counts once for every day it occurs on, so a row that covers two days counts
     for two, and "Still to seat" counts teams. */
  const summary = summarizeIssues(project, issues)
  const count: Record<Severity, number> = {
    error: summary.conflicts,
    todo: summary.teamsToSeat,
    warning: summary.warnings,
    info: summary.notes,
  }

  /* A fix, an acceptance or a reopening usually removes the very button that was pressed,
     and the focus drops to the page with it. Once the list has been drawn again, it takes
     the focus itself if that happened, so the next Tab continues here. */
  const listRef = useRef<HTMLDivElement>(null)
  const onActed = () => {
    window.setTimeout(() => {
      if (document.activeElement === document.body) listRef.current?.focus()
    })
  }

  return (
    <div className="conflicts-list" ref={listRef} tabIndex={-1} role="group" aria-label="Conflicts">
      {sections.length === 0 ? (
        <p className="note note--ok">
          <IconCheck />
          <span>{acceptedRows.length === 0 ? 'No conflicts. Every team has its seats.' : 'No conflicts.'}</span>
        </p>
      ) : null}

      {sections.map((section) => (
        <section key={section.severity} aria-labelledby={`${headingId}-${section.severity}`}>
          <h3 className="list-heading" id={`${headingId}-${section.severity}`}>
            <span>{SECTION_NAME[section.severity]}</span>{' '}
            <span className="sign conflicts-count">{count[section.severity]}</span>
          </h3>
          <ul>
            {section.rows.map((row) => (
              <ConflictRow key={row.key} row={row} day={day} project={project} onActed={onActed} />
            ))}
          </ul>
        </section>
      ))}

      {acceptedRows.length > 0 ? (
        <details className="conflicts-accepted">
          <summary className="conflicts-accepted-summary">Accepted ({summary.accepted})</summary>
          <ul>
            {acceptedRows.map((row) => (
              <AcceptedRow key={row.key} row={row} day={day} project={project} onActed={onActed} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
