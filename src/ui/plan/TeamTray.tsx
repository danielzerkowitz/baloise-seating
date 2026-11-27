import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { worstSeverity, type Issue } from '../../domain/conflicts'
import { WEEKDAY_NAME, type Id, type Project, type Weekday } from '../../domain/types'
import { exampleTeams } from '../../state/seed'
import { dispatch, getProject } from '../../state/store'
import { setUi } from '../../state/ui'
import { daysLong, daysShort, plural } from '../format'
import { IconCheck, IconChevronDown, IconChevronRight, IconWand } from '../icons'
import { SeverityIcon, Swatch } from '../primitives'
import { TEAM_DRAG_TYPE } from '../sheet/SeatingSheet'
import { focusFirstTeamRow, teamRowId } from './actions'
import { TeamDetail } from './TeamDetail'
import { anyTeamNeedsSeats, trayLists, type TrayEntry } from './trayLists'

/** Lights a team's seats up on the plan (true) or stops doing so (false). */
type Emphasize = (teamId: Id, on: boolean) => void

function rowLabel(entry: TrayEntry, conflict: boolean): string {
  const { team, status } = entry
  const parts = [team.name]
  if (team.group) parts.push(team.group)
  if (status.planned) parts.push(`${status.seated} of ${plural(status.needed, 'seat')}`)
  else parts.push(team.days.length > 0 ? `in on ${daysLong(team.days)}` : 'no team days')
  if (conflict) parts.push('has a conflict')
  return parts.join(', ')
}

/** One team in the tray. Click it to seat the team, or drag it onto an area. */
function TeamRow(props: { entry: TrayEntry; active: boolean; conflict: boolean; onEmphasis: Emphasize }) {
  const { entry, active, conflict, onEmphasis } = props
  const { team, status } = entry
  const complete = status.state === 'seated' || status.state === 'over'

  // A row can go away while it is pointed at (the team moves to another list). No leave
  // event follows then, so the emphasis is dropped here.
  useEffect(() => () => onEmphasis(team.id, false), [onEmphasis, team.id])

  return (
    <button
      id={teamRowId(team.id)}
      type="button"
      className="plan-team"
      aria-pressed={active}
      aria-label={rowLabel(entry, conflict)}
      draggable
      onClick={() => setUi({ activeTeamId: active ? null : team.id })}
      onDragStart={(e) => {
        e.dataTransfer.setData(TEAM_DRAG_TYPE, team.id)
        e.dataTransfer.effectAllowed = 'move'
        // Making the team active rearranges the tray. A browser may give up on a drag whose
        // source moves while it starts, so the team becomes active a moment later.
        window.setTimeout(() => setUi({ activeTeamId: team.id }), 0)
      }}
      onMouseEnter={() => onEmphasis(team.id, true)}
      onMouseLeave={() => onEmphasis(team.id, false)}
      onFocus={(e) => {
        // Focus from the keyboard is the counterpart of pointing. A click focuses the row
        // too, and that focus stays when the pointer has long left: it does not count.
        if (e.currentTarget.matches(':focus-visible')) onEmphasis(team.id, true)
      }}
      onBlur={() => onEmphasis(team.id, false)}
    >
      <span className="plan-team__swatch">
        <Swatch color={team.color} />
      </span>
      <span className="plan-team__text">
        <span className="plan-team__name truncate">{team.name}</span>
        {team.group ? <span className="truncate faint small">{team.group}</span> : null}
      </span>
      {status.planned ? (
        <span className="plan-team__count sign">
          {status.seated}/{status.needed}
        </span>
      ) : (
        <span className="plan-team__days muted small">{daysShort(team.days)}</span>
      )}
      {complete ? <IconCheck className="plan-icon plan-icon--ok" title="Complete" /> : null}
      {conflict ? (
        <span className="plan-alert">
          <SeverityIcon severity="error" withTitle />
        </span>
      ) : null}
    </button>
  )
}

interface ListProps {
  project: Project
  issues: readonly Issue[]
  day: Weekday
  activeTeamId: Id | null
  seatScope: 'all' | 'day'
  onEmphasis: Emphasize
}

