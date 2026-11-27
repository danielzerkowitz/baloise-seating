import { useRef } from 'react'
import { hasDayException, isTeamDay, teamDayStatus } from '../../domain/model'
import { WEEKDAY_NAME, type Project, type Team, type Weekday } from '../../domain/types'
import { dispatch, undoAction } from '../../state/store'
import { setUi } from '../../state/ui'
import { IconCheck, IconWand } from '../icons'
import { Segmented, TeamChip, toast } from '../primitives'
import { PLACING_BAR_ID, seatTeamAutomatically, stopSeating } from './actions'

/** Shown above the plan while a team is being seated: who it is, how far along, and whether
 *  clicks seat the team on every team day or only on the shown one. */
export function PlacingBar(props: { project: Project; team: Team; day: Weekday; seatScope: 'all' | 'day' }) {
  const { project, team, day } = props
  const bar = useRef<HTMLDivElement>(null)
  const weekday = WEEKDAY_NAME[day]
  const status = teamDayStatus(project, team, day)
  const complete = status.state === 'seated' || status.state === 'over'

  /** Some buttons here vanish once they did their work. The focus then stays on the bar. */
  const keepFocus = () => bar.current?.focus()

  const resetDay = () => {
    dispatch({ type: 'seat/resetDay', teamId: team.id, day })
    toast(`${team.name} uses its normal seating on ${weekday} again`, undoAction())
    keepFocus()
  }

  const scopeOptions = [
    { value: 'all', label: 'Every team day' },
    { value: 'day', label: `Only ${weekday}` },
  ] as const

  return (
    <div
      id={PLACING_BAR_ID}
      ref={bar}
      className="plan-bar"
      role="group"
      aria-label={`Seating ${team.name}`}
      tabIndex={-1}
    >
      <TeamChip color={team.color}>
        <span className="truncate">{team.name}</span>
      </TeamChip>

      {isTeamDay(team, day) ? (
        <>
          <span className="plan-bar__count">
            <span>
              <span className="plan-bar__number sign">{status.seated}</span> of{' '}
              <span className="plan-bar__number sign">{status.needed}</span> {status.needed === 1 ? 'seat' : 'seats'}
            </span>
            {complete ? <IconCheck className="plan-icon plan-icon--ok" title="Complete" /> : null}
          </span>
          {hasDayException(team, day) ? (
            // The team already sits differently on this day, so clicks can only edit this day.
            <div className="plan-bar__scope">
              Different seating on {weekday}
              <button type="button" className="link" onClick={resetDay}>
                Use the normal seating
              </button>
            </div>
          ) : (
            <div className="plan-bar__scope">
              <span className="muted" aria-hidden="true">
                Seat on
              </span>
              <Segmented
                small
                label="Seat on"
                options={scopeOptions}
                value={props.seatScope}
                onChange={(seatScope) => setUi({ seatScope })}
              />
            </div>
          )}
        </>
      ) : (
        <div className="plan-bar__scope">
          {team.name} is not in on {weekday}.
          {team.days.length === 0 ? (
            <>
              <span className="muted">It has no team days yet.</span>
              <button type="button" className="link" onClick={() => setUi({ view: 'teams' })}>
                Choose them in Teams and days
              </button>
            </>
          ) : (
            team.days.map((teamDay) => (
              <button
                key={teamDay}
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setUi({ day: teamDay })
                  keepFocus()
                }}
              >
                Go to {WEEKDAY_NAME[teamDay]}
              </button>
            ))
          )}
        </div>
      )}

      <div className="plan-bar__actions">
        <button type="button" className="btn btn--sm" onClick={() => seatTeamAutomatically(team.id)}>
          <IconWand />
          Seat automatically
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={stopSeating}>
          Done
        </button>
      </div>
    </div>
  )
}
