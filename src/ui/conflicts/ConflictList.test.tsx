// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RULE_SEVERITY, type Issue, type IssueRule } from '../../domain/conflicts'
import type { Fix } from '../../domain/fixes'
import type { Team, Weekday } from '../../domain/types'
import { exampleTeams, startingProject } from '../../state/seed'
import { dispatch, getProject, projectStore, undo } from '../../state/store'
import { getUi, resetUi, setUi } from '../../state/ui'
import { ToastRegion } from '../primitives'
import { ConflictList } from './ConflictList'

/* The engine that finds issues and fixes is written by others at the same time. These tests
   feed the list hand-made issues and fixes, so they only test the list. */
const fake = vi.hoisted(() => ({
  /** What the list gets as issues; null lets the engine's own through. */
  issues: null as Issue[] | null,
  fixes: [] as Fix[],
  timesAskedForFixes: 0,
}))

vi.mock('../../state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/store')>()
  return {
    ...actual,
    useIssues: () => {
      const real = actual.useIssues()
      return fake.issues ?? real
    },
  }
})

vi.mock('../../domain/fixes', () => ({
  suggestFixes: () => {
    fake.timesAskedForFixes += 1
    return fake.fixes
  },
}))

const NE1 = { floorId: 'floor-4', areaId: 'f4-ne1' }
const ROOM = { floorId: 'floor-4', areaId: 'f4-room' }

function issue(
  rule: IssueRule,
  day: Weekday | null,
  where: { teamIds?: string[]; areaId?: string; floorId?: string },
  title: string,
  detail = `Numbers behind: ${title}`,
): Issue {
  const teamIds = where.teamIds ?? []
  const areaId = where.areaId ?? null
  const floorId = where.floorId ?? null
  return {
    id: [rule, day ?? '-', floorId ?? '-', areaId ?? '-', teamIds.join('+') || '-'].join('|'),
    rule,
    severity: RULE_SEVERITY[rule],
    day,
    floorId,
    areaId,
    teamIds,
    title,
    detail,
  }
}

/** Adds the example teams and returns the first two. */
function twoTeams(): [Team, Team] {
  act(() => dispatch({ type: 'team/addMany', teams: exampleTeams(getProject()) }))
  const [first, second] = getProject().teams
  if (!first || !second) throw new Error('The example teams are missing')
  return [first, second]
}

/** The list row with this title. */
function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest('li')
  if (!row) throw new Error(`No row titled "${title}"`)
  return row
}

function titlesIn(section: HTMLElement): (string | null)[] {
  return [...section.querySelectorAll('.conflicts-title')].map((title) => title.textContent)
}

/** Toasts outlive a test, so take away what a test left behind. */
function dismissToasts(): void {
  const { unmount } = render(<ToastRegion />)
  for (const button of screen.queryAllByRole('button', { name: 'Dismiss' })) fireEvent.click(button)
  unmount()
}

beforeEach(() => {
  projectStore.load(startingProject())
  resetUi()
  fake.issues = null
  fake.fixes = []
  fake.timesAskedForFixes = 0
})

afterEach(() => {
  cleanup()
  dismissToasts()
})

describe('ConflictList without anything open', () => {
  it('says that there are no conflicts in an empty plan', () => {
    render(<ConflictList />)

    expect(screen.getByText('No conflicts. Every team has its seats.')).toBeTruthy()
    expect(screen.queryByText(/^Accepted/)).toBeNull()
  })

  it('renders with the example teams, whatever the engine finds', () => {
    twoTeams()
    const { container } = render(<ConflictList day="tue" />)

    const rows = container.querySelectorAll('.conflicts-row').length
    const allClear = screen.queryByText(/^No conflicts/) !== null
    expect(rows > 0 || allClear).toBe(true)
  })

  it('says only "No conflicts." when accepted warnings are all that is left', () => {
    const [alpha] = twoTeams()
    const wish = issue('wish-unmet', 'mon', { teamIds: [alpha.id] }, 'Claims Intake wants Monday, which is not planned')
    act(() => dispatch({ type: 'issue/accept', id: wish.id, note: '', detail: wish.detail }))
    fake.issues = [wish]

    render(<ConflictList />)

    expect(screen.getByText('No conflicts.')).toBeTruthy()
    expect(screen.queryByText('No conflicts. Every team has its seats.')).toBeNull()
    expect(screen.getByText('Accepted (1)')).toBeTruthy()
  })
})

