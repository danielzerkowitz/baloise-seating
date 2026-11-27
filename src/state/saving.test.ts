import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reduce, type Action } from '../domain/reducer'
import type { Project } from '../domain/types'
import { createHistoryStore } from './createHistoryStore'
import { createSaver, type Saver } from './saving'
import { startingProject } from './seed'
import { databaseStorage, type PlanRows, type PlanStorage } from './storage'

/** The plans table, in memory. `down` makes every call fail as if offline. */
function memoryRows() {
  const table = new Map<string, { data: unknown; version: number }>()
  const rows = {
    table,
    down: false,
    calls: 0,
    check() {
      rows.calls += 1
      if (rows.down) throw new Error('offline')
    },
    async read(id: string) {
      rows.check()
      const row = table.get(id)
      return row ? { data: structuredClone(row.data), version: row.version } : null
    },
    async readVersion(id: string) {
      rows.check()
      return table.get(id)?.version ?? null
    },
    async insert(id: string, data: Project) {
      rows.check()
      if (table.has(id)) return false
      table.set(id, { data: structuredClone(data), version: 1 })
      return true
    },
    async update(id: string, data: Project, from: number, to: number) {
      rows.check()
      const row = table.get(id)
      if (!row || row.version !== from) return false
      table.set(id, { data: structuredClone(data), version: to })
      return true
    },
  } satisfies PlanRows & Record<string, unknown>
  return rows
}

function newStore() {
  return createHistoryStore<Project, Action>(reduce, startingProject())
}

/** One window of the app on the shared database. */
function openWindow(rows: PlanRows, leftInBrowser?: Project) {
  const store = newStore()
  const storage = databaseStorage(rows, 'main')
  const saver = createSaver(store, {
    storage,
    starting: startingProject,
    leftInBrowser: async () => leftInBrowser ?? null,
    debounceMs: 10,
    retryMs: 50,
  })
  return { store, saver }
}

const rename = (name: string): Action => ({ type: 'project/rename', name })

/** Lets the debounce run out and every save finish. */
async function settle(saver: Saver) {
  await vi.advanceTimersByTimeAsync(20)
  await saver.flush()
}

function storedName(rows: ReturnType<typeof memoryRows>): string | undefined {
  return (rows.table.get('main')?.data as Project | undefined)?.name
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('saving to the database', () => {
  it('fills an empty database with the starting plan', async () => {
    const rows = memoryRows()
    const { saver } = openWindow(rows)

    await saver.start()
    await settle(saver)

    expect(rows.table.get('main')?.version).toBe(1)
    expect(storedName(rows)).toBe('Office plan')
    expect(saver.getStatus()).toBe('saved')
  })

  it('carries a plan left in this browser into an empty database', async () => {
    const rows = memoryRows()
    const { saver, store } = openWindow(rows, { ...startingProject(), name: 'From the browser' })

    await saver.start()
    await settle(saver)

    expect(store.getState().name).toBe('From the browser')
    expect(storedName(rows)).toBe('From the browser')
  })

  it('opens the stored plan and saves every edit as the next version', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: { ...startingProject(), name: 'Stored' }, version: 4 })
    const { saver, store } = openWindow(rows)

    await saver.start()
    expect(store.getState().name).toBe('Stored')
    expect(saver.getStatus()).toBe('saved')

    store.dispatch(rename('Edited'))
    expect(saver.getStatus()).toBe('saving')
    await settle(saver)

    expect(rows.table.get('main')).toMatchObject({ version: 5 })
    expect(storedName(rows)).toBe('Edited')
    expect(saver.getStatus()).toBe('saved')
  })

  it('saves a burst of edits once', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: startingProject(), version: 1 })
    const { saver, store } = openWindow(rows)
    await saver.start()

    store.dispatch(rename('A'))
    store.dispatch(rename('AB'))
    store.dispatch(rename('ABC'))
    await settle(saver)

    expect(rows.table.get('main')?.version).toBe(2)
    expect(storedName(rows)).toBe('ABC')
  })

  it('shows nothing and saves nothing when the database cannot be reached at the start', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: { ...startingProject(), name: 'Real plan' }, version: 3 })
    rows.down = true
    const { saver, store } = openWindow(rows)

    await saver.start()
    store.dispatch(rename('Edited before opening'))
    await settle(saver)

    expect(saver.getStatus()).toBe('unreachable')
    expect(storedName(rows)).toBe('Real plan')

    rows.down = false
    await saver.start()
    expect(saver.getStatus()).toBe('saved')
    expect(store.getState().name).toBe('Real plan')
  })

  it('keeps the edits when a save fails and tries again on its own', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: startingProject(), version: 1 })
    const { saver, store } = openWindow(rows)
    await saver.start()

    rows.down = true
    store.dispatch(rename('Offline edit'))
    await settle(saver)
    expect(saver.getStatus()).toBe('failed')
    expect(saver.hasUnsaved()).toBe(true)

    rows.down = false
    await vi.advanceTimersByTimeAsync(60)
    await saver.flush()

    expect(saver.getStatus()).toBe('saved')
    expect(storedName(rows)).toBe('Offline edit')
    expect(saver.hasUnsaved()).toBe(false)
  })

  it('never has two saves on their way at once', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: startingProject(), version: 1 })
    let open = 0
    let most = 0
    const update = rows.update
    rows.update = async (...args) => {
      open += 1
      most = Math.max(most, open)
      await new Promise((resolve) => setTimeout(resolve, 30))
      open -= 1
      return update(...args)
    }
    const { saver, store } = openWindow(rows)
    await saver.start()

    store.dispatch(rename('One'))
    await vi.advanceTimersByTimeAsync(15)
    store.dispatch(rename('Two'))
    await vi.advanceTimersByTimeAsync(15)
    store.dispatch(rename('Three'))
    await vi.advanceTimersByTimeAsync(200)
    await saver.flush()

    expect(most).toBe(1)
    expect(saver.getStatus()).toBe('saved')
    expect(storedName(rows)).toBe('Three')
  })
})

