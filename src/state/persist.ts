import { del, get, set } from 'idb-keyval'
import { normalizeProject } from '../domain/files'
import type { Project } from '../domain/types'

/* The project as kept in the browser (IndexedDB), on this computer only.

   The one rule that matters here: a plan that is stored but cannot be read right now must
   never be mistaken for "nothing stored". The app would then start with an empty plan and
   save that over the real one. So reading tells the two cases apart: null means there is
   no plan; an error means there is one that could not be read. */

const KEY = 'team-day-planner/project/v1'

/** The plan saved in this browser, or null when none is saved.
 *
 *  Throws when something IS stored but cannot be read: the browser's storage failed, or
 *  the plan was written by a newer version of the app (a `ProjectFormatError`). Whoever
 *  calls this must then not save, or the stored plan is lost. */
export async function loadSavedProject(): Promise<Project | null> {
  const raw: unknown = await get(KEY)
  if (raw === undefined || raw === null) return null
  return normalizeProject(raw)
}

/** Like `loadSavedProject`, but a plan that cannot be read counts as none. Only for a
 *  caller that will not write to the browser's storage afterwards (looking for a plan left
 *  behind in this browser when the app works on the shared database). Never throws. */
export async function loadSavedProjectIfReadable(): Promise<Project | null> {
  try {
    return await loadSavedProject()
  } catch (error) {
    console.warn('The plan left in this browser could not be read; it is left untouched.', error)
    return null
  }
}

/** Saves the project. Rejects when the browser refuses to store it. */
export async function saveProject(project: Project): Promise<void> {
  await set(KEY, project)
}

export async function clearSavedProject(): Promise<void> {
  try {
    await del(KEY)
  } catch (error) {
    console.warn('Could not clear the saved plan.', error)
  }
}

/** Moves the plan stored in this browser out of the way, under a key of its own, so a new
 *  plan can start without destroying it. Used when the stored plan cannot be read (written
 *  by a newer version of the app); a newer version can still find it under that key. */
export async function setAsideSavedProject(): Promise<void> {
  const raw: unknown = await get(KEY)
  if (raw === undefined || raw === null) return
  await set(`${KEY}/set-aside/${new Date().toISOString()}`, raw)
  await del(KEY)
}
