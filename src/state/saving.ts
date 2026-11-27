import type { Project } from '../domain/types'
import type { HistoryStore } from './createHistoryStore'
import { PlanChangedElsewhere, type PlanStorage, type Saved } from './storage'

export type SaveStatus =
  /** Reading what was saved earlier; the app is not shown yet. */
  | 'loading'
  /** The saved plan could not be read. Nothing is shown and nothing is saved: saving the
   *  starting plan now would overwrite the real one. */
  | 'unreachable'
  | 'saved'
  | 'saving'
  /** The last save did not get through. Work continues; the next edit, or a retry a little
   *  later, tries again. */
  | 'failed'
  /** Someone else saved the plan since it was loaded here. Nothing is saved until the
   *  planner chooses: load theirs, or keep this one. */
  | 'conflict'

export interface SaverOptions {
  storage: PlanStorage
  /** What to start with when nothing is stored yet. */
  starting: () => Project
  /** A plan left in this browser by an earlier version of the app, to carry over into an
   *  empty database. */
  leftInBrowser?: () => Promise<Project | null>
  /** Milliseconds between an edit and its save. */
  debounceMs?: number
  /** Milliseconds before a failed save is tried again on its own. */
  retryMs?: number
}

export interface Saver {
  getStatus(): SaveStatus
  subscribe(listener: () => void): () => void
  /** Reads the stored plan and starts saving every change. Call again after 'unreachable'. */
  start(): Promise<void>
  /** Saves now, without waiting for the debounce. */
  flush(): Promise<void>
  /** After a conflict: replace this plan with the stored one. Edits made here are dropped. */
  loadLatest(): Promise<void>
  /** After a conflict: save this plan over the stored one. */
  keepMine(): Promise<void>
  /** When nothing is waiting to be saved and someone else has saved a newer plan, loads it.
   *  True when it did. */
  pullNewer(): Promise<boolean>
  /** True while there are edits the storage does not have yet. */
  hasUnsaved(): boolean
}

export function createSaver(store: HistoryStore<Project, unknown>, options: SaverOptions): Saver {
  const { storage, starting } = options
  const debounceMs = options.debounceMs ?? 400
  const retryMs = options.retryMs ?? 10_000

  let status: SaveStatus = 'loading'
  const listeners = new Set<() => void>()
  let started = false
  /** The project and version the storage holds, as far as this window knows. */
  let lastSaved: Project | undefined
  let version: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  /** One save at a time: two at once would both build on the same version. */
  let inFlight: Promise<void> | null = null
  let again = false

  function setStatus(next: SaveStatus) {
    if (next === status) return
    status = next
    for (const listener of [...listeners]) listener()
  }

  /** True when saving should wait: for the planner's choice, or for the retry. */
  const stopped = () => status === 'conflict' || status === 'failed'

  function schedule(ms: number) {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, ms)
  }

  /** Takes a stored plan as what this window works on, without saving it back. */
  function adopt(saved: Saved) {
    lastSaved = saved.project
    version = saved.version
    store.load(saved.project)
  }

  async function saveOnce(): Promise<void> {
    const project = store.getState()
    if (project === lastSaved) {
      setStatus('saved')
      return
    }
    try {
      version = await storage.save(project, version)
      lastSaved = project
      // Something may have changed while the save was running.
      setStatus(store.getState() === project ? 'saved' : 'saving')
    } catch (error) {
      if (error instanceof PlanChangedElsewhere) {
        setStatus('conflict')
        return
      }
      console.warn('Could not save the plan.', error)
      setStatus('failed')
      if (storage.where === 'database') schedule(retryMs)
    }
  }

  async function flush(): Promise<void> {
    if (!started || status === 'conflict') return
    if (inFlight) {
      again = true
      return inFlight
    }
    inFlight = (async () => {
      do {
        again = false
        await saveOnce()
        // Read through a call: the save above may have changed it.
      } while (again && !stopped())
    })()
    try {
      await inFlight
    } finally {
      inFlight = null
    }
  }

  return {
    getStatus: () => status,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async start() {
      if (started) return
      setStatus('loading')
      let saved: Saved | null
      let carried: Project | null = null
      try {
        saved = await storage.load()
        if (!saved && storage.where === 'database') carried = (await options.leftInBrowser?.()) ?? null
      } catch (error) {
        console.warn('Could not read the saved plan.', error)
        setStatus('unreachable')
        return
      }
      started = true
      if (saved) {
        adopt(saved)
        setStatus('saved')
      } else {
        store.load(carried ?? starting())
        // Nothing is stored yet: what is shown becomes the stored plan. In the browser that
        // waits for the first edit, as it always has.
        setStatus(storage.where === 'database' ? 'saving' : 'saved')
        if (storage.where === 'database') void flush()
      }
      store.subscribe(() => {
        // Loading what is stored is no edit.
        if (store.getState() === lastSaved) return
        if (status !== 'conflict') setStatus('saving')
        schedule(debounceMs)
      })
    },

    flush,

    async loadLatest() {
      try {
        const saved = await storage.load()
        if (saved) {
          adopt(saved)
          setStatus('saved')
        } else {
          // Theirs is gone altogether: this plan takes its place.
          version = null
          setStatus('saving')
          await flush()
        }
      } catch (error) {
        console.warn('Could not read the saved plan.', error)
      }
    },

    async keepMine() {
      try {
        version = await storage.version()
      } catch (error) {
        console.warn('Could not read the saved plan.', error)
        return
      }
      setStatus('saving')
      await flush()
    },

    async pullNewer() {
      if (storage.where !== 'database' || status !== 'saved' || inFlight) return false
      try {
        if ((await storage.version()) === version) return false
        const saved = await storage.load()
        // Only when nothing was edited meanwhile: an edit is saved, or refused, instead.
        if (!saved || status !== 'saved' || store.getState() !== lastSaved) return false
        adopt(saved)
        return true
      } catch {
        return false
      }
    },

    hasUnsaved: () => started && store.getState() !== lastSaved,
  }
}
