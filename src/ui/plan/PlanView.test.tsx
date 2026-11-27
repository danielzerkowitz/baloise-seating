// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autoSeat } from '../../domain/autoseat'
import { findIssues, type Issue } from '../../domain/conflicts'
import { reduce } from '../../domain/reducer'
import type { Project, Team } from '../../domain/types'
import { exampleTeams, startingProject } from '../../state/seed'
import { dispatch, getProject, projectStore } from '../../state/store'
import { getUi, resetUi, setUi } from '../../state/ui'
import { ToastRegion } from '../primitives'
import { TEAM_DRAG_TYPE } from '../sheet/SeatingSheet'
import { PlanView } from './PlanView'

// The two engines and the conflict list are other parts of the app. The view is tested
// against fixed results of them, so these tests say the same whatever those parts do.
vi.mock('../../domain/autoseat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../domain/autoseat')>()),
  autoSeat: vi.fn(),
}))
vi.mock('../../domain/conflicts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../domain/conflicts')>()),
  findIssues: vi.fn(),
}))
vi.mock('../conflicts/ConflictList', () => ({ ConflictList: () => null }))

function renderPlan() {
  return render(
    <>
      <PlanView />
      <ToastRegion />
    </>,
  )
}

function addExampleTeams() {
  dispatch({ type: 'team/addMany', teams: exampleTeams(getProject()) })
}

function teamNamed(name: string): Team {
  const team = getProject().teams.find((t) => t.name === name)
  if (!team) throw new Error(`There is no team named ${name}`)
  return team
}

