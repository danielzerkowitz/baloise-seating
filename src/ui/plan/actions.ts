import { autoSeat, type AutoSeatOutcome } from '../../domain/autoseat'
import { findTeam, indexAreas, sameSeating } from '../../domain/model'
import { blockedMessage, placeAction, placeIntent } from '../../domain/placing'
import type { Action } from '../../domain/reducer'
import { WEEKDAYS, WEEKDAY_NAME, type Id, type Project, type Team } from '../../domain/types'
import { dispatch, getProject, undo, undoAction } from '../../state/store'
import { getUi, setUi } from '../../state/ui'
import { plural } from '../format'
import { toast } from '../primitives'
import { nextTeamToSeat } from './trayLists'

/* What the Plan view does on a click, a drop or a key: seat a team in an area, step to the
   next team, seat automatically. Plain functions that read the stores at the moment they
   run, so every handler works on the latest state. */

// ---------------------------------------------------------------------------
// Seating by hand
// ---------------------------------------------------------------------------

/** What a click on an area does while a team is being seated: gives the team seats there, or
 *  takes its seats there away. A click that cannot do anything says why. */
export function placeTeam(teamId: Id, areaId: Id): void {
  const project = getProject()
  const { day, seatScope } = getUi()
  const team = findTeam(project, teamId)
  const area = indexAreas(project).get(areaId)?.area
  if (!team || !area) return
  const intent = placeIntent(project, team, area, day, seatScope)
  if (intent.type === 'blocked') {
    toast(blockedMessage(team, area, intent.reason))
    return
  }
  const action = placeAction(project, team, area, day, seatScope)
  if (action) dispatch(action)
}

/** The N key: makes the next team that still needs seats on the shown day the active one. */
export function seatNextTeam(): void {
  const { day, activeTeamId } = getUi()
  const next = nextTeamToSeat(getProject(), day, activeTeamId)
  if (next) setUi({ activeTeamId: next.id })
  else toast(`No team is left to seat on ${WEEKDAY_NAME[day]}`)
}

// ---------------------------------------------------------------------------
// Ending a mode, and where the focus goes when its controls disappear
// ---------------------------------------------------------------------------

export const PLACING_BAR_ID = 'plan-placing-bar'
export const AREA_INSPECTOR_ID = 'plan-area-inspector'

/** The DOM id of a team's row in the tray. */
export function teamRowId(teamId: Id): string {
  return `plan-team-${teamId}`
}

/** Moves the focus to a team's row in the tray, when the tray shows it. */
export function focusTeamRow(teamId: Id): void {
  document.getElementById(teamRowId(teamId))?.focus()
}

/** Moves the focus to the first team in the tray: the place to continue when the button
 *  that had the focus is gone and no particular team is concerned. */
export function focusFirstTeamRow(): void {
  document.querySelector<HTMLElement>('.plan-team')?.focus()
}

function focusIsIn(elementId: string): boolean {
  return document.getElementById(elementId)?.contains(document.activeElement) ?? false
}

/** Makes no team active. The placing bar goes away with that; when the focus was on it, the
 *  focus moves to the team's row instead of getting lost. */
export function stopSeating(): void {
  const { activeTeamId } = getUi()
  if (activeTeamId === null) return
  const focusWasOnBar = focusIsIn(PLACING_BAR_ID)
  setUi({ activeTeamId: null })
  if (focusWasOnBar) focusTeamRow(activeTeamId)
}

/** Selects no area. The inspector goes away with that; when the focus was on it, the focus
 *  returns to the area on the plan. */
export function deselectArea(): void {
  if (getUi().selectedAreaId === null) return
  const focusWasOnInspector = focusIsIn(AREA_INSPECTOR_ID)
  // The sheet marks the selected area's button with aria-pressed.
  const areaOnPlan = document.querySelector<HTMLElement>('.plan-canvas .area[aria-pressed="true"]')
  setUi({ selectedAreaId: null })
  if (focusWasOnInspector) areaOnPlan?.focus()
}

