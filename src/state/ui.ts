import { useSyncExternalStore } from 'react'
import type { Floor, Id, Project, Weekday } from '../domain/types'

/* What the planner is looking at: view, day, floor, selection. Not part of the project and
   not undoable. Any component may read it with `useUi()` and change it with `setUi()`. */

/** `teams` is the "Teams and days" matrix. */
export type View = 'plan' | 'teams' | 'floors'

export interface Spotlight {
  areaId: Id | null
  teamId: Id | null
  /** Changes on every request, so the same target can be spotlighted twice in a row. */
  token: number
}

export interface UiState {
  view: View
  /** The weekday shown in the Plan view. */
  day: Weekday
  /** The floor shown in the Plan and Floors views. Null means "the top floor"; use
   *  `currentFloor()` to resolve it. */
  floorId: Id | null
  /** Plan view: the team being seated, if any. */
  activeTeamId: Id | null
  /** Plan view: whether seating edits apply to every team day or only to the day shown. */
  seatScope: 'all' | 'day'
  /** The selected area: inspected in the Plan view, edited in the Floors view. */
  selectedAreaId: Id | null
  /** Plan view: which list the side panel shows. */
  sideTab: 'teams' | 'conflicts'
  /** Something to draw the eye to on the plan (after "Show on plan"). */
  spotlight: Spotlight | null
  /** Teams view: the team whose name field should take focus (just added). */
  focusTeamId: Id | null
}

const INITIAL: UiState = {
  view: 'plan',
  day: 'mon',
  floorId: null,
  activeTeamId: null,
  seatScope: 'all',
  selectedAreaId: null,
  sideTab: 'teams',
  spotlight: null,
  focusTeamId: null,
}

let state: UiState = INITIAL

const listeners = new Set<() => void>()
let spotlightToken = 0

export function getUi(): UiState {
  return state
}

export function setUi(change: Partial<UiState>): void {
  // "Only on Tuesday" is a choice for the team at hand. The next team starts with its
  // normal seating again, or a whole team could be seated for one day by accident.
  const patch: Partial<UiState> =
    change.activeTeamId !== undefined && change.activeTeamId !== state.activeTeamId && change.seatScope === undefined
      ? { ...change, seatScope: 'all' }
      : change
  let changed = false
  for (const key of Object.keys(patch) as (keyof UiState)[]) {
    if (patch[key] !== state[key]) changed = true
  }
  if (!changed) return
  state = { ...state, ...patch }
  for (const listener of [...listeners]) listener()
}

/** Back to the starting view state (for tests). */
export function resetUi(): void {
  state = INITIAL
  for (const listener of [...listeners]) listener()
}

export function useUi(): UiState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getUi,
    getUi,
  )
}

/** The floor to show: the chosen one, or the top floor when nothing (valid) is chosen. */
export function currentFloor(project: Project, ui: Pick<UiState, 'floorId'>): Floor | undefined {
  return project.floors.find((f) => f.id === ui.floorId) ?? project.floors[project.floors.length - 1]
}

/** Go to the Plan view at a day and floor and draw attention to an area and/or a team. */
export function showOnPlan(target: { day?: Weekday | null; floorId?: Id | null; areaId?: Id | null; teamId?: Id | null }): void {
  spotlightToken += 1
  setUi({
    view: 'plan',
    ...(target.day ? { day: target.day } : {}),
    ...(target.floorId ? { floorId: target.floorId } : {}),
    selectedAreaId: target.areaId ?? null,
    spotlight:
      target.areaId || target.teamId
        ? { areaId: target.areaId ?? null, teamId: target.teamId ?? null, token: spotlightToken }
        : null,
  })
}