describe('ConflictList sections and rows', () => {
  it('shows a section per level, each with its rows and the number the top bar counts', () => {
    const [alpha, beta] = twoTeams()
    fake.issues = [
      issue('area-over-capacity', 'tue', { ...NE1, teamIds: [alpha.id, beta.id] }, 'NE 1 is over capacity on Tuesday'),
      issue('area-over-capacity', 'thu', { ...NE1, teamIds: [alpha.id, beta.id] }, 'NE 1 is over capacity on Thursday'),
      issue('team-unseated', 'tue', { teamIds: [alpha.id] }, 'Claims Intake has no seats on Tuesday'),
      issue('wish-unmet', 'mon', { teamIds: [beta.id] }, 'Claims Handling wants Monday, which is not planned'),
      issue('no-team-days', null, { teamIds: [beta.id] }, 'Claims Handling has no team day'),
    ]

    render(<ConflictList />)

    // Tuesday and Thursday are one row; the number counts both days, as the top bar does.
    expect(titlesIn(screen.getByRole('region', { name: 'Conflicts 2' }))).toEqual(['NE 1 is over capacity on Tuesday'])
    expect(titlesIn(screen.getByRole('region', { name: 'Still to seat 1' }))).toEqual([
      'Claims Intake has no seats on Tuesday',
    ])
    expect(titlesIn(screen.getByRole('region', { name: 'Warnings 1' }))).toEqual([
      'Claims Handling wants Monday, which is not planned',
    ])
    expect(titlesIn(screen.getByRole('region', { name: 'Notes 1' }))).toEqual(['Claims Handling has no team day'])
    expect(screen.queryByText(/^No conflicts/)).toBeNull()

    const row = rowOf('NE 1 is over capacity on Tuesday')
    expect(within(row).getByText('Numbers behind: NE 1 is over capacity on Tuesday')).toBeTruthy()
    expect(within(row).getByText('Also on Thursday')).toBeTruthy()
    expect(within(row).getByText('Thu')).toBeTruthy()
  })

  it('speaks about the given day and lists the rows of that day first', () => {
    const [alpha, beta] = twoTeams()
    fake.issues = [
      issue('seats-in-room', 'mon', { ...ROOM, teamIds: [beta.id] }, 'Seats in a room on Monday'),
      issue('area-over-capacity', 'tue', { ...NE1, teamIds: [alpha.id] }, 'NE 1 is over capacity on Tuesday'),
      issue('area-over-capacity', 'thu', { ...NE1, teamIds: [alpha.id] }, 'NE 1 is over capacity on Thursday'),
    ]

    render(<ConflictList day="thu" />)

    expect(titlesIn(screen.getByRole('region', { name: 'Conflicts 3' }))).toEqual([
      'NE 1 is over capacity on Thursday',
      'Seats in a room on Monday',
    ])
    expect(within(rowOf('NE 1 is over capacity on Thursday')).getByText('Also on Tuesday')).toBeTruthy()
  })

  it('"Show" goes to the plan at the day, floor, area and team of the issue', () => {
    const [alpha, beta] = twoTeams()
    fake.issues = [
      issue('area-over-capacity', 'tue', { ...NE1, teamIds: [alpha.id, beta.id] }, 'NE 1 is over capacity on Tuesday'),
      issue('area-over-capacity', 'thu', { ...NE1, teamIds: [alpha.id, beta.id] }, 'NE 1 is over capacity on Thursday'),
    ]
    setUi({ view: 'teams', day: 'mon' })

    render(<ConflictList day="thu" />)
    fireEvent.click(within(rowOf('NE 1 is over capacity on Thursday')).getByRole('button', { name: 'Show' }))

    expect(getUi()).toMatchObject({ view: 'plan', day: 'thu', floorId: 'floor-4', selectedAreaId: 'f4-ne1' })
    expect(getUi().spotlight).toMatchObject({ areaId: 'f4-ne1', teamId: alpha.id })
  })
})

