/** A small external store with undo and redo, made for `useSyncExternalStore`.
 *
 *  The state is replaced, never mutated, so history entries share structure and a step
 *  costs almost nothing. A reducer that returns the same reference is a no-op: nothing is
 *  recorded and nobody is notified. */

export interface Snapshot<S> {
  state: S
  canUndo: boolean
  canRedo: boolean
}

export interface DispatchOptions {
  /** Consecutive dispatches with the same key within `coalesceMs` become ONE undo step
   *  (typing in a field, nudging with arrow keys). */
  coalesce?: string
}

export interface HistoryStore<S, A> {
  getSnapshot(): Snapshot<S>
  getState(): S
  subscribe(listener: () => void): () => void
  dispatch(action: A, options?: DispatchOptions): void
  undo(): void
  redo(): void
  /** Replaces the state and forgets all history (first load, opening a file). */
  load(state: S): void
}

export interface HistoryStoreConfig {
  /** Maximum number of undo steps kept. */
  limit?: number
  coalesceMs?: number
  now?: () => number
}

export function createHistoryStore<S, A>(
  reducer: (state: S, action: A) => S,
  initial: S,
  config: HistoryStoreConfig = {},
): HistoryStore<S, A> {
  const limit = config.limit ?? 200
  const coalesceMs = config.coalesceMs ?? 1200
  const now = config.now ?? (() => Date.now())

  let present = initial
  let past: S[] = []
  let future: S[] = []
  let lastKey: string | undefined
  let lastAt = 0
  let snapshot: Snapshot<S> = { state: present, canUndo: false, canRedo: false }
  const listeners = new Set<() => void>()

  function publish() {
    snapshot = { state: present, canUndo: past.length > 0, canRedo: future.length > 0 }
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => snapshot,
    getState: () => present,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    dispatch(action, options) {
      const next = reducer(present, action)
      if (next === present) return
      const t = now()
      const key = options?.coalesce
      const merges = key !== undefined && key === lastKey && t - lastAt <= coalesceMs && past.length > 0
      if (!merges) {
        // Keep the newest `limit` steps; with a limit of zero that is none at all.
        const steps = [...past, present]
        past = steps.length > limit ? steps.slice(steps.length - limit) : steps
      }
      present = next
      future = []
      lastKey = key
      lastAt = t
      publish()
    },

    undo() {
      const previous = past[past.length - 1]
      if (previous === undefined) return
      past = past.slice(0, -1)
      future = [present, ...future]
      present = previous
      lastKey = undefined
      publish()
    },

    redo() {
      const next = future[0]
      if (next === undefined) return
      future = future.slice(1)
      past = [...past, present]
      present = next
      lastKey = undefined
      publish()
    },

    load(state) {
      present = state
      past = []
      future = []
      lastKey = undefined
      publish()
    },
  }
}
