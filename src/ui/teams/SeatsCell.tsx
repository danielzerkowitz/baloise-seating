import { useRef, useState } from 'react'
import { seatsNeeded } from '../../domain/model'
import type { Project, Team } from '../../domain/types'
import { dispatch } from '../../state/store'
import { percent } from '../format'
import { PercentField } from './PercentField'
import { Popover } from './Popover'
import { teamLabel } from './teamActions'

/** The seats a team needs on a team day, as a button that opens the team's own expected
 *  attendance. */
export function SeatsCell({ project, team }: { project: Project; team: Team }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const name = teamLabel(team)
  const seats = seatsNeeded(team, project.settings)
  const own = team.attendance

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="teams-seats"
        aria-label={`Seats for ${name}: ${seats}${own === null ? '' : `, at ${percent(own)}`}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Set the expected attendance of this team"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sign teams-seats__n">{seats}</span>
        {own === null ? null : <span className="tiny muted">at {percent(own)}</span>}
      </button>
      {open ? (
        <Popover
          anchorRef={buttonRef}
          label={`Expected attendance for ${name}`}
          align="end"
          onClose={close}
          initialFocus={(popover) => popover.querySelector('input')}
        >
          <div className="stack">
            <PercentField
              label={`Expected attendance for ${name}`}
              hint={`The plan's setting is ${percent(project.settings.attendance)}.`}
              min={10}
              max={100}
              share={own ?? project.settings.attendance}
              onChange={(attendance) =>
                dispatch(
                  { type: 'team/update', id: team.id, patch: { attendance } },
                  { coalesce: `team-attendance-${team.id}` },
                )
              }
            />
            <button
              type="button"
              className="btn btn--sm teams-seats__reset"
              disabled={own === null}
              onClick={() => {
                dispatch({ type: 'team/update', id: team.id, patch: { attendance: null } })
                close(true)
              }}
            >
              Use the plan's setting
            </button>
          </div>
        </Popover>
      ) : null}
    </>
  )
}
