import { normalizeProject } from '../domain/files'
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
  /** After a conflict: replace this plan with the stored one. Edits made here are dropped.
   *  Rejects, changing nothing, when the stored plan cannot be read. */
  loadLatest(): Promise<void>
  /** After a conflict: save this plan over the stored one. Rejects, changing nothing,
   *  when the storage cannot be reached. */
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
  /** True while a stored plan is being taken over: that is no edit to save. */
  let adopting = false
  /** A save that failed without an answer: it may or may not have reached the storage. */
  let uncertain: { project: Project; over: number | null } | null = null

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
    uncertain = null
    adopting = true
    try {
      store.load(saved.project)
    } finally {
      adopting = false
    }
  }

  /** After a refused save: was it refused because an earlier save of ours did get through,
   *  only its answer was lost? Then that save is what is stored, and saving goes on from
   *  there instead of reporting a conflict with ourselves. */
  async function ownSaveLanded(): Promise<boolean> {
    if (!uncertain) return false
    const attempt = uncertain
    let stored: Saved | null
    try {
      stored = await storage.load()
    } catch {
      return false
    }
    if (!stored || stored.version !== (attempt.over ?? 0) + 1) return false
    if (canonical(stored.project) !== canonical(normalizeProject(attempt.project))) return false
    version = stored.version
    lastSaved = attempt.project
    uncertain = null
    return true
  }

  async function saveOnce(): Promise<void> {
    const project = store.getState()
    if (project === lastSaved) {
      setStatus('saved')
      return
    }
    const over = version
    try {
      version = await storage.save(project, over)
      lastSaved = project
      uncertain = null
      if (store.getState() === project) {
        setStatus('saved')
      } else {
        // Changed while the save was running, possibly back to what was stored before
        // (an undo): save again.
        setStatus('saving')
        again = true
      }
    } catch (error) {
      if (error instanceof PlanChangedElsewhere) {
        if (await ownSaveLanded()) {
          again = true
          return
        }
        setStatus('conflict')
        return
      }
      console.warn('Could not save the plan.', error)
      uncertain = { project, over }
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
        // Taking over what is stored is no edit. Anything else is, even an undo back to
        // the stored plan: the storage may hold a newer one by the time it is saved.
        if (adopting) return
        if (status !== 'conflict') setStatus('saving')
        schedule(debounceMs)
      })
    },

    flush,

    async loadLatest() {
      const saved = await storage.load()
      if (saved) {
        adopt(saved)
        setStatus('saved')
      } else {
        // Theirs is gone altogether: this plan takes its place.
        version = null
        lastSaved = undefined
        setStatus('saving')
        await flush()
      }
    },

    async keepMine() {
      version = await storage.version()
      uncertain = null
      // Whatever this window last saved, the storage now holds theirs: write this plan
      // even when it is the one saved before.
      lastSaved = undefined
      setStatus('saving')
      await flush()
    },

    async pullNewer() {
      if (storage.where !== 'database' || status !== 'saved' || inFlight) return false
      // This window's own saves move `version` on; an answer from before one of them is
      // no news from someone else.
      const at = version
      try {
        const stored = await storage.version()
        if (stored === at || version !== at) return false
        const saved = await storage.load()
        // Only when nothing was edited or saved meanwhile.
        if (!saved || version !== at || saved.version === at || inFlight) return false
        if (status !== 'saved' || store.getState() !== lastSaved) return false
        adopt(saved)
        return true
      } catch {
        return false
      }
    },

    hasUnsaved: () => started && store.getState() !== lastSaved,
  }
}

/** JSON with the keys of every object in order: the database does not keep key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  )
}
