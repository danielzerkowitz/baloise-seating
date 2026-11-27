import { afterEach, describe, expect, it, vi } from 'vitest'
import { reduce, type Action } from '../domain/reducer'
import { area, floor, project, team } from '../domain/testkit'
import type { Project } from '../domain/types'
import { createHistoryStore, type HistoryStoreConfig } from './createHistoryStore'

/* A tiny state to drive the store with. The state is an object, so that "the same state"
   can be told from "an equal state": history must hand back the very objects it was given. */

interface Counter {
  value: number
}

type CounterAction = { type: 'add'; by: number } | { type: 'set'; value: number } | { type: 'fail' }

function counterReducer(state: Counter, action: CounterAction): Counter {
  switch (action.type) {
    case 'add':
      return action.by === 0 ? state : { value: state.value + action.by }
    case 'set':
      return action.value === state.value ? state : { value: action.value }
    case 'fail':
      throw new Error('this action cannot be reduced')
  }
}

const start = (): Counter => ({ value: 0 })

function counterStore(config: HistoryStoreConfig = {}, initial: Counter = start()) {
  return createHistoryStore(counterReducer, initial, config)
}

/** A clock the test moves by hand. */
function fakeClock(time = 1000) {
  return {
    now: () => time,
    advance(ms: number) {
      time += ms
    },
  }
}

const add = (by = 1): CounterAction => ({ type: 'add', by })

