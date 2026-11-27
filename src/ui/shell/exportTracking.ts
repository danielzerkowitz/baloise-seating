import { useSyncExternalStore } from 'react'
import type { Project } from '../../domain/types'
import { projectStore } from '../../state/store'

/* The plan is kept in this browser only, so an exported plan file is the copy that survives
   a cleaned browser. This keeps track, for this session, of whether the plan on screen is
   in such a file. */

/** Every state of the plan that exists as a file: exported, or opened from one. Undoing
 *  back to one of them means there is nothing new to export. */
let inFile = new WeakSet<Project>()
/** Whether a plan file was exported or opened at all in this session. */
let usedFile = false

const listeners = new Set<() => void>()

/** Call when this exact state of the plan was written to a file or read from one. */
export function markAsFile(project: Project): void {
  inFile.add(project)
  usedFile = true
  for (const listener of [...listeners]) listener()
}

function hasUnexportedChanges(): boolean {
  const project = projectStore.getState()
  if (inFile.has(project)) return false
  // Before the first file there is only something to lose once teams are planned.
  return usedFile || project.teams.length > 0
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const unsubscribe = projectStore.subscribe(listener)
  return () => {
    listeners.delete(listener)
    unsubscribe()
  }
}

/** True when the plan has changed since the last exported or opened file, or was never
 *  exported although it has teams. */
export function useUnexportedChanges(): boolean {
  return useSyncExternalStore(subscribe, hasUnexportedChanges, hasUnexportedChanges)
}

/** Forgets every file of this session (for tests). */
export function resetExportTracking(): void {
  inFile = new WeakSet<Project>()
  usedFile = false
  for (const listener of [...listeners]) listener()
}
