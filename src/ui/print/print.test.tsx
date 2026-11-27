// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '../../domain/conflicts'
import { makeFloor, makeTeam } from '../../domain/model'
import type { Weekday } from '../../domain/types'
import { startingProject } from '../../state/seed'
import { dispatch, getProject, projectStore } from '../../state/store'
import { resetUi } from '../../state/ui'
import { PrintDialog } from './PrintDialog'
import { PrintRoot } from './PrintRoot'
import { getPrintState, openPrintDialog, resetPrintState, setPrintJob } from './printState'

/* The engine that finds issues is written by someone else at the same time; the pages get
   hand-made issues where a test needs some. */
const fake = vi.hoisted(() => ({ issues: null as Issue[] | null }))

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

function overCapacity(day: Weekday, areaId: string): Issue {
  return {
    id: `area-over-capacity|${day}|floor-4|${areaId}|-`,
    rule: 'area-over-capacity',
    severity: 'error',
    day,
    floorId: 'floor-4',
    areaId,
    teamIds: [],
    title: `${areaId} is over capacity`,
    detail: '',
  }
}

function addTeam(name: string, size: number, days: Weekday[]): string {
  const team = makeTeam(getProject(), { name, size, days, group: 'Claims' })
  act(() => dispatch({ type: 'team/add', team }))
  return team.id
}

function addFloor(name: string): void {
  act(() => dispatch({ type: 'floor/add', floor: makeFloor({ name }) }))
}

function openDialog(): HTMLElement {
  act(() => openPrintDialog())
  return screen.getByRole('dialog', { name: 'Print the plan' })
}

function checkbox(dialog: HTMLElement, name: string): HTMLInputElement {
  return within(dialog).getByRole<HTMLInputElement>('checkbox', { name })
}

function checkedDays(dialog: HTMLElement): string[] {
  const days = within(dialog).getByRole('group', { name: 'Days' })
  return within(days)
    .getAllByRole<HTMLInputElement>('checkbox')
    .filter((box) => box.checked)
    .map((box) => box.closest('label')?.textContent ?? '')
}

function paperLine(dialog: HTMLElement): string {
  return dialog.querySelector('.print-paper')?.textContent ?? ''
}

function pages(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.print-root .print-page')]
}

/** Floor and day of a floor page, as its title block says them. */
function titleOf(page: HTMLElement): (string | null)[] {
  return [...page.querySelectorAll('.titleblock__main')].map((part) => part.textContent)
}

function renderPrint() {
  return render(
    <>
      <PrintDialog />
      <PrintRoot />
    </>,
  )
}