describe('ConflictList fixes', () => {
  it('looks for fixes only once "Fix" is opened, and says so when there is none', () => {
    const [alpha] = twoTeams()
    fake.issues = [issue('team-unseated', 'tue', { teamIds: [alpha.id] }, 'Claims Intake has no seats on Tuesday')]

    render(<ConflictList />)
    const fix = screen.getByRole('button', { name: 'Fix' })

    expect(fix.getAttribute('aria-expanded')).toBe('false')
    expect(fake.timesAskedForFixes).toBe(0)

    fireEvent.click(fix)

    expect(fix.getAttribute('aria-expanded')).toBe('true')
    expect(fake.timesAskedForFixes).toBeGreaterThan(0)
    expect(screen.getByText('No automatic fix. Change it on the plan.')).toBeTruthy()

    fireEvent.click(fix)

    expect(screen.queryByText('No automatic fix. Change it on the plan.')).toBeNull()
  })

  it('applies a fix as one edit that the toast can undo', () => {
    const [alpha] = twoTeams()
    fake.issues = [issue('team-unseated', 'tue', { teamIds: [alpha.id] }, 'Claims Intake has no seats on Tuesday')]
    fake.fixes = [
      {
        id: 'move',
        label: 'Move Claims Intake to Friday',
        explanation: 'Plans Friday instead of Tuesday for Claims Intake.',
        action: { type: 'team/moveDay', id: alpha.id, from: 'tue', to: 'fri' },
      },
    ]
    render(
      <>
        <ConflictList />
        <ToastRegion />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fix' }))
    const button = screen.getByRole('button', { name: 'Move Claims Intake to Friday' })
    expect(button.getAttribute('title')).toBe('Plans Friday instead of Tuesday for Claims Intake.')
    fireEvent.click(button)

    expect(getProject().teams[0]?.days).toEqual(['thu', 'fri'])
    const toast = screen.getByRole('status')
    expect(within(toast).getByText('Move Claims Intake to Friday')).toBeTruthy()

    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))

    expect(getProject().teams[0]?.days).toEqual(['tue', 'thu'])
  })
})