describe('two windows on the same plan', () => {
  async function twoWindows() {
    const rows = memoryRows()
    rows.table.set('main', { data: startingProject(), version: 1 })
    const a = openWindow(rows)
    const b = openWindow(rows)
    await a.saver.start()
    await b.saver.start()
    return { rows, a, b }
  }

  it('refuses a save that would overwrite the other window, and saves nothing until the planner chooses', async () => {
    const { rows, a, b } = await twoWindows()

    a.store.dispatch(rename('From A'))
    await settle(a.saver)
    b.store.dispatch(rename('From B'))
    await settle(b.saver)

    expect(b.saver.getStatus()).toBe('conflict')
    expect(storedName(rows)).toBe('From A')

    b.store.dispatch(rename('From B, again'))
    await settle(b.saver)
    expect(b.saver.getStatus()).toBe('conflict')
    expect(storedName(rows)).toBe('From A')
  })

  it('"Load theirs" takes the stored plan and goes on saving from there', async () => {
    const { rows, a, b } = await twoWindows()
    a.store.dispatch(rename('From A'))
    await settle(a.saver)
    b.store.dispatch(rename('From B'))
    await settle(b.saver)

    await b.saver.loadLatest()
    expect(b.saver.getStatus()).toBe('saved')
    expect(b.store.getState().name).toBe('From A')

    b.store.dispatch(rename('From B after loading'))
    await settle(b.saver)
    expect(b.saver.getStatus()).toBe('saved')
    expect(storedName(rows)).toBe('From B after loading')
    expect(rows.table.get('main')?.version).toBe(3)
  })

  it('"Keep mine" saves over the other window', async () => {
    const { rows, a, b } = await twoWindows()
    a.store.dispatch(rename('From A'))
    await settle(a.saver)
    b.store.dispatch(rename('From B'))
    await settle(b.saver)

    await b.saver.keepMine()

    expect(b.saver.getStatus()).toBe('saved')
    expect(storedName(rows)).toBe('From B')
    // Now the other window is the one that is behind.
    a.store.dispatch(rename('From A, again'))
    await settle(a.saver)
    expect(a.saver.getStatus()).toBe('conflict')
  })

  it('picks up what the other window saved when nothing is waiting to be saved', async () => {
    const { a, b } = await twoWindows()
    a.store.dispatch(rename('From A'))
    await settle(a.saver)

    expect(await b.saver.pullNewer()).toBe(true)
    expect(b.store.getState().name).toBe('From A')
    // Loading is no edit: nothing to save.
    await settle(b.saver)
    expect(b.saver.getStatus()).toBe('saved')
    expect(await b.saver.pullNewer()).toBe(false)
  })

  it('does not pull over edits that are still on their way', async () => {
    const { a, b } = await twoWindows()
    a.store.dispatch(rename('From A'))
    await settle(a.saver)

    b.store.dispatch(rename('From B'))
    expect(await b.saver.pullNewer()).toBe(false)
    expect(b.store.getState().name).toBe('From B')
  })
})

describe('the stored plan is untrusted', () => {
  it('is repaired on the way in, like a file', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: { ...startingProject(), name: 42, extra: 'ignored' }, version: 1 })
    const storage: PlanStorage = databaseStorage(rows, 'main')

    const saved = await storage.load()

    expect(saved?.project.name).toBe('Office plan')
    expect(saved?.project).not.toHaveProperty('extra')
  })

  it('cannot be opened when it is not a plan at all', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: 'nonsense', version: 1 })
    const { saver } = openWindow(rows)

    await saver.start()

    expect(saver.getStatus()).toBe('unreachable')
  })
})