beforeEach(() => {
  projectStore.load(startingProject())
  resetUi()
  resetPrintState()
  fake.issues = null
  // jsdom cannot print.
  window.print = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('PrintDialog', () => {
  it('is closed until it is asked for', () => {
    renderPrint()

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(pages()).toHaveLength(0)
  })

  it('offers all five days, the one floor and the week overview for a plan without teams', () => {
    renderPrint()
    const dialog = openDialog()

    expect(checkedDays(dialog)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    expect(within(dialog).queryByRole('group', { name: 'Floors' })).toBeNull()
    expect(checkbox(dialog, 'Include the week overview').checked).toBe(true)
    expect(paperLine(dialog)).toBe('6 pages, landscape')
  })

  it('preselects the days on which a team is in', () => {
    addTeam('Alpha', 4, ['tue', 'thu'])
    addTeam('Beta', 3, ['thu'])
    renderPrint()
    const dialog = openDialog()

    expect(checkedDays(dialog)).toEqual(['Tuesday', 'Thursday'])
    expect(paperLine(dialog)).toBe('3 pages, landscape')
  })

  it('lets the floors be chosen, top floor first, when there are several', () => {
    addFloor('Floor 5')
    renderPrint()
    const dialog = openDialog()

    const floors = within(dialog).getByRole('group', { name: 'Floors' })
    const boxes = within(floors).getAllByRole<HTMLInputElement>('checkbox')
    expect(boxes.map((box) => box.closest('label')?.textContent)).toEqual(['Floor 5', 'Floor 4'])
    expect(boxes.every((box) => box.checked)).toBe(true)
    expect(paperLine(dialog)).toBe('11 pages, landscape')

    fireEvent.click(checkbox(dialog, 'Floor 4'))

    expect(paperLine(dialog)).toBe('6 pages, landscape')
  })

  it('cannot print when nothing is chosen, and says what to choose', () => {
    addTeam('Alpha', 4, ['tue'])
    renderPrint()
    const dialog = openDialog()
    const print = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Print' })

    fireEvent.click(checkbox(dialog, 'Tuesday'))
    expect(paperLine(dialog)).toBe('1 page, landscape')
    expect(print.disabled).toBe(false)

    fireEvent.click(checkbox(dialog, 'Include the week overview'))
    expect(paperLine(dialog)).toBe('Nothing to print. Choose a day or the week overview.')
    expect(print.disabled).toBe(true)
  })

  it('starts from the usual selection again after "Cancel"', () => {
    renderPrint()
    let dialog = openDialog()
    fireEvent.click(checkbox(dialog, 'Monday'))
    expect(paperLine(dialog)).toBe('5 pages, landscape')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getPrintState()).toEqual({ dialogOpen: false, job: null })

    dialog = openDialog()
    expect(paperLine(dialog)).toBe('6 pages, landscape')
  })

  it('prints the choice: the pages are rendered before the browser is asked to print', async () => {
    addTeam('Alpha', 4, ['tue', 'thu'])
    renderPrint()
    const dialog = openDialog()
    let pagesWhenPrinting = -1
    window.print = vi.fn(() => {
      pagesWhenPrinting = pages().length
    })

    fireEvent.click(checkbox(dialog, 'Thursday'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Print' }))

    expect(getPrintState()).toEqual({
      dialogOpen: false,
      job: { days: ['tue'], floorIds: ['floor-4'], week: true },
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
    expect(pagesWhenPrinting).toBe(2)

    // The browser is done: nothing stays behind for the next time something is printed.
    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(getPrintState().job).toBeNull()
    expect(pages()).toHaveLength(0)
  })
})

describe('PrintRoot', () => {
  it('prints each chosen day in week order, with the chosen floors from the top down', () => {
    addFloor('Floor 5')
    addFloor('Floor 6')
    const [four, , six] = getProject().floors.map((floor) => floor.id)
    renderPrint()

    act(() => setPrintJob({ days: ['thu', 'tue'], floorIds: [four ?? '', six ?? ''], week: false }))

    expect(pages().map(titleOf)).toEqual([
      ['Floor 6', 'Tuesday'],
      ['Floor 4', 'Tuesday'],
      ['Floor 6', 'Thursday'],
      ['Floor 4', 'Thursday'],
    ])
  })

  it('ends every page with the name of the plan and the date', () => {
    renderPrint()

    act(() => setPrintJob({ days: ['mon'], floorIds: ['floor-4'], week: true }))

    const foots = pages().map((page) => page.lastElementChild?.textContent)
    expect(foots).toEqual(Array(2).fill(`Office planPrinted ${new Date().toLocaleDateString()}`))
  })

  it('marks a floor page as a draft while that floor has conflicts on that day', () => {
    fake.issues = [overCapacity('tue', 'f4-ne1'), overCapacity('tue', 'f4-ne2'), overCapacity('thu', 'f4-ne1')]
    renderPrint()

    act(() => setPrintJob({ days: ['mon', 'tue', 'thu'], floorIds: ['floor-4'], week: false }))

    const drafts = pages().map((page) => page.querySelector('.print-draft')?.textContent ?? null)
    expect(drafts).toEqual([
      null,
      'Draft: 2 conflicts open on this floor',
      'Draft: 1 conflict open on this floor',
    ])
  })

  it('prints the week overview: where every team sits on its days, and how full the days are', () => {
    const alpha = addTeam('Alpha', 4, ['tue', 'thu'])
    act(() => dispatch({ type: 'seat/set', teamId: alpha, areaId: 'f4-ne1', seats: 4, scope: 'all' }))
    act(() => dispatch({ type: 'seat/clear', teamId: alpha, scope: 'thu' }))
    renderPrint()

    act(() => setPrintJob({ days: [], floorIds: [], week: true }))

    const [page] = pages()
    if (!page) throw new Error('The week overview is missing')
    expect(within(page).getByRole('heading').textContent).toBe('Office plan Week overview')
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent)
    const [, team, total] = within(page).getAllByRole('row')
    if (!team || !total) throw new Error('The table has too few rows')
    expect(cells(team)).toEqual(['Alpha', 'Claims', '4', '4', '', 'Floor 4: NE 1', '', 'not seated', ''])
    expect(cells(total)).toEqual([
      'Seats needed',
      '0 of 66 desks',
      '4 of 66 desks',
      '0 of 66 desks',
      '4 of 66 desks',
      '0 of 66 desks',
    ])
  })

  it('prints the usual selection when the browser prints without the dialog', () => {
    addTeam('Alpha', 4, ['tue'])
    renderPrint()

    act(() => {
      window.dispatchEvent(new Event('beforeprint'))
    })

    expect(getPrintState().job).toEqual({ days: ['tue'], floorIds: ['floor-4'], week: true })
    expect(pages()).toHaveLength(2)

    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })

    expect(pages()).toHaveLength(0)
  })

  it('keeps the job of the dialog when the browser announces the printing', () => {
    renderPrint()
    const job = { days: ['fri' as const], floorIds: ['floor-4'], week: false }
    act(() => setPrintJob(job))

    act(() => {
      window.dispatchEvent(new Event('beforeprint'))
    })

    expect(getPrintState().job).toBe(job)
  })
})
