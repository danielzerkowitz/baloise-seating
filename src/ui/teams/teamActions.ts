import { makeTeam, teamDayStatus } from '../../domain/model'
import type { Action } from '../../domain/reducer'
import { WEEKDAY_NAME, type Project, type Team, type Weekday } from '../../domain/types'
import { exampleTeams } from '../../state/seed'
import { dispatch, getProject, undoAction } from '../../state/store'
import { setUi, showOnPlan } from '../../state/ui'
import { plural } from '../format'
import { toast } from '../primitives'
import { MAX_NAME_LENGTH } from './limits'

/* Edits that more than one place in this view offers, each with the message it leaves
   behind, so that the same action reads the same wherever it was started. */


/** The name to use for a team in sentences and in accessible names. A team has no name for
 *  a moment while its name is being retyped. */
export function teamLabel(team: Pick<Team, 'name'>): string {
  return team.name.trim() || 'Unnamed team'
}

/** Applies an edit and tells whether it changed anything. A message with "Undo" is only
 *  right for something that happened: otherwise "Undo" would take back an earlier edit. */
function applied(action: Action): boolean {
  const before = getProject()
  dispatch(action)
  return getProject() !== before
}

export function moveTeamDay(team: Team, from: Weekday, to: Weekday): void {
  if (!applied({ type: 'team/moveDay', id: team.id, from, to })) return
  toast(`Moved ${teamLabel(team)} from ${WEEKDAY_NAME[from]} to ${WEEKDAY_NAME[to]}`, undoAction())
}

export function removeTeam(team: Team): void {
  if (!applied({ type: 'team/remove', id: team.id })) return
  toast(`Removed ${teamLabel(team)}`, undoAction())
}

export function removeAllTeams(): void {
  const actions: Action[] = getProject().teams.map((team) => ({ type: 'team/remove', id: team.id }))
  if (!applied({ type: 'batch', actions })) return
  toast('Removed all teams', undoAction())
}

export function addExampleTeams(): void {
  const { action, count } = exampleTeams(getProject())
  if (!applied(action)) return
  toast(`Added ${plural(count, 'example team')}`, undoAction())
}

const COPY_SUFFIX = ' copy'

/** Adds a team with the same size, days, domain and ART, and what the original said about each
 *  day. It starts without seats, and its name field takes the focus. */
export function duplicateTeam(team: Team): void {
  const copy = makeTeam(getProject(), {
    // A name at its full length is shortened to make room for the suffix.
    name: `${team.name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`.trim(),
    size: team.size,
    days: team.days,
    domainId: team.domainId,
    artId: team.artId,
  })
  dispatch({ type: 'team/add', team: { ...copy, wishes: { ...team.wishes } } })
  setUi({ focusTeamId: copy.id })
}

/** Opens the plan with the team picked up, ready to be seated or moved: on the given day
 *  and on the floor where the team sits that day (or, while it has no seats, the floor it
 *  prefers). Without a day the plan keeps showing the day it was on. */
export function seatOnPlan(project: Project, team: Team, day: Weekday | undefined): void {
  const floorId = day ? teamDayStatus(project, team, day).floorIds[0] : undefined
  showOnPlan({ day, floorId: floorId ?? team.homeFloorId, teamId: team.id })
  setUi({ activeTeamId: team.id })
}
