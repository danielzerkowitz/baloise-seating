import { useEffect, useRef } from 'react'
import type { AutoSeatOutcome } from '../../domain/autoseat'
import { findTeam } from '../../domain/model'
import type { Project } from '../../domain/types'
import { IconCheck } from '../icons'
import { Dialog, SeverityIcon, Swatch } from '../primitives'
import { autoSeatSummary, undoAutoSeat, type AutoSeatReport } from './actions'

/** True when the team still lacks seats on at least one of its team days. */
function stillToSeat(outcome: AutoSeatOutcome): boolean {
  return outcome.result === 'partly' || outcome.result === 'unseated'
}

/** After "Seat everyone automatically": what came of each team, to keep or to undo. The
 *  proposal has already been applied when this opens. */
export function AutoSeatDialog(props: {
  project: Project
  /** Null while there is nothing to show. */
  report: AutoSeatReport | null
  onClose: () => void
}) {
  const { project, report, onClose } = props
  const keep = useRef<HTMLButtonElement>(null)
  const open = report !== null

  // The dialog itself opens in an effect of the Dialog component, which runs before this
  // one. Only then can its main button take the focus.
  useEffect(() => {
    if (open) keep.current?.focus()
  }, [open])

  // The teams that still lack seats are what the planner has to look at, so they come first
  // (the sort is stable: within each group the team-list order stays).
  const outcomes = report ? [...report.outcomes].sort((a, b) => Number(stillToSeat(b)) - Number(stillToSeat(a))) : []

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Automatic seating"
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (report) undoAutoSeat(report)
              onClose()
            }}
          >
            Undo
          </button>
          <button ref={keep} type="button" className="btn btn--primary" onClick={onClose}>
            Keep
          </button>
        </>
      }
    >
      {report ? (
        <>
          <p>{autoSeatSummary(report)}</p>
          <ul className="plan-auto">
            {outcomes.map((outcome) => {
              const team = findTeam(project, outcome.teamId)
              if (!team) return null
              return (
                <li key={team.id} className="plan-auto__item">
                  <Swatch color={team.color} />
                  <span className="plan-auto__text">
                    <span className="plan-auto__team">{team.name}</span>
                    <span className="muted">{outcome.message}</span>
                  </span>
                  {stillToSeat(outcome) ? <SeverityIcon severity="todo" withTitle /> : null}
                  {outcome.result === 'seated' ? (
                    <IconCheck className="plan-icon plan-icon--ok" title="Seated" />
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </Dialog>
  )
}
