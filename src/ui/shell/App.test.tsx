// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { makeTeam } from '../../domain/model'
import { startingProject } from '../../state/seed'
import { dispatch, getProject, projectStore, type SaveStatus } from '../../state/store'
import { getUi, resetUi } from '../../state/ui'
import { resetPrintState } from '../print/printState'
import { resetExportTracking } from './exportTracking'

/* The whole frame with the real views in it: is everything wired up? Reading the plan from
   the browser's storage is left out; the status is set by hand. */
const fake = vi.hoisted(() => ({ saveStatus: 'saved' as SaveStatus }))

vi.mock('../../state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/store')>()
  return { ...actual, useSaveStatus: () => fake.saveStatus }
})

beforeEach(() => {
  projectStore.load(startingProject())
  resetUi()
  resetPrintState()
  resetExportTracking()
  fake.saveStatus = 'saved'
})

afterEach(() => {
  for (const button of screen.queryAllByRole('button', { name: 'Dismiss' })) fireEvent.click(button)
  cleanup()
})

describe('App', () => {
  it('waits for the saved plan before it shows anything to work with', () => {
    fake.saveStatus = 'loading'
    render(<App />)

    expect(screen.getByText('Opening your plan')).toBeTruthy()
    expect(screen.queryByRole('banner')).toBeNull()
  })

  it('shows the bar, one view at a time, and the place for the print pages', () => {
    const { container } = render(<App />)

    expect(screen.getByRole('banner')).toBeTruthy()
    expect(container.querySelectorAll('main > *')).toHaveLength(1)
    expect(container.querySelector('.print-root')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Teams and days' }))
    expect(getUi().view).toBe('teams')
    expect(container.querySelectorAll('main > *')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Floors' }))
    expect(getUi().view).toBe('floors')
    expect(container.querySelectorAll('main > *')).toHaveLength(1)
  })

  it('listens to the shortcuts', () => {
    render(<App />)

    fireEvent.keyDown(document.body, { key: '2' })

    expect(getUi().day).toBe('tue')
  })

  it('opens the print dialog from the File menu', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Print' }))

    expect(screen.getByRole('dialog', { name: 'Print the plan' })).toBeTruthy()
  })

  it('tells at once when an edit makes two teams collide', () => {
    render(<App />)
    const alpha = makeTeam(getProject(), { name: 'Alpha', size: 2, days: ['tue'] })
    const beta = makeTeam({ ...getProject(), teams: [alpha] }, { name: 'Beta', size: 2, days: ['tue'] })
    act(() => dispatch({ type: 'team/addMany', teams: [alpha, beta] }))
    // NE 2 has two desks.
    act(() => dispatch({ type: 'seat/set', teamId: alpha.id, areaId: 'f4-ne2', seats: 2, scope: 'all' }))
    expect(screen.queryByText(/^This created/)).toBeNull()

    act(() => dispatch({ type: 'seat/set', teamId: beta.id, areaId: 'f4-ne2', seats: 2, scope: 'all' }))

    expect(screen.getByText(/^This created a conflict: /)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Show conflicts: 1 conflict/ })).toBeTruthy()
  })
})
