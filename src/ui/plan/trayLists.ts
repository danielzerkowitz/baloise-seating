import { teamDayStatus, type SeatState, type TeamDayStatus } from '../../domain/model'
import type { Id, Project, Team, Weekday } from '../../domain/types'

/* How the team tray sorts the teams on one day. It lives apart from the components because
   the tray and the "next team" key must agree on the order. */

export interface TrayEntry {
  team: Team
  /** The team's seats on the day the tray shows. */
  status: TeamDayStatus
}

export interface TrayLists {
  /** In on the day and not fully seated, in team-list order. The order does not depend on
   *  how many seats a team already has, so a team does not jump while it is being seated. */
  toSeat: TrayEntry[]
  /** In on the day with all their seats, or more than they need. */
  seated: TrayEntry[]
  /** Not in on the day. */
  notIn: TrayEntry[]
}

function needsSeats(state: SeatState): boolean {
  return state === 'unseated' || state === 'short'
}

export function trayLists(project: Project, day: Weekday): TrayLists {
  const toSeat: TrayEntry[] = []
  const seated: TrayEntry[] = []
  const notIn: TrayEntry[] = []
  for (const team of project.teams) {
    const status = teamDayStatus(project, team, day)
    const entry: TrayEntry = { team, status }
    if (status.state === 'off') notIn.push(entry)
    else if (needsSeats(status.state)) toSeat.push(entry)
    else seated.push(entry)
  }
  return { toSeat, seated, notIn }
}

/** The team to seat after the active one: the next in the "To seat" list of the day,
 *  starting again at the top after the last. Undefined when nobody is left to seat. */
export function nextTeamToSeat(project: Project, day: Weekday, activeTeamId: Id | null): Team | undefined {
  const { toSeat } = trayLists(project, day)
  if (toSeat.length === 0) return undefined
  // Not in the list (or no team active) gives -1, so the search starts at the top.
  const at = toSeat.findIndex((entry) => entry.team.id === activeTeamId)
  return toSeat[(at + 1) % toSeat.length]?.team
}

/** True when a team still needs seats on at least one of its team days. */
export function anyTeamNeedsSeats(project: Project): boolean {
  return project.teams.some((team) => team.days.some((day) => needsSeats(teamDayStatus(project, team, day).state)))
}