/** A team's row in the tray; its accessible name starts with the team's name. */
function teamRow(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${name},`) })
}

/** An area on the plan; its accessible name starts with the area's name. */
function areaOnPlan(name: string): HTMLElement {
  return within(screen.getByRole('region', { name: 'Plan' })).getByRole('button', { name: new RegExp(`^${name}:`) })
}

function dayButton(weekday: string): HTMLElement {
  return within(screen.getByRole('group', { name: 'Day' })).getByRole('button', { name: new RegExp(`^${weekday}:`) })
}

function placingBar(teamName: string): HTMLElement {
  return screen.getByRole('group', { name: `Seating ${teamName}` })
}

function newestToast(): HTMLElement {
  const toasts = document.querySelectorAll<HTMLElement>('.toast')
  const newest = toasts[toasts.length - 1]
  if (!newest) throw new Error('No toast is shown')
  return newest
}

beforeEach(() => {
  vi.mocked(findIssues).mockReset().mockReturnValue([])
  // Like the engine when it has nothing to propose: the same project, no outcomes.
  vi.mocked(autoSeat)
    .mockReset()
    .mockImplementation((project) => ({ project, outcomes: [] }))
  projectStore.load(startingProject())
  resetUi()
})

afterEach(() => {
  // Toasts live outside the view and outlast it: dismiss them so no test sees another's.
  for (const button of screen.queryAllByRole('button', { name: 'Dismiss' })) fireEvent.click(button)
  cleanup()
})

describe('PlanView without teams', () => {
  it('shows the week, the floor and an invitation to add teams', () => {
    renderPlan()

    expect(screen.getByText('No teams yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add teams' })).toBeTruthy()
    expect(dayButton('Monday').getAttribute('aria-pressed')).toBe('true')
    expect(dayButton('Friday').getAttribute('aria-pressed')).toBe('false')
    expect(dayButton('Monday').getAttribute('aria-label')).toBe('Monday: 0 seats needed, 66 desks, 66 free')
    const floorButton = screen.getByRole('button', { name: 'Floor 4, 0 of 66 desks taken on Monday' })
    expect(floorButton.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('0 teams, 0 seats needed')).toBeTruthy()
    expect(screen.queryByRole('group', { name: /^Seating / })).toBeNull()
  })

  it('adds the example teams', () => {
    renderPlan()
    fireEvent.click(screen.getByRole('button', { name: 'Try with example teams' }))

    expect(getProject().teams).toHaveLength(10)
    expect(screen.queryByText('No teams yet')).toBeNull()
    // The button is gone; the focus continues at the first team to seat.
    expect(document.activeElement).toBe(teamRow('Policy Admin'))
  })

  it('goes to the Teams view to add teams', () => {
    renderPlan()
    fireEvent.click(screen.getByRole('button', { name: 'Add teams' }))
    expect(getUi().view).toBe('teams')
  })
})

describe('PlanView with example teams', () => {
  beforeEach(addExampleTeams)

  it('sorts the teams of the shown day by what is left to do', () => {
    renderPlan()

    // Monday: Policy Admin and Risk and Compliance are in, nobody has a seat yet.
    expect(screen.getByRole('heading', { name: /^To seat/ }).textContent).toBe('To seat 2')
    expect(screen.queryByRole('heading', { name: /^Seated/ })).toBeNull()
    expect(screen.getByText('Not in on Monday')).toBeTruthy()
    expect(teamRow('Policy Admin').getAttribute('aria-label')).toBe('Policy Admin, Policy, 0 of 8 seats')
    expect(screen.getByText('2 teams, 14 seats needed')).toBeTruthy()
  })

  it('shows how full each day is and switches the day', () => {
    renderPlan()

    // Tuesday is too popular on purpose: 69 seats for 66 desks.
    expect(dayButton('Tuesday').getAttribute('aria-label')).toBe(
      'Tuesday: 69 seats needed, 66 desks, needs overflow seats',
    )
    // Needing overflow seats is a warning, not a conflict: the meter is marked for amber.
    expect(dayButton('Tuesday').querySelector('.plan-day__meter--warning')).not.toBeNull()
    expect(dayButton('Monday').querySelector('.plan-day__meter--warning')).toBeNull()
    fireEvent.click(dayButton('Tuesday'))
    expect(getUi().day).toBe('tue')
    expect(screen.getByRole('heading', { name: /^To seat/ }).textContent).toBe('To seat 8')

    fireEvent.keyDown(dayButton('Tuesday'), { key: 'ArrowRight' })
    expect(getUi().day).toBe('wed')
    expect(document.activeElement).toBe(dayButton('Wednesday'))
    fireEvent.keyDown(dayButton('Wednesday'), { key: 'ArrowLeft' })
    fireEvent.keyDown(dayButton('Tuesday'), { key: 'ArrowLeft' })
    fireEvent.keyDown(dayButton('Monday'), { key: 'ArrowLeft' })
    expect(getUi().day).toBe('mon')
  })

  it('seats the active team in the areas that are clicked', () => {
    renderPlan()
    const admin = teamNamed('Policy Admin')

    fireEvent.click(teamRow('Policy Admin'))
    expect(getUi().activeTeamId).toBe(admin.id)
    expect(teamRow('Policy Admin').getAttribute('aria-pressed')).toBe('true')
    expect(placingBar('Policy Admin').textContent).toContain('0 of 8 seats')

    // NW 1 has six desks, the team needs eight: the second click takes the two that are left.
    fireEvent.click(areaOnPlan('NW 1'))
    expect(teamNamed('Policy Admin').seating).toEqual({ 'f4-nw1': 6 })
    fireEvent.click(areaOnPlan('NW 2'))
    expect(teamNamed('Policy Admin').seating).toEqual({ 'f4-nw1': 6, 'f4-nw2': 2 })
    expect(placingBar('Policy Admin').textContent).toContain('8 of 8 seats')
    expect(screen.getByRole('heading', { name: /^Seated/ }).textContent).toBe('Seated 1')

    // A click on an area the team sits in takes its seats there away.
    fireEvent.click(areaOnPlan('NW 1'))
    expect(teamNamed('Policy Admin').seating).toEqual({ 'f4-nw2': 2 })

    fireEvent.click(within(placingBar('Policy Admin')).getByRole('button', { name: 'Done' }))
    expect(getUi().activeTeamId).toBeNull()
    expect(screen.queryByRole('group', { name: /^Seating / })).toBeNull()
  })

  it('seats a team on the shown day only when asked to', () => {
    renderPlan()
    fireEvent.click(teamRow('Policy Admin'))
    fireEvent.click(screen.getByRole('button', { name: 'Only Monday' }))
    expect(getUi().seatScope).toBe('day')

    fireEvent.click(areaOnPlan('NW 1'))
    expect(teamNamed('Policy Admin').seating).toEqual({})
    expect(teamNamed('Policy Admin').daySeating).toEqual({ mon: { 'f4-nw1': 6 } })

    // With an exception on the shown day the scope is fixed; the exception can be dropped.
    expect(screen.queryByRole('button', { name: 'Only Monday' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use the normal seating' }))
    expect(teamNamed('Policy Admin').daySeating).toEqual({})
    expect(screen.getByRole('button', { name: 'Only Monday' })).toBeTruthy()
  })

  it('says why a click on the plan does nothing', () => {
    renderPlan()
    fireEvent.click(teamRow('Policy Admin'))
    const before = getProject()

    fireEvent.click(areaOnPlan('Meeting room 4.7'))

    expect(getProject()).toBe(before)
    expect(newestToast().textContent).toContain('Meeting room 4.7 is not for seating.')
  })

  it('selects an area and shows its week when no team is being seated', () => {
    renderPlan()

    fireEvent.click(areaOnPlan('NW 1'))
    expect(getUi().selectedAreaId).toBe('f4-nw1')
    const inspector = screen.getByRole('region', { name: 'Area NW 1' })
    expect(within(inspector).getByText('Desks, 6 seats')).toBeTruthy()
    const monday = within(inspector).getByRole('button', { name: 'Monday: nobody, 6 free' })
    expect(monday.getAttribute('aria-current')).toBe('true')

    fireEvent.click(within(inspector).getByRole('button', { name: 'Wednesday: nobody, 6 free' }))
    expect(getUi().day).toBe('wed')

    fireEvent.click(within(inspector).getByRole('button', { name: 'Edit this area' }))
    expect(getUi()).toMatchObject({ view: 'floors', floorId: 'floor-4', selectedAreaId: 'f4-nw1' })

    // The same area clicked again is deselected.
    fireEvent.click(areaOnPlan('NW 1'))
    expect(getUi().selectedAreaId).toBeNull()
    expect(screen.queryByRole('region', { name: 'Area NW 1' })).toBeNull()
  })

  it('tells rooms apart in the inspector', () => {
    renderPlan()
    fireEvent.click(areaOnPlan('Meeting room 4.7'))
    const inspector = screen.getByRole('region', { name: 'Area Meeting room 4.7' })
    expect(within(inspector).getByText('Not for seating. Teams cannot be placed here.')).toBeTruthy()
    expect(within(inspector).queryByText('This week')).toBeNull()

    fireEvent.click(within(inspector).getByRole('button', { name: 'Close area details' }))
    expect(getUi().selectedAreaId).toBeNull()
  })

  it('seats a team that is dropped on an area', async () => {
    renderPlan()
    const admin = teamNamed('Policy Admin')

    const setData = vi.fn()
    fireEvent.dragStart(teamRow('Policy Admin'), { dataTransfer: { setData, effectAllowed: 'none' } })
    expect(setData).toHaveBeenCalledWith(TEAM_DRAG_TYPE, admin.id)
    await waitFor(() => expect(getUi().activeTeamId).toBe(admin.id))

    act(() => setUi({ activeTeamId: null }))
    fireEvent.drop(areaOnPlan('NW 1'), {
      dataTransfer: { getData: (type: string) => (type === TEAM_DRAG_TYPE ? admin.id : ''), types: [TEAM_DRAG_TYPE] },
    })
    expect(getUi().activeTeamId).toBe(admin.id)
    expect(teamNamed('Policy Admin').seating).toEqual({ 'f4-nw1': 6 })
  })

  it('steps through the teams to seat with N and stops with Escape', () => {
    renderPlan()
    const admin = teamNamed('Policy Admin')
    const risk = teamNamed('Risk and Compliance')

    fireEvent.keyDown(document.body, { key: 'n' })
    expect(getUi().activeTeamId).toBe(admin.id)
    fireEvent.keyDown(document.body, { key: 'n' })
    expect(getUi().activeTeamId).toBe(risk.id)
    fireEvent.keyDown(document.body, { key: 'n' })
    expect(getUi().activeTeamId).toBe(admin.id)

    // Typing in a field is not a shortcut.
    fireEvent.click(areaOnPlan('NW 1'))
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Seats in NW 1' }), { key: 'n' })
    expect(getUi().activeTeamId).toBe(admin.id)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(getUi().activeTeamId).toBeNull()
  })

  it('fine-tunes and clears the seats of the active team', () => {
    renderPlan()
    fireEvent.click(teamRow('Policy Admin'))
    fireEvent.click(areaOnPlan('NW 1'))

    // The tool shows a conflict rather than blocking it: seven seats in an area of six.
    fireEvent.click(screen.getByRole('button', { name: 'More: Seats in NW 1' }))
    expect(teamNamed('Policy Admin').seating).toEqual({ 'f4-nw1': 7 })
    expect(screen.getByText('Over capacity on Monday')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fewer: Seats in NW 1' }))
    expect(screen.queryByText('Over capacity on Monday')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear seats' }))
    expect(teamNamed('Policy Admin').seating).toEqual({})
    expect(newestToast().textContent).toContain('Cleared the seats of Policy Admin')
    expect((screen.getByRole('button', { name: 'Clear seats' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(newestToast()).getByRole('button', { name: 'Undo' }))
    expect(teamNamed('Policy Admin').seating).toEqual({ 'f4-nw1': 6 })
  })

  it('offers the days of a team that is not in on the shown day', async () => {
    renderPlan()

    // The list of teams that are not in is closed until it is asked for.
    fireEvent.click(screen.getByText('Not in on Monday'))
    fireEvent.click(await screen.findByRole('button', { name: /^Architecture,/ }))

    const bar = placingBar('Architecture')
    expect(bar.textContent).toContain('Architecture is not in on Monday.')
    fireEvent.click(within(bar).getByRole('button', { name: 'Go to Wednesday' }))
    expect(getUi().day).toBe('wed')
    expect(placingBar('Architecture').textContent).toContain('0 of 4 seats')
  })

  it('lights a team up on the plan while its row is pointed at or focused', () => {
    const { container } = renderPlan()
    fireEvent.mouseEnter(teamRow('Policy Admin'))
    expect(container.querySelector('.sheet.has-emphasis')).not.toBeNull()
    fireEvent.mouseLeave(teamRow('Policy Admin'))
    expect(container.querySelector('.sheet.has-emphasis')).toBeNull()

    act(() => teamRow('Policy Admin').focus())
    expect(container.querySelector('.sheet.has-emphasis')).not.toBeNull()
    act(() => teamRow('Policy Admin').blur())
    expect(container.querySelector('.sheet.has-emphasis')).toBeNull()
  })

  it('keeps the focus in reach when the placing bar goes away', () => {
    renderPlan()
    fireEvent.click(teamRow('Policy Admin'))
    const done = within(placingBar('Policy Admin')).getByRole('button', { name: 'Done' })
    act(() => done.focus())

    fireEvent.click(done)

    expect(document.activeElement).toBe(teamRow('Policy Admin'))
  })
})

describe('PlanView automatic seating', () => {
  beforeEach(addExampleTeams)

  /** A proposal that seats Policy Admin completely and Risk and Compliance in part. */
  function proposal(): { before: Project; after: Project; admin: Team; risk: Team } {
    const before = getProject()
    const admin = teamNamed('Policy Admin')
    const risk = teamNamed('Risk and Compliance')
    const after = reduce(before, {
      type: 'batch',
      actions: [
        { type: 'seat/set', teamId: admin.id, areaId: 'f4-nw1', seats: 6, scope: 'all' },
        { type: 'seat/set', teamId: admin.id, areaId: 'f4-nw2', seats: 2, scope: 'all' },
        { type: 'seat/set', teamId: risk.id, areaId: 'f4-n1', seats: 4, scope: 'all' },
      ],
    })
    return { before, after, admin, risk }
  }

  it('says so when there is nothing to change', () => {
    renderPlan()
    const before = getProject()

    fireEvent.click(screen.getByRole('button', { name: 'Seat everyone automatically' }))

    expect(getProject()).toBe(before)
    expect(newestToast().textContent).toContain('Nothing to change')
    expect(screen.queryByText('Automatic seating')).toBeNull()
  })

  it('applies a proposal for everyone as one step that can be undone', () => {
    const { before, after, admin, risk } = proposal()
    vi.mocked(autoSeat).mockReturnValue({
      project: after,
      outcomes: [
        { teamId: admin.id, result: 'seated', message: 'Seated in NW 1 and NW 2 on Floor 4' },
        { teamId: risk.id, result: 'partly', message: 'No room on Tuesday: needs 6 seats, 4 desks are free' },
      ],
    })
    renderPlan()

    fireEvent.click(screen.getByRole('button', { name: 'Seat everyone automatically' }))

    expect(teamNamed('Policy Admin').seating).toEqual({ 'f4-nw1': 6, 'f4-nw2': 2 })
    expect(teamNamed('Risk and Compliance').seating).toEqual({ 'f4-n1': 4 })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Automatic seating')).toBeTruthy()
    expect(within(dialog).getByText('Seated 1 team. 1 could not be seated completely.')).toBeTruthy()
    // The team that still lacks seats comes first.
    expect(within(dialog).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Risk and ComplianceNo room on Tuesday: needs 6 seats, 4 desks are freeStill to seat',
      'Policy AdminSeated in NW 1 and NW 2 on Floor 4Seated',
    ])

    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo' }))
    expect(getProject()).toBe(before)
    expect(screen.queryByText('Automatic seating')).toBeNull()
  })

  it('keeps a proposal for everyone', () => {
    const { after, admin } = proposal()
    vi.mocked(autoSeat).mockReturnValue({
      project: after,
      outcomes: [{ teamId: admin.id, result: 'seated', message: 'Seated in NW 1 and NW 2 on Floor 4' }],
    })
    renderPlan()

    fireEvent.click(screen.getByRole('button', { name: 'Seat everyone automatically' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))

    expect(teamNamed('Policy Admin').seating).toEqual({ 'f4-nw1': 6, 'f4-nw2': 2 })
    expect(screen.queryByText('Automatic seating')).toBeNull()
    // The dialog took the focus with it; it lands in the tray, not nowhere.
    expect(document.activeElement).toBe(teamRow('Risk and Compliance'))
  })

  it('seats one team automatically and offers to undo it', () => {
    const { before, after, admin } = proposal()
    vi.mocked(autoSeat).mockReturnValue({
      project: after,
      outcomes: [{ teamId: admin.id, result: 'seated', message: 'Seated in NW 1 and NW 2 on Floor 4' }],
    })
    renderPlan()
    fireEvent.click(teamRow('Policy Admin'))

    fireEvent.click(within(placingBar('Policy Admin')).getByRole('button', { name: 'Seat automatically' }))

    expect(autoSeat).toHaveBeenCalledWith(before, { teamIds: [admin.id] })
    expect(teamNamed('Policy Admin').seating).toEqual({ 'f4-nw1': 6, 'f4-nw2': 2 })
    // Only the team that was asked for is taken from the proposal.
    expect(teamNamed('Risk and Compliance').seating).toEqual({})
    expect(newestToast().textContent).toContain('Seated in NW 1 and NW 2 on Floor 4')

    fireEvent.click(within(newestToast()).getByRole('button', { name: 'Undo' }))
    expect(getProject()).toBe(before)
  })

  it('passes on why one team could not be seated', () => {
    const admin = teamNamed('Policy Admin')
    vi.mocked(autoSeat).mockImplementation((project) => ({
      project,
      outcomes: [
        { teamId: admin.id, result: 'unseated', message: 'No room on Monday: needs 8 seats, 0 desks are free' },
      ],
    }))
    renderPlan()
    fireEvent.click(teamRow('Policy Admin'))

    fireEvent.click(within(placingBar('Policy Admin')).getByRole('button', { name: 'Seat automatically' }))

    expect(newestToast().textContent).toContain('No room on Monday: needs 8 seats, 0 desks are free')
    expect(within(newestToast()).queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})

describe('PlanView with conflicts', () => {
  beforeEach(addExampleTeams)

  it('marks the day, the floor, the team and the tab', () => {
    vi.mocked(findIssues).mockImplementation((project) => {
      const admin = project.teams.find((t) => t.name === 'Policy Admin')
      const risk = project.teams.find((t) => t.name === 'Risk and Compliance')
      if (!admin || !risk) return []
      const conflict: Issue = {
        id: `area-over-capacity|mon|floor-4|f4-nw1|${admin.id}`,
        rule: 'area-over-capacity',
        severity: 'error',
        day: 'mon',
        floorId: 'floor-4',
        areaId: 'f4-nw1',
        teamIds: [admin.id],
        title: 'NW 1 is over capacity on Monday',
        detail: '8 seats taken, 6 available',
      }
      const toSeat: Issue = {
        id: `team-unseated|mon|-|-|${risk.id}`,
        rule: 'team-unseated',
        severity: 'todo',
        day: 'mon',
        floorId: null,
        areaId: null,
        teamIds: [risk.id],
        title: 'Risk and Compliance has no seats on Monday',
        detail: 'Needs 6 seats',
      }
      return [conflict, toSeat]
    })
    renderPlan()

    expect(dayButton('Monday').getAttribute('aria-label')).toBe(
      'Monday: 14 seats needed, 66 desks, 52 free, 1 conflict, 1 team to seat',
    )
    expect(within(dayButton('Monday')).getByText('1 conflict')).toBeTruthy()
    expect(within(dayButton('Monday')).getByText('1 to seat')).toBeTruthy()
    expect(within(dayButton('Tuesday')).queryByText(/conflict/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Floor 4, 0 of 66 desks taken on Monday, has a conflict' })).toBeTruthy()
    expect(teamRow('Policy Admin').getAttribute('aria-label')).toBe(
      'Policy Admin, Policy, 0 of 8 seats, has a conflict',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Conflicts 1' }))
    expect(getUi().sideTab).toBe('conflicts')
    expect(screen.queryByRole('heading', { name: /^To seat/ })).toBeNull()
  })
})

describe('PlanView without a usable floor', () => {
  it('asks for a floor when the project has none', () => {
    projectStore.load({ ...startingProject(), floors: [] })
    renderPlan()

    expect(screen.getByText('No floor yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a floor' }))
    expect(getUi().view).toBe('floors')
  })

  it('points to the Floors view when the floor has no areas', () => {
    const start = startingProject()
    projectStore.load({ ...start, floors: start.floors.map((floor) => ({ ...floor, areas: [] })) })
    renderPlan()

    expect(screen.getByText(/This floor has no seating areas yet\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Draw them in Floors' }))
    expect(getUi()).toMatchObject({ view: 'floors', floorId: 'floor-4' })
  })
})