describe('ConflictList accepting', () => {
  function wishes(team: Team): [Issue, Issue] {
    const who = { teamIds: [team.id] }
    return [
      issue('wish-unmet', 'tue', who, 'Claims Intake wants Tuesday, which is not planned', 'Asked for Tuesday'),
      issue('wish-unmet', 'thu', who, 'Claims Intake wants Thursday, which is not planned', 'Asked for Thursday'),
    ]
  }

  it('offers "Accept" for warnings and notes, not for conflicts and teams still to seat', () => {
    const [alpha] = twoTeams()
    fake.issues = [
      issue('area-over-capacity', 'tue', { ...NE1, teamIds: [alpha.id] }, 'NE 1 is over capacity on Tuesday'),
      issue('team-unseated', 'tue', { teamIds: [alpha.id] }, 'Claims Intake has no seats on Tuesday'),
      issue('overflow-used', 'tue', { teamIds: [alpha.id] }, 'Claims Intake uses overflow seats on Tuesday'),
      issue('no-team-days', null, { teamIds: [alpha.id] }, 'Claims Intake has no team day'),
    ]

    render(<ConflictList />)

    const accept = (title: string) => within(rowOf(title)).queryByRole('button', { name: 'Accept' })
    expect(accept('NE 1 is over capacity on Tuesday')).toBeNull()
    expect(accept('Claims Intake has no seats on Tuesday')).toBeNull()
    expect(accept('Claims Intake uses overflow seats on Tuesday')).not.toBeNull()
    expect(accept('Claims Intake has no team day')).not.toBeNull()
  })

  it('accepts every issue of the row in one step, with the reason', async () => {
    const [alpha] = twoTeams()
    const [tue, thu] = wishes(alpha)
    fake.issues = [tue, thu]
    render(<ConflictList />)
    const title = 'Claims Intake wants Tuesday, which is not planned'

    fireEvent.click(within(rowOf(title)).getByRole('button', { name: 'Accept' }))
    const reason = within(rowOf(title)).getByLabelText('Why is this fine? (optional)')
    expect(document.activeElement).toBe(reason)
    fireEvent.change(reason, { target: { value: '  They agreed to Friday  ' } })
    fireEvent.click(within(rowOf(title)).getByRole('button', { name: 'Accept' }))

    expect(getProject().accepted).toEqual({
      [tue.id]: { note: 'They agreed to Friday', detail: 'Asked for Tuesday' },
      [thu.id]: { note: 'They agreed to Friday', detail: 'Asked for Thursday' },
    })
    // The row left the warnings and waits, closed, under "Accepted".
    expect(screen.queryByRole('region', { name: /^Warnings/ })).toBeNull()
    expect(screen.getByText('No conflicts.')).toBeTruthy()
    const accepted = rowOf(title)
    expect(accepted.closest('details')?.open).toBe(false)
    expect(screen.getByText('Accepted (2)')).toBeTruthy()
    expect(within(accepted).getByText('They agreed to Friday')).toBeTruthy()
    // The pressed button is gone; the list keeps the focus.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Conflicts' })))

    act(() => undo())

    expect(getProject().accepted).toEqual({})
  })

  it('leaves the focus alone when the planner has gone on to something else', async () => {
    const [alpha] = twoTeams()
    fake.issues = wishes(alpha)
    render(
      <>
        <button type="button">Elsewhere</button>
        <ConflictList />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    elsewhere.focus()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(document.activeElement).toBe(elsewhere)
  })

  it('"Reopen" takes the acceptance of every issue of the row back', () => {
    const [alpha] = twoTeams()
    const [tue, thu] = wishes(alpha)
    act(() =>
      dispatch({
        type: 'batch',
        actions: [tue, thu].map((each) => ({ type: 'issue/accept', id: each.id, note: '', detail: each.detail })),
      }),
    )
    fake.issues = [tue, thu]
    render(<ConflictList />)

    const summary = screen.getByText('Accepted (2)')
    fireEvent.click(summary)
    expect(summary.closest('details')?.open).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(getProject().accepted).toEqual({})
    expect(titlesIn(screen.getByRole('region', { name: 'Warnings 2' }))).toEqual([
      'Claims Intake wants Tuesday, which is not planned',
    ])
    expect(screen.queryByText(/^Accepted/)).toBeNull()
  })

  it('"Cancel" and Escape leave the row as it was, with the focus back on "Accept"', () => {
    const [alpha] = twoTeams()
    fake.issues = wishes(alpha)
    render(<ConflictList />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Why is this fine? (optional)')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept' }))

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.keyDown(screen.getByLabelText('Why is this fine? (optional)'), { key: 'Escape' })

    expect(screen.queryByLabelText('Why is this fine? (optional)')).toBeNull()
    expect(getProject().accepted).toEqual({})
  })

  it('counts an acceptance only while the numbers behind the issue stay the same', () => {
    const [alpha] = twoTeams()
    const who = { teamIds: [alpha.id] }
    const before = issue('overflow-used', 'tue', who, 'Claims Intake uses overflow seats', '2 seats')
    const after = { ...before, detail: '5 seats' }
    act(() => dispatch({ type: 'issue/accept', id: before.id, note: 'Fine for now', detail: before.detail }))
    fake.issues = [after]

    render(<ConflictList />)

    expect(titlesIn(screen.getByRole('region', { name: 'Warnings 1' }))).toEqual(['Claims Intake uses overflow seats'])
    expect(screen.queryByText(/^Accepted/)).toBeNull()
  })
})
