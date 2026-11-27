import type { CSSProperties } from 'react'
import { teamStyle } from '../../domain/color'
import { dayOccupancy, isSeatable, isTeamDay, seatsNeeded } from '../../domain/model'
import { effectiveScope, scopedSeating } from '../../domain/placing'
import {
  WEEKDAY_NAME,
  type Area,
  type Floor,
  type Project,
  type SeatingScope,
  type Team,
  type Weekday,
} from '../../domain/types'
import { dispatch, undoAction } from '../../state/store'
import { showOnPlan } from '../../state/ui'
import { percent, plural } from '../format'
import { IconWand } from '../icons'
import { SeverityIcon, Stepper, toast } from '../primitives'
import { focusTeamRow, seatTeamAutomatically } from './actions'

/** Under the row of the team being seated: the seats it needs and the seats it holds, area
 *  by area, with a stepper to fine-tune each. */
export function TeamDetail(props: { project: Project; team: Team; day: Weekday; seatScope: 'all' | 'day' }) {
  const { project, team, day } = props
  const weekday = WEEKDAY_NAME[day]
  const inToday = isTeamDay(team, day)
  // A team that is not in on the shown day has no seating of that day to edit, so its normal
  // seating is shown instead.
  const scope: SeatingScope = inToday ? effectiveScope(team, day, props.seatScope) : 'all'
  const seating = scopedSeating(team, scope)
  const occupancy = dayOccupancy(project, day)
  const attendance = team.attendance ?? project.settings.attendance

  const held: { floor: Floor; area: Area; seats: number }[] = []
  for (const floor of project.floors) {
    for (const area of floor.areas) {
      const seats = seating[area.id] ?? 0
      if (seats > 0) held.push({ floor, area, seats })
    }
  }
  // "Clear seats" on the normal seating also drops the day exceptions, so those count too.
  const hasSeats = scope === 'all' ? held.length > 0 || Object.keys(team.daySeating).length > 0 : held.length > 0

  const setSeats = (area: Area, seats: number) => {
    dispatch(
      { type: 'seat/set', teamId: team.id, areaId: area.id, seats, scope },
      { coalesce: `seats-${team.id}-${area.id}` },
    )
    // The line goes away with its last seat. The focus moves to the team's row, not nowhere.
    if (seats === 0) focusTeamRow(team.id)
  }

  const clearSeats = () => {
    dispatch({ type: 'seat/clear', teamId: team.id, scope })
    const where = scope === 'all' ? '' : ` on ${WEEKDAY_NAME[scope]}`
    toast(`Cleared the seats of ${team.name}${where}`, undoAction())
    focusTeamRow(team.id)
  }

  /** What is wrong with the team's seats in an area, if anything. */
  const problemIn = (area: Area): string | null => {
    if (!isSeatable(area.kind)) return 'Not for seating'
    // Only a day the team is in on can be a conflict of this team.
    if (inToday && (occupancy.get(area.id)?.free ?? 0) < 0) return `Over capacity on ${weekday}`
    return null
  }

  return (
    <div className="plan-detail" style={teamStyle(team.color) as CSSProperties}>
      <p className="small">
        {plural(team.size, 'person', 'people')}, {plural(seatsNeeded(team, project.settings), 'seat')}
        {attendance < 1 ? ` at ${percent(attendance)}` : ''}
      </p>

      {held.length > 0 ? (
        <>
          <h4 className="plan-detail__scope small muted">
            {scope === 'all' ? 'Normal seating' : `Only on ${WEEKDAY_NAME[scope]}`}
          </h4>
          <ul className="plan-detail__seats">
            {held.map(({ floor, area, seats }) => {
              const problem = problemIn(area)
              return (
                <li key={area.id} className="plan-detail__seat">
                  <span className="plan-detail__floor sign" title={floor.name} aria-hidden="true">
                    {floor.label}
                  </span>
                  <button
                    type="button"
                    className="link truncate plan-detail__area"
                    aria-label={`Show ${area.name} on ${floor.name}`}
                    onClick={() => showOnPlan({ floorId: floor.id, areaId: area.id })}
                  >
                    {area.name}
                  </button>
                  {problem ? (
                    <span className="plan-detail__problem" title={problem}>
                      <SeverityIcon severity="error" />
                      <span className="visually-hidden">{problem}</span>
                    </span>
                  ) : null}
                  {isSeatable(area.kind) ? (
                    <span className="plan-detail__stepper">
                      <Stepper
                        value={seats}
                        min={0}
                        max={999}
                        label={`Seats in ${area.name}`}
                        onChange={(next) => setSeats(area, next)}
                      />
                    </span>
                  ) : (
                    // Seats in a room are a mistake to undo, not a number to tune: one button
                    // takes them all away.
                    <>
                      <span className="plan-detail__held sign">{seats}</span>
                      <button
                        type="button"
                        className="link small"
                        aria-label={`Remove the seats in ${area.name}`}
                        onClick={() => setSeats(area, 0)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <p className="muted small">
          {inToday
            ? 'Click an area on the plan to seat this team there.'
            : `Not in on ${weekday}, so it cannot be seated on this day's plan.`}
        </p>
      )}

      <div className="plan-detail__actions">
        <button type="button" className="btn btn--sm" onClick={() => seatTeamAutomatically(team.id)}>
          <IconWand />
          Seat automatically
        </button>
        <button type="button" className="btn btn--sm" disabled={!hasSeats} onClick={clearSeats}>
          Clear seats
        </button>
      </div>
    </div>
  )
}