// ---------------------------------------------------------------------------
// Automatic seating
// ---------------------------------------------------------------------------

function sameSeats(a: Team, b: Team): boolean {
  if (!sameSeating(a.seating, b.seating)) return false
  return WEEKDAYS.every((day) => {
    const x = a.daySeating[day]
    const y = b.daySeating[day]
    return x === undefined || y === undefined ? x === y : sameSeating(x, y)
  })
}

/** Teams the proposal could not seat on every one of their team days. */
function countIncomplete(outcomes: readonly AutoSeatOutcome[]): number {
  return outcomes.filter((outcome) => outcome.result === 'partly' || outcome.result === 'unseated').length
}

/** "Seat automatically" for one team: applies the proposal for that team as one undoable
 *  step and says what came of it. */
export function seatTeamAutomatically(teamId: Id): void {
  const before = getProject()
  const team = findTeam(before, teamId)
  if (!team) return
  const result = autoSeat(before, { teamIds: [teamId] })
  const message = result.outcomes.find((outcome) => outcome.teamId === teamId)?.message
  const proposed = findTeam(result.project, teamId)
  if (result.project !== before && proposed) {
    dispatch({ type: 'seat/replace', teamId, seating: proposed.seating, daySeating: proposed.daySeating })
  }
  // "Undo" is only offered for a change that really happened; otherwise it would take back
  // an earlier, unrelated edit.
  if (getProject() === before) toast(message ?? 'Nothing to change')
  else toast(message ?? `Seated ${team.name} automatically`, undoAction())
}

/** What "Seat everyone automatically" did, for the dialog that lets the planner keep it or
 *  take it back. */
export interface AutoSeatReport {
  /** What came of each team that was considered, in team-list order. */
  outcomes: AutoSeatOutcome[]
  /** How many teams got other seats. */
  changedTeams: number
  /** The plan right after the proposal was applied, to tell whether "Undo" would still take
   *  back this step. */
  applied: Project
}

/** "Seat everyone automatically": applies the proposal for all teams as ONE undoable step.
 *  Returns what happened, or null when the proposal changed nothing (a toast says so). */
export function seatEveryoneAutomatically(): AutoSeatReport | null {
  const before = getProject()
  const result = autoSeat(before)
  const actions: Action[] = []
  for (const proposed of result.project.teams) {
    const current = findTeam(before, proposed.id)
    if (!current || sameSeats(current, proposed)) continue
    actions.push({
      type: 'seat/replace',
      teamId: proposed.id,
      seating: proposed.seating,
      daySeating: proposed.daySeating,
    })
  }
  if (actions.length > 0) dispatch({ type: 'batch', actions })
  const applied = getProject()
  if (applied === before) {
    const incomplete = countIncomplete(result.outcomes)
    toast(
      incomplete > 0
        ? `Nothing to change: ${plural(incomplete, 'team')} could not be seated completely`
        : 'Nothing to change',
    )
    return null
  }
  return { outcomes: result.outcomes, changedTeams: actions.length, applied }
}

/** The report in a sentence or two: "Seated 6 teams. 2 could not be seated completely." */
export function autoSeatSummary(report: AutoSeatReport): string {
  const seated = report.outcomes.filter((outcome) => outcome.result === 'seated').length
  const incomplete = countIncomplete(report.outcomes)
  const sentences: string[] = []
  if (seated > 0) sentences.push(`Seated ${plural(seated, 'team')}.`)
  if (incomplete > 0) {
    // After "Seated 6 teams." the number alone reads well; on its own it needs its noun.
    sentences.push(`${seated > 0 ? incomplete : plural(incomplete, 'team')} could not be seated completely.`)
  }
  if (sentences.length === 0) sentences.push(`Changed the seats of ${plural(report.changedTeams, 'team')}.`)
  return sentences.join(' ')
}

/** Takes an automatic seating back, unless the plan has changed since: "Undo" would then
 *  take back that other change. */
export function undoAutoSeat(report: AutoSeatReport): void {
  if (getProject() === report.applied) undo()
}
