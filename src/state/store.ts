import { useSyncExternalStore } from 'react'
import { findIssues, type Issue } from '../domain/conflicts'
import { reduce, type Action } from '../domain/reducer'
import type { Project } from '../domain/types'
import { createHistoryStore, type DispatchOptions } from './createHistoryStore'
import { loadSavedProjectIfReadable, setAsideSavedProject } from './persist'
import { createSaver, type SaveStatus } from './saving'
import { startingProject } from './seed'
import { planStorage } from './storage'
import { toast } from '../ui/primitives'

/* The one project the app works on, with undo and redo, saved as you go: to the
   shared database when Supabase is set up, otherwise to this browser.

   Components read with the hooks (`useProject`, `useIssues`, ...) and change things with
   `dispatch(action)`. Nothing else may touch the project. */

export const projectStore = createHistoryStore<Project, Action>(reduce, startingProject())

/** Apply a change. Pass `{ coalesce: 'some-key' }` for edits that arrive in a burst (typing,
 *  dragging) so they undo as one step. */
export function dispatch(action: Action, options?: DispatchOptions): void {
  projectStore.dispatch(action, options)
}

export function undo(): void {
  projectStore.undo()
}

export function redo(): void {
  projectStore.redo()
}

/** The "Undo" for a toast that reports the edit just made: `toast('Removed Floor 4',
 *  undoAction())`. It takes back exactly that edit. Once the plan has changed again it is no
 *  longer valid, so a later click can never undo something else. */
export function undoAction(): { label: string; run: () => void; stillValid: () => boolean } {
  const edited = projectStore.getState()
  const stillValid = () => projectStore.getState() === edited
  return {
    label: 'Undo',
    run: () => {
      if (stillValid()) projectStore.undo()
    },
    stillValid,
  }
}

/** The current project, outside React (event handlers, action creators). */
export function getProject(): Project {
  return projectStore.getState()
}

export function useProject(): Project {
  return useSyncExternalStore(projectStore.subscribe, projectStore.getState, projectStore.getState)
}

export function useHistory(): { canUndo: boolean; canRedo: boolean } {
  return useSyncExternalStore(projectStore.subscribe, projectStore.getSnapshot, projectStore.getSnapshot)
}

const issueCache = new WeakMap<Project, Issue[]>()

/** All issues of a project; computed once per project snapshot. */
export function issuesOf(project: Project): Issue[] {
  let issues = issueCache.get(project)
  if (!issues) {
    issues = findIssues(project)
    issueCache.set(project, issues)
  }
  return issues
}

export function useIssues(): Issue[] {
  return issuesOf(useProject())
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export type { SaveStatus } from './saving'

const saver = createSaver(projectStore, {
  storage: planStorage,
  starting: startingProject,
  // Never blocks opening the shared plan: a leftover that cannot be read is left alone.
  leftInBrowser: loadSavedProjectIfReadable,
})

/** Where the plan is kept: the shared database, or only this browser. */
export const savedIn: 'database' | 'browser' = planStorage.where

export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(saver.subscribe, saver.getStatus, saver.getStatus)
}

/** After a conflict: take the plan someone else saved, dropping the edits made here. */
export const loadLatestPlan = (): Promise<void> => saver.loadLatest()
/** After a conflict: save this plan over the one someone else saved. */
export const keepMyPlan = (): Promise<void> => saver.keepMine()

/** Browser only, when the plan stored there cannot be read: keeps that plan aside in the
 *  browser and starts a new one. */
export async function startNewPlanInBrowser(): Promise<void> {
  await setAsideSavedProject()
  await startPersistence()
}

let listening = false

/** Loads the stored plan and starts saving changes. Call once at startup, and again to
 *  retry when the plan could not be read; resolves when the app can be shown or the
 *  attempt failed. */
export async function startPersistence(): Promise<void> {
  await saver.start()
  if (listening || typeof window === 'undefined' || saver.getStatus() === 'unreachable') return
  listening = true
  // Do not lose the last edit when the tab is closed within the debounce window.
  window.addEventListener('pagehide', () => void saver.flush())
  if (planStorage.where !== 'database') return
  // A save to the database may not finish once the page is gone: ask before leaving.
  window.addEventListener('beforeunload', (event) => {
    if (saver.hasUnsaved()) event.preventDefault()
  })
  // Coming back to the window: pick up what others saved meanwhile.
  const pull = () => {
    if (document.visibilityState !== 'visible') return
    void saver.pullNewer().then((pulled) => {
      if (pulled) toast('Loaded the latest plan, saved by someone else.')
    })
  }
  document.addEventListener('visibilitychange', pull)
  window.addEventListener('focus', pull)
}
