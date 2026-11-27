import { useSyncExternalStore } from 'react'
import { WEEKDAYS, type Id, type Project, type Weekday } from '../../domain/types'

/* What is being printed. The dialog chooses a job, the print root renders it for the paper,
   and the job is cleared once the browser is done printing. */

export interface PrintJob {
  /** The weekdays to print a page per floor for. */
  days: Weekday[]
  floorIds: Id[]
  /** Whether to add the week overview as a last page. */
  week: boolean
}

export interface PrintState {
  dialogOpen: boolean
  /** The pages on paper right now; null when nothing is being printed. */
  job: PrintJob | null
}

const INITIAL: PrintState = { dialogOpen: false, job: null }

let state: PrintState = INITIAL
const listeners = new Set<() => void>()

function setState(next: PrintState): void {
  state = next
  for (const listener of [...listeners]) listener()
}

export function getPrintState(): PrintState {
  return state
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePrintState(): PrintState {
  return useSyncExternalStore(subscribe, getPrintState, getPrintState)
}

export function openPrintDialog(): void {
  if (!state.dialogOpen) setState({ ...state, dialogOpen: true })
}

export function closePrintDialog(): void {
  if (state.dialogOpen) setState({ ...state, dialogOpen: false })
}

export function setPrintJob(job: PrintJob | null): void {
  if (job !== state.job) setState({ ...state, job })
}

/** Back to nothing open and nothing printing (for tests). */
export function resetPrintState(): void {
  setState(INITIAL)
}

/** What to print unless the planner chooses otherwise: every floor on the days on which at
 *  least one team is in (all five days while there are no teams), and the week overview. */
export function defaultPrintJob(project: Project): PrintJob {
  const busy = WEEKDAYS.filter((day) => project.teams.some((team) => team.days.includes(day)))
  return {
    days: project.teams.length === 0 ? [...WEEKDAYS] : busy,
    floorIds: project.floors.map((floor) => floor.id),
    week: true,
  }
}

/** Pages a job takes: one per day and floor, and one for the week overview (which runs on
 *  to a second page only when the team list is very long). */
export function pageCount(job: PrintJob): number {
  return job.days.length * job.floorIds.length + (job.week ? 1 : 0)
}