describe('a new store', () => {
  it('holds the initial state, with nothing to undo or redo', () => {
    const initial = start()
    const store = counterStore({}, initial)
    expect(store.getState()).toBe(initial)
    expect(store.getSnapshot()).toEqual({ state: initial, canUndo: false, canRedo: false })
    expect(store.getSnapshot().state).toBe(initial)
  })

  it('does nothing on undo or redo, and tells nobody', () => {
    const initial = start()
    const store = counterStore({}, initial)
    const listener = vi.fn()
    store.subscribe(listener)
    const snapshot = store.getSnapshot()
    store.undo()
    store.redo()
    expect(store.getState()).toBe(initial)
    expect(store.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('dispatch', () => {
  it('replaces the state by what the reducer returns and makes it undoable', () => {
    const store = counterStore()
    store.dispatch(add(5))
    expect(store.getState()).toEqual({ value: 5 })
    expect(store.getSnapshot()).toEqual({ state: { value: 5 }, canUndo: true, canRedo: false })
    expect(store.getSnapshot().state).toBe(store.getState())
  })

  it('tells every subscriber once per change', () => {
    const store = counterStore()
    const first = vi.fn()
    const second = vi.fn()
    store.subscribe(first)
    store.subscribe(second)
    store.dispatch(add())
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    store.dispatch(add())
    expect(first).toHaveBeenCalledTimes(2)
  })

  it('has the new state ready when subscribers are told', () => {
    const store = counterStore()
    const seen: number[] = []
    store.subscribe(() => seen.push(store.getState().value, store.getSnapshot().state.value))
    store.dispatch(add(3))
    expect(seen).toEqual([3, 3])
  })

  it('makes no step and tells nobody when the reducer returns the same state', () => {
    const initial = start()
    const store = counterStore({}, initial)
    const listener = vi.fn()
    store.subscribe(listener)
    const snapshot = store.getSnapshot()

    store.dispatch(add(0))
    store.dispatch({ type: 'set', value: 0 })

    expect(store.getState()).toBe(initial)
    expect(store.getSnapshot()).toBe(snapshot)
    expect(store.getSnapshot().canUndo).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps what can be redone when an action changes nothing', () => {
    const store = counterStore()
    store.dispatch(add())
    store.undo()
    store.dispatch(add(0))
    expect(store.getSnapshot().canRedo).toBe(true)
    store.redo()
    expect(store.getState()).toEqual({ value: 1 })
  })

  it('stays as it was when the reducer throws', () => {
    const store = counterStore()
    store.dispatch(add())
    const listener = vi.fn()
    store.subscribe(listener)
    const snapshot = store.getSnapshot()
    expect(() => store.dispatch({ type: 'fail' })).toThrow('this action cannot be reduced')
    expect(store.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
    store.undo()
    expect(store.getState()).toEqual({ value: 0 })
  })
})

describe('undo and redo', () => {
  it('hand back the very state objects, not copies', () => {
    const initial = start()
    const store = counterStore({}, initial)
    store.dispatch(add())
    const one = store.getState()
    store.dispatch(add())
    const two = store.getState()

    store.undo()
    expect(store.getState()).toBe(one)
    store.undo()
    expect(store.getState()).toBe(initial)
    store.redo()
    expect(store.getState()).toBe(one)
    store.redo()
    expect(store.getState()).toBe(two)
  })

  it('know at every point whether there is something to undo or redo', () => {
    const store = counterStore()
    const flags = () => {
      const { canUndo, canRedo } = store.getSnapshot()
      return { canUndo, canRedo }
    }
    store.dispatch(add())
    store.dispatch(add())
    expect(flags()).toEqual({ canUndo: true, canRedo: false })
    store.undo()
    expect(flags()).toEqual({ canUndo: true, canRedo: true })
    store.undo()
    expect(flags()).toEqual({ canUndo: false, canRedo: true })
    store.redo()
    expect(flags()).toEqual({ canUndo: true, canRedo: true })
    store.redo()
    expect(flags()).toEqual({ canUndo: true, canRedo: false })
  })

  it('walk through a long history in order, there and back', () => {
    const store = counterStore()
    for (let i = 1; i <= 10; i += 1) store.dispatch({ type: 'set', value: i })
    const back: number[] = []
    while (store.getSnapshot().canUndo) {
      store.undo()
      back.push(store.getState().value)
    }
    expect(back).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    const forth: number[] = []
    while (store.getSnapshot().canRedo) {
      store.redo()
      forth.push(store.getState().value)
    }
    expect(forth).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('tell subscribers, once per step', () => {
    const store = counterStore()
    store.dispatch(add())
    const listener = vi.fn()
    store.subscribe(listener)
    store.undo()
    expect(listener).toHaveBeenCalledTimes(1)
    store.redo()
    expect(listener).toHaveBeenCalledTimes(2)
    // Nothing left to redo: nobody is told.
    store.redo()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('forget what could be redone as soon as a new action changes the state', () => {
    const store = counterStore()
    store.dispatch(add(1))
    store.dispatch(add(1))
    store.undo()
    store.undo()
    store.dispatch(add(10))
    expect(store.getSnapshot()).toEqual({ state: { value: 10 }, canUndo: true, canRedo: false })
    store.redo()
    expect(store.getState()).toEqual({ value: 10 })
    store.undo()
    expect(store.getState()).toEqual({ value: 0 })
  })
})

describe('the snapshot', () => {
  it('is the same object until something changes', () => {
    const store = counterStore()
    const first = store.getSnapshot()
    expect(store.getSnapshot()).toBe(first)
    store.dispatch(add(0))
    store.getState()
    expect(store.getSnapshot()).toBe(first)
  })

  it('is a new object after every change, and then stays the same again', () => {
    const store = counterStore()
    const seen = new Set([store.getSnapshot()])
    const changes = [
      () => store.dispatch(add()),
      () => store.dispatch(add()),
      () => store.undo(),
      () => store.redo(),
      () => store.load(start()),
    ]
    for (const change of changes) {
      change()
      const snapshot = store.getSnapshot()
      expect(seen.has(snapshot)).toBe(false)
      expect(store.getSnapshot()).toBe(snapshot)
      seen.add(snapshot)
    }
  })

  it('is not changed afterwards: an old snapshot keeps showing the old state', () => {
    const store = counterStore()
    const before = store.getSnapshot()
    store.dispatch(add())
    expect(before).toEqual({ state: { value: 0 }, canUndo: false, canRedo: false })
  })
})

describe('subscribe', () => {
  it('stops telling a subscriber that has unsubscribed', () => {
    const store = counterStore()
    const staying = vi.fn()
    const leaving = vi.fn()
    store.subscribe(staying)
    const unsubscribe = store.subscribe(leaving)
    store.dispatch(add())
    unsubscribe()
    store.dispatch(add())
    expect(staying).toHaveBeenCalledTimes(2)
    expect(leaving).toHaveBeenCalledTimes(1)
    // Unsubscribing twice is harmless.
    unsubscribe()
    store.dispatch(add())
    expect(staying).toHaveBeenCalledTimes(3)
  })

  it('still tells the others when a subscriber unsubscribes while being told', () => {
    const store = counterStore()
    const calls: string[] = []
    const unsubscribeFirst = store.subscribe(() => {
      calls.push('first')
      unsubscribeFirst()
    })
    store.subscribe(() => calls.push('second'))
    store.dispatch(add())
    store.dispatch(add())
    expect(calls).toEqual(['first', 'second', 'second'])
  })
})

describe('coalescing', () => {
  const typing = { coalesce: 'name' }

  it('merges dispatches with the same key within the time window into one undo step', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    store.dispatch(add(), typing)
    clock.advance(300)
    store.dispatch(add(), typing)
    clock.advance(300)
    store.dispatch(add(), typing)
    expect(store.getState()).toEqual({ value: 3 })
    store.undo()
    expect(store.getState()).toEqual({ value: 0 })
    expect(store.getSnapshot().canUndo).toBe(false)
    // Redo brings the whole burst back.
    store.redo()
    expect(store.getState()).toEqual({ value: 3 })
  })

  it('still tells subscribers about every merged dispatch', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    const listener = vi.fn()
    store.subscribe(listener)
    store.dispatch(add(), typing)
    store.dispatch(add(), typing)
    store.dispatch(add(), typing)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('merges up to the end of the window and no later', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    store.dispatch(add(), typing)
    clock.advance(1000)
    store.dispatch(add(), typing)
    store.undo()
    expect(store.getState()).toEqual({ value: 0 })

    store.dispatch(add(), typing)
    clock.advance(1001)
    store.dispatch(add(), typing)
    store.undo()
    expect(store.getState()).toEqual({ value: 1 })
  })

  it('measures the window from the last dispatch, so a steady burst stays one step', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    for (let i = 0; i < 10; i += 1) {
      store.dispatch(add(), typing)
      clock.advance(800)
    }
    store.undo()
    expect(store.getState()).toEqual({ value: 0 })
  })

  it('does not merge different keys', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    store.dispatch(add(), { coalesce: 'name' })
    store.dispatch(add(), { coalesce: 'notes' })
    store.dispatch(add(), { coalesce: 'name' })
    store.undo()
    expect(store.getState()).toEqual({ value: 2 })
    store.undo()
    expect(store.getState()).toEqual({ value: 1 })
    store.undo()
    expect(store.getState()).toEqual({ value: 0 })
  })

  it('does not merge with or across a dispatch without a key', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    store.dispatch(add())
    store.dispatch(add())
    store.undo()
    expect(store.getState()).toEqual({ value: 1 })

    store.dispatch(add(), typing)
    store.dispatch(add())
    store.dispatch(add(), typing)
    store.undo()
    expect(store.getState()).toEqual({ value: 3 })
    store.undo()
    expect(store.getState()).toEqual({ value: 2 })
  })

  it('does not merge with an empty options object', () => {
    const store = counterStore({ now: fakeClock().now })
    store.dispatch(add(), {})
    store.dispatch(add(), {})
    store.undo()
    expect(store.getState()).toEqual({ value: 1 })
  })

  it('never merges across an undo', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    store.dispatch(add())
    store.dispatch(add(), typing)
    store.dispatch(add(), typing)
    store.undo()
    // Back at 1, the state before the burst. Typing on within the window starts a new step:
    // merged into the burst that was undone, it would wipe the restored state from history.
    const restored = store.getState()
    expect(restored).toEqual({ value: 1 })
    store.dispatch(add(10), typing)
    expect(store.getSnapshot()).toEqual({ state: { value: 11 }, canUndo: true, canRedo: false })
    store.undo()
    expect(store.getState()).toBe(restored)
    store.undo()
    expect(store.getState()).toEqual({ value: 0 })
  })

  it('never merges across an undo when the burst was the first thing that happened', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    store.dispatch(add(), typing)
    store.dispatch(add(), typing)
    store.undo()
    store.dispatch(add(10), typing)
    expect(store.getSnapshot()).toEqual({ state: { value: 10 }, canUndo: true, canRedo: false })
    store.undo()
    expect(store.getState()).toEqual({ value: 0 })
  })

  it('never merges across a redo', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    store.dispatch(add())
    store.dispatch(add(), typing)
    store.undo()
    store.redo()
    const redone = store.getState()
    expect(redone).toEqual({ value: 2 })
    store.dispatch(add(10), typing)
    store.undo()
    expect(store.getState()).toBe(redone)
    store.undo()
    expect(store.getState()).toEqual({ value: 1 })
  })

  it('never merges into a state that was loaded', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    store.dispatch(add(), typing)
    const loaded = { value: 100 }
    store.load(loaded)
    store.dispatch(add(), typing)
    store.dispatch(add(), typing)
    expect(store.getState()).toEqual({ value: 102 })
    store.undo()
    expect(store.getState()).toBe(loaded)
    expect(store.getSnapshot().canUndo).toBe(false)
  })

  it('is not broken by a dispatch in between that changes nothing', () => {
    const clock = fakeClock()
    const store = counterStore({ now: clock.now, coalesceMs: 1000 })
    store.dispatch(add(), typing)
    store.dispatch(add(0), typing)
    store.dispatch(add(), typing)
    store.undo()
    expect(store.getState()).toEqual({ value: 0 })
  })

  describe('without a clock or a window given', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('uses the time of day and a window of 1.2 seconds', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-27T09:00:00Z'))
      const store = counterStore()
      store.dispatch(add(), typing)
      vi.advanceTimersByTime(1200)
      store.dispatch(add(), typing)
      vi.advanceTimersByTime(1201)
      store.dispatch(add(), typing)
      expect(store.getState()).toEqual({ value: 3 })
      store.undo()
      expect(store.getState()).toEqual({ value: 2 })
      store.undo()
      expect(store.getState()).toEqual({ value: 0 })
    })
  })
})

