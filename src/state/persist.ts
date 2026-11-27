import { del, get, set } from 'idb-keyval'
import { normalizeProject } from '../domain/files'
import type { Project } from '../domain/types'

/* The project is kept in the browser (IndexedDB), on this computer only. Storage can be
   unavailable (private windows, blocked site data), so every call is defensive and the app
   keeps working without it; the planner is told and can still export a file. */

const KEY = 'team-day-planner/project/v1'

/** The saved project, or null when there is none or it cannot be read. Never throws. */
export async function loadSavedProject(): Promise<Project | null> {
  try {
    const raw: unknown = await get(KEY)
    if (raw === undefined || raw === null) return null
    return normalizeProject(raw)
  } catch (error) {
    console.warn('Could not read the saved plan from this browser.', error)
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
