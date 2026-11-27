// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '../../domain/conflicts'
import { floor, project, row, team } from '../../domain/testkit'
import type { Project } from '../../domain/types'
import { dispatch, getProject, projectStore, redo, undo } from '../../state/store'
import { ToastRegion } from '../primitives'
import { useConflictAlerts } from './useConflictAlerts'

/* The engine that finds issues is written by someone else at the same time. A stand-in
   with three plain rules is enough here: an area with more seats taken than it has, a day
   that needs more seats than the building has, and a team day without seats. */
vi.mock('../../domain/conflicts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../domain/conflicts')>()
  const { dayLoad, dayOccupancy } = await import('../../domain/model')
  const { WEEKDAYS, WEEKDAY_NAME } = await import('../../domain/types')

  const findIssues = (plan: Project): Issue[] => {
    const issues: Issue[] = []
    for (const day of WEEKDAYS) {
      for (const occupancy of dayOccupancy(plan, day).values()) {
        if (occupancy.free >= 0) continue
        issues.push({
          id: `area-over-capacity|${day}|${occupancy.floorId}|${occupancy.area.id}|-`,
          rule: 'area-over-capacity',
          severity: 'error',
          day,
          floorId: occupancy.floorId,
          areaId: occupancy.area.id,
          teamIds: occupancy.teams.map((held) => held.teamId),
          title: `${occupancy.area.name} is over capacity on ${WEEKDAY_NAME[day]}`,
          detail: '',
        })
      }
      const load = dayLoad(plan, day)
      if (load.needed > load.capacity.desks + load.capacity.overflow) {
        issues.push({
          id: `day-over-capacity|${day}|-|-|-`,
          rule: 'day-over-capacity',
          severity: 'error',
          day,
          floorId: null,
          areaId: null,
          teamIds: [],
          title: `${WEEKDAY_NAME[day]} does not fit in the building`,
          detail: '',
        })
      }
      for (const each of plan.teams) {
        if (!each.days.includes(day) || Object.keys(each.seating).length > 0) continue
        issues.push({
          id: `team-unseated|${day}|-|-|${each.id}`,
          rule: 'team-unseated',
          severity: 'todo',
          day,
          floorId: null,
          areaId: null,
          teamIds: [each.id],
          title: `${each.name} has no seats on ${WEEKDAY_NAME[day]}`,
          detail: '',
        })
      }
    }
    return issues
  }
  return { ...actual, findIssues }
})

function Harness() {
  useConflictAlerts()
  return <ToastRegion />
}

/** One floor with two areas of four desks. Alpha fills A1 on Tuesday; Beta is not seated. */
function onePlan(): Project {
  return project(
    [floor('g', row(['a1', 'a2'], 4))],
    [team('alpha', 4, ['tue'], { a1: 4 }), team('beta', 2, ['tue', 'thu'], { a2: 2 })],
  )
}

/** Starts the app's alerts on a freshly loaded plan. */
function start(plan: Project): void {
  projectStore.load(plan)
  render(<Harness />)
}

function alerts(): string[] {
  return screen.queryAllByText(/^This created/).map((element) => element.textContent ?? '')
}

function seatBetaInA1(seats = 2): void {
  act(() => dispatch({ type: 'seat/set', teamId: 'beta', areaId: 'a1', seats, scope: 'all' }))
}

afterEach(() => {
  // Toasts outlive a test, so take away what this one left behind.
  for (const button of screen.queryAllByRole('button', { name: 'Dismiss' })) fireEvent.click(button)
  cleanup()
})

describe('useConflictAlerts', () => {
  it('names the conflict an edit created and offers to undo the edit', () => {
    start(onePlan())
    const before = getProject()

    seatBetaInA1()

    expect(alerts()).toEqual(['This created a conflict: A1 is over capacity on Tuesday'])

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(getProject()).toBe(before)
  })

  it('counts the conflicts when an edit created several', () => {
    const plan = onePlan()
    start({ ...plan, teams: [team('alpha', 4, ['tue', 'thu'], { a1: 4 }), ...plan.teams.slice(1)] })

    seatBetaInA1()

    expect(alerts()).toEqual(['This created 2 conflicts'])
  })

  it('says nothing about a team that is still to seat', () => {
    start(onePlan())

    act(() => dispatch({ type: 'team/add', team: team('gamma', 3, ['wed']) }))

    expect(alerts()).toEqual([])
  })

  it('says nothing again while the same conflict stays', () => {
    start(onePlan())
    seatBetaInA1()

    seatBetaInA1(3)
    act(() => dispatch({ type: 'project/rename', name: 'Another name' }))

    expect(alerts()).toHaveLength(1)
  })

  it('says nothing when undo and redo pass a conflict again', () => {
    start(onePlan())
    seatBetaInA1()

    act(() => undo())
    act(() => redo())

    expect(alerts()).toHaveLength(1)
  })

  it('tells about a conflict that comes back through a new edit', () => {
    start(onePlan())
    seatBetaInA1()
    act(() => dispatch({ type: 'seat/set', teamId: 'beta', areaId: 'a1', seats: 0, scope: 'all' }))

    seatBetaInA1()

    expect(alerts()).toHaveLength(2)
  })

  it('says nothing when another plan with conflicts is swapped in', () => {
    start(onePlan())
    const other = project(
      [floor('h', row(['b1'], 2))],
      [team('gamma', 3, ['mon'], { b1: 3 })],
    )

    act(() => dispatch({ type: 'project/replace', project: other }))

    expect(getProject()).toBe(other)
    expect(alerts()).toEqual([])
  })

  it('says nothing about the plan it starts with, also when that is loaded later', () => {
    start(onePlan())

    // The saved plan arrives after the app has started. It may even share its floors with
    // what was there: it is still where the planner starts, not an edit.
    act(() => projectStore.load({ ...getProject(), teams: [team('alpha', 6, ['tue'], { a1: 6 })] }))

    expect(getProject().teams[0]?.seating).toEqual({ a1: 6 })
    expect(alerts()).toEqual([])
  })

  it('tells when removing a floor leaves a day with too few seats', () => {
    start(
      project(
        [floor('g', row(['a1'], 4)), floor('h', row(['b1'], 4))],
        [team('alpha', 6, ['tue'], { a1: 4, b1: 2 }), team('beta', 2, ['wed'], { a1: 2 })],
      ),
    )

    act(() => dispatch({ type: 'floor/remove', id: 'h' }))

    expect(alerts()).toEqual(['This created a conflict: Tuesday does not fit in the building'])
  })
})