describe('the limit', () => {
  const undoAll = (store: ReturnType<typeof counterStore>): number[] => {
    const visited: number[] = []
    while (store.getSnapshot().canUndo) {
      store.undo()
      visited.push(store.getState().value)
    }
    return visited
  }

  it('keeps the newest steps and drops the oldest', () => {
    const store = counterStore({ limit: 3 })
    for (let i = 1; i <= 5; i += 1) store.dispatch({ type: 'set', value: i })
    expect(undoAll(store)).toEqual([4, 3, 2])
    // Everything that was undone can still be redone.
    store.redo()
    store.redo()
    store.redo()
    expect(store.getState()).toEqual({ value: 5 })
    expect(store.getSnapshot().canRedo).toBe(false)
  })

  it('keeps exactly as many steps as the limit says, also for a limit of one', () => {
    const one = counterStore({ limit: 1 })
    for (let i = 1; i <= 4; i += 1) one.dispatch({ type: 'set', value: i })
    expect(undoAll(one)).toEqual([3])

    const two = counterStore({ limit: 2 })
    two.dispatch({ type: 'set', value: 1 })
    expect(undoAll(two)).toEqual([0])
  })

  it('keeps no steps at all with a limit of zero', () => {
    const store = counterStore({ limit: 0 })
    store.dispatch(add())
    store.dispatch(add())
    expect(store.getSnapshot()).toEqual({ state: { value: 2 }, canUndo: false, canRedo: false })
    store.undo()
    expect(store.getState()).toEqual({ value: 2 })
  })

  it('is 200 steps unless told otherwise', () => {
    const store = counterStore()
    for (let i = 1; i <= 250; i += 1) store.dispatch({ type: 'set', value: i })
    const visited = undoAll(store)
    expect(visited).toHaveLength(200)
    expect(visited[visited.length - 1]).toBe(50)
  })

  it('does not count merged dispatches as steps', () => {
    const clock = fakeClock()
    const store = counterStore({ limit: 2, now: clock.now, coalesceMs: 1000 })
    store.dispatch({ type: 'set', value: 1 })
    for (let i = 0; i < 10; i += 1) store.dispatch(add(), { coalesce: 'burst' })
    expect(undoAll(store)).toEqual([1, 0])
  })
})