describe('found in review', () => {
  /** Makes the next update wait until `release()` is called. */
  function holdNextUpdate(rows: ReturnType<typeof memoryRows>) {
    const update = rows.update
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    rows.update = async (...args) => {
      rows.update = update
      await held
      return update(...args)
    }
    return () => release()
  }

  it('saves an undo made while the edit it undoes was being saved', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: { ...startingProject(), name: 'Before' }, version: 1 })
    const { saver, store } = openWindow(rows)
    await saver.start()

    const release = holdNextUpdate(rows)
    store.dispatch(rename('Edit'))
    await vi.advanceTimersByTimeAsync(20)
    store.undo()
    release()
    // Only timers, as in the app: nothing else would call flush().
    await vi.advanceTimersByTimeAsync(200)

    expect(store.getState().name).toBe('Before')
    expect(storedName(rows)).toBe('Before')
    expect(saver.getStatus()).toBe('saved')
    expect(saver.hasUnsaved()).toBe(false)
  })

  it('"Keep mine" writes the plan even when it was undone back to the one saved before', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: { ...startingProject(), name: 'Mine' }, version: 1 })
    const a = openWindow(rows)
    const b = openWindow(rows)
    await a.saver.start()
    await b.saver.start()
    a.store.dispatch(rename('Theirs'))
    await settle(a.saver)
    b.store.dispatch(rename('Mine, edited'))
    await settle(b.saver)
    expect(b.saver.getStatus()).toBe('conflict')

    b.store.undo()
    await b.saver.keepMine()

    expect(storedName(rows)).toBe('Mine')
    expect(b.saver.getStatus()).toBe('saved')
  })

  it('takes a save whose answer was lost, but that did get through, for its own and not for a conflict', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: startingProject(), version: 1 })
    const { saver, store } = openWindow(rows)
    await saver.start()
    const update = rows.update
    rows.update = async (...args) => {
      rows.update = update
      await update(...args)
      throw new Error('Failed to fetch')
    }

    store.dispatch(rename('Landed'))
    await settle(saver)
    expect(saver.getStatus()).toBe('failed')
    store.dispatch(rename('Landed, then more'))
    await vi.advanceTimersByTimeAsync(60)
    await saver.flush()

    expect(saver.getStatus()).toBe('saved')
    expect(storedName(rows)).toBe('Landed, then more')
    expect(rows.table.get('main')?.version).toBe(3)
  })

  it('still reports a conflict when the lost save did not get through and someone else saved', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: startingProject(), version: 1 })
    const a = openWindow(rows)
    const b = openWindow(rows)
    await a.saver.start()
    await b.saver.start()
    rows.down = true
    b.store.dispatch(rename('Lost'))
    await settle(b.saver)
    rows.down = false
    a.store.dispatch(rename('Theirs'))
    await settle(a.saver)

    await vi.advanceTimersByTimeAsync(60)
    await b.saver.flush()

    expect(b.saver.getStatus()).toBe('conflict')
    expect(storedName(rows)).toBe('Theirs')
  })

  it('"Load theirs" says so, and changes nothing, when theirs cannot be read', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: startingProject(), version: 1 })
    const { saver, store } = openWindow(rows)
    await saver.start()
    rows.table.set('main', { data: { ...startingProject(), schemaVersion: 999 }, version: 2 })
    store.dispatch(rename('Mine'))
    await settle(saver)
    expect(saver.getStatus()).toBe('conflict')

    await expect(saver.loadLatest()).rejects.toThrow()

    expect(saver.getStatus()).toBe('conflict')
    expect(store.getState().name).toBe('Mine')
  })

  it('does not take its own save for news from someone else', async () => {
    const rows = memoryRows()
    rows.table.set('main', { data: startingProject(), version: 1 })
    const { saver, store } = openWindow(rows)
    await saver.start()
    // The version is asked for, and answered, before this window's save lands.
    const readVersion = rows.readVersion
    let answer = () => {}
    rows.readVersion = async (id) => {
      const stale = await readVersion(id)
      await new Promise<void>((resolve) => (answer = resolve))
      return stale
    }

    const pulled = saver.pullNewer()
    await vi.advanceTimersByTimeAsync(0)
    store.dispatch(rename('Own save'))
    await settle(saver)
    answer()

    expect(await pulled).toBe(false)
    expect(store.getState().name).toBe('Own save')
    rows.readVersion = readVersion
  })
})