function TeamList(props: ListProps & { entries: readonly TrayEntry[] }) {
  const { project, issues, day, activeTeamId } = props
  return (
    <ul className="plan-tray__list">
      {props.entries.map((entry) => (
        <li key={entry.team.id}>
          <TeamRow
            entry={entry}
            active={entry.team.id === activeTeamId}
            conflict={worstSeverity(issues, { day, teamId: entry.team.id }) === 'error'}
            onEmphasis={props.onEmphasis}
          />
          {entry.team.id === activeTeamId ? (
            <TeamDetail project={project} team={entry.team} day={day} seatScope={props.seatScope} />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** The teams of the shown day, sorted by what is left to do: to seat, seated, not in. */
export function TeamTray(props: ListProps & { onSeatEveryone: () => void }) {
  const { project, day, activeTeamId } = props
  const weekday = WEEKDAY_NAME[day]
  const lists = trayLists(project, day)
  const activeIsNotIn = lists.notIn.some((entry) => entry.team.id === activeTeamId)
  const [notInOpen, setNotInOpen] = useState(false)

  // The team being seated must be visible in the tray, also when the shown day is not one of
  // its days: open that list for it. The planner can still close it again.
  useEffect(() => {
    if (activeIsNotIn) setNotInOpen(true)
  }, [activeIsNotIn, activeTeamId])

  if (project.teams.length === 0) {
    return (
      <div className="empty">
        <h3 className="empty__title">No teams yet</h3>
        <p className="empty__text">Add your teams and the days they want to come in. Then seat them here.</p>
        <div className="row row--wrap">
          <button type="button" className="btn btn--primary" onClick={() => setUi({ view: 'teams' })}>
            Add teams
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              // Rendered at once, because this button is gone as soon as there are teams and
              // the focus should move on to the first of them.
              flushSync(() => dispatch({ type: 'team/addMany', teams: exampleTeams(getProject()) }))
              focusFirstTeamRow()
            }}
          >
            Try with example teams
          </button>
        </div>
      </div>
    )
  }

  const listProps: ListProps = {
    project,
    issues: props.issues,
    day,
    activeTeamId,
    seatScope: props.seatScope,
    onEmphasis: props.onEmphasis,
  }

  return (
    <div className="plan-tray">
      <h3 className="list-heading">
        To seat <span className="plan-tray__count sign">{lists.toSeat.length}</span>
      </h3>
      {lists.toSeat.length > 0 ? (
        <>
          <p className="plan-tray__hint muted small">
            Pick a team, then click areas on the plan. Press <kbd>N</kbd> for the next team.
          </p>
          <TeamList {...listProps} entries={lists.toSeat} />
        </>
      ) : lists.seated.length > 0 ? (
        <p className="plan-tray__done small">
          <IconCheck className="plan-icon plan-icon--ok" />
          Every team in on {weekday} has its seats.
        </p>
      ) : (
        <p className="muted small">No team is in on {weekday}.</p>
      )}

      {lists.seated.length > 0 ? (
        <>
          <h3 className="list-heading">
            Seated <span className="plan-tray__count sign">{lists.seated.length}</span>
          </h3>
          <TeamList {...listProps} entries={lists.seated} />
        </>
      ) : null}

      {lists.notIn.length > 0 ? (
        <details
          className="plan-tray__others"
          open={notInOpen}
          onToggle={(e) => setNotInOpen(e.currentTarget.open)}
        >
          <summary className="list-heading plan-tray__summary">
            <span className="plan-tray__summary-label">
              {notInOpen ? <IconChevronDown className="plan-icon" /> : <IconChevronRight className="plan-icon" />}
              Not in on {weekday}
            </span>
            <span className="plan-tray__count sign">{lists.notIn.length}</span>
          </summary>
          <TeamList {...listProps} entries={lists.notIn} />
        </details>
      ) : null}

      {anyTeamNeedsSeats(project) ? (
        <div className="plan-tray__footer">
          <button type="button" className="btn" onClick={props.onSeatEveryone}>
            <IconWand />
            Seat everyone automatically
          </button>
        </div>
      ) : null}
    </div>
  )
}