describe('load', () => {
  it('replaces the state and forgets all history', () => {
    const store = counterStore()
    store.dispatch(add())
    store.dispatch(add())
    store.undo()
    expect(store.getSnapshot()).toMatchObject({ canUndo: true, canRedo: true })

    const loaded = { value: 42 }
    store.load(loaded)
    expect(store.getState()).toBe(loaded)
    expect(store.getSnapshot()).toEqual({ state: loaded, canUndo: false, canRedo: false })
    store.undo()
    store.redo()
    expect(store.getState()).toBe(loaded)
  })

  it('tells subscribers', () => {
    const store = counterStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.load({ value: 42 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh history from the loaded state', () => {
    const store = counterStore()
    const loaded = { value: 42 }
    store.load(loaded)
    store.dispatch(add())
    expect(store.getSnapshot().canUndo).toBe(true)
    store.undo()
    expect(store.getState()).toBe(loaded)
    expect(store.getSnapshot().canUndo).toBe(false)
  })
})

describe('with the project reducer', () => {
  const building = (): Project =>
    project(
      [floor('1', [area('a1', 4), area('room', 6, { kind: 'no-seating' })])],
      [team('alpha', 4, ['tue'])],
    )
  const seat = (areaId: string, seats: number): Action => ({ type: 'seat/set', teamId: 'alpha', areaId, seats, scope: 'all' })

  it('makes no undo step for an action that changes nothing', () => {
    const initial = building()
    const store = createHistoryStore(reduce, initial)
    const listener = vi.fn()
    store.subscribe(listener)

    store.dispatch(seat('room', 2)) // refused: a room
    store.dispatch(seat('ghost', 2)) // no such area
    store.dispatch({ type: 'team/setPlanned', id: 'alpha', day: 'tue', planned: true }) // already planned
    store.dispatch({ type: 'batch', actions: [] })

    expect(store.getState()).toBe(initial)
    expect(store.getSnapshot().canUndo).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('undoes an edit back to the very project it started from', () => {
    const initial = building()
    const store = createHistoryStore(reduce, initial)
    store.dispatch(seat('a1', 4))
    const seated = store.getState()
    expect(seated.teams[0]?.seating).toEqual({ a1: 4 })

    store.undo()
    expect(store.getState()).toBe(initial)
    store.redo()
    expect(store.getState()).toBe(seated)
  })

  it('undoes a batch as one step', () => {
    const initial = building()
    const store = createHistoryStore(reduce, initial)
    store.dispatch({ type: 'batch', actions: [seat('a1', 2), { type: 'team/setPlanned', id: 'alpha', day: 'thu', planned: true }] })
    expect(store.getState().teams[0]).toMatchObject({ days: ['tue', 'thu'], seating: { a1: 2 } })
    store.undo()
    expect(store.getState()).toBe(initial)
    expect(store.getSnapshot().canUndo).toBe(false)
  })
})
