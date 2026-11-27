// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParseResult } from '../../domain/files'
import { project as testProject, floor, row, team } from '../../domain/testkit'
import { exampleTeams, startingProject } from '../../state/seed'
import { dispatch, getProject, projectStore, undo, type SaveStatus } from '../../state/store'
import { getUi, resetUi, setUi } from '../../state/ui'
import { ToastRegion } from '../primitives'
import { getPrintState, resetPrintState } from '../print/printState'
import { resetExportTracking } from './exportTracking'
import { TopBar } from './TopBar'

/* Saving to the browser and reading plan files are not what is tested here: the save status
   is set by hand, and the file parser (written by someone else at the same time) answers
   what a test tells it to. */
const fake = vi.hoisted(() => ({
  saveStatus: 'saved' as SaveStatus,
  parse: null as ((text: string) => ParseResult) | null,
  csv: null as string | null,
}))

vi.mock('../../state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/store')>()
  return { ...actual, useSaveStatus: () => fake.saveStatus }
})

vi.mock('../../domain/files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../domain/files')>()
  return {
    ...actual,
    parseProjectFile: (text: string) => (fake.parse ? fake.parse(text) : actual.parseProjectFile(text)),
    seatingCsv: (...args: Parameters<typeof actual.seatingCsv>) => fake.csv ?? actual.seatingCsv(...args),
  }
})

/** What the browser was handed to download. */
interface Download {
  fileName: string
  blob: Blob
}

let downloads: Download[] = []

/** jsdom has no object URLs and cannot follow a download link: record them instead. */
function recordDownloads(): void {
  const blobs = new Map<string, Blob>()
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    const url = `blob:download-${blobs.size + 1}`
    if (blob instanceof Blob) blobs.set(url, blob)
    return url
  }
  URL.revokeObjectURL = () => undefined
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href)
    if (blob) downloads.push({ fileName: this.download, blob })
  })
}

function addExampleTeams(): void {
  act(() => dispatch({ type: 'team/addMany', teams: exampleTeams(getProject()) }))
}

function chooseFromFileMenu(item: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'File' }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

function fileDot(): Element | null {
  return document.querySelector('.shell-file-dot')
}

function renderBar() {
  return render(
    <>
      <TopBar />
      <ToastRegion />
    </>,
  )
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
  resetExportTracking()
  resetPrintState()
  fake.saveStatus = 'saved'
  fake.parse = null
  fake.csv = null
  downloads = []
  recordDownloads()
})

afterEach(() => {
  cleanup()
  dismissToasts()
  vi.restoreAllMocks()
})

describe('TopBar', () => {
  it('shows an empty plan: its name, the views, no conflicts and nothing to undo', () => {
    renderBar()

    expect(screen.getByRole('heading', { name: 'Team day planner' })).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Plan name').value).toBe('Office plan')
    const views = within(screen.getByRole('group', { name: 'View' })).getAllByRole('button')
    expect(views.map((view) => view.textContent)).toEqual(['Plan', 'Teams and days', 'Floors'])
    expect(views.map((view) => view.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(screen.getByRole('button', { name: 'Show conflicts: no conflicts' }).textContent).toBe('No conflicts')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Redo' }).disabled).toBe(true)
    expect(screen.getByText('Saved in this browser')).toBeTruthy()
    expect(fileDot()).toBeNull()
  })

  it('renders with the example teams and marks that they are in no file yet', () => {
    renderBar()
    addExampleTeams()

    expect(screen.getByRole('button', { name: /^Show conflicts: / })).toBeTruthy()
    expect(screen.getByTitle('Changes since the last exported file').contains(fileDot())).toBe(true)
    expect(screen.getByRole('button', { name: 'File' }).textContent).toBe('File')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' }).disabled).toBe(false)
  })

  it('switches the view', () => {
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Teams and days' }))

    expect(getUi().view).toBe('teams')
    expect(screen.getByRole('button', { name: 'Teams and days' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Floors' }))

    expect(getUi().view).toBe('floors')
  })

  it('undoes and redoes with its buttons, which are off when there is nothing to do', () => {
    renderBar()
    const undoButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' })
    const redoButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Redo' })
    expect(undoButton.title).toMatch(/^Undo \((Ctrl|Cmd)\+Z\)$/)
    expect(redoButton.title).toMatch(/^Redo \((Ctrl|Cmd)\+Shift\+Z\)$/)

    addExampleTeams()
    expect(undoButton.disabled).toBe(false)
    expect(redoButton.disabled).toBe(true)

    fireEvent.click(undoButton)
    expect(getProject().teams).toHaveLength(0)
    expect(undoButton.disabled).toBe(true)
    expect(redoButton.disabled).toBe(false)

    fireEvent.click(redoButton)
    expect(getProject().teams).toHaveLength(10)
  })

  it('renames the plan while typing, as one step to undo', () => {
    renderBar()
    const name = screen.getByLabelText<HTMLInputElement>('Plan name')

    fireEvent.change(name, { target: { value: 'Antwerp' } })
    fireEvent.change(name, { target: { value: 'Antwerp office' } })

    expect(getProject().name).toBe('Antwerp office')
    expect(name.value).toBe('Antwerp office')

    act(() => undo())

    expect(getProject().name).toBe('Office plan')
  })

  it('leads from the summary to the conflict list in the Plan view', () => {
    setUi({ view: 'floors', sideTab: 'teams' })
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: /^Show conflicts: / }))

    expect(getUi()).toMatchObject({ view: 'plan', sideTab: 'conflicts' })
  })
})

describe('TopBar save status', () => {
  it('says "Saving" while a save is on its way', () => {
    fake.saveStatus = 'saving'
    renderBar()

    expect(screen.getByText('Saving')).toBeTruthy()
  })

  it('warns when the browser does not store the plan, until a save succeeds', () => {
    const help = 'This browser does not allow storing the plan. Export a plan file to keep your work.'
    fake.saveStatus = 'failed'
    const { rerender } = renderBar()
    const bar = () => (
      <>
        <TopBar />
        <ToastRegion />
      </>
    )

    expect(screen.getByText('Not saved').getAttribute('title')).toBe(help)
    // Said once in full as well, for who cannot hover.
    expect(within(screen.getByRole('status')).getAllByText(help)).toHaveLength(1)

    // The next edit tries again: that is still "Not saved", and not said twice.
    fake.saveStatus = 'saving'
    rerender(bar())
    fake.saveStatus = 'failed'
    rerender(bar())
    expect(screen.getByText('Not saved')).toBeTruthy()
    expect(screen.queryByText('Saving')).toBeNull()
    expect(within(screen.getByRole('status')).getAllByText(help)).toHaveLength(1)

    fake.saveStatus = 'saved'
    rerender(bar())
    expect(screen.queryByText('Not saved')).toBeNull()
    expect(screen.getByText('Saved in this browser')).toBeTruthy()
  })
})

describe('File menu', () => {
  it('lists its actions', () => {
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'File' }))

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Export plan file',
      'Open plan file',
      'Export seating as CSV',
      'Print',
      'Start over',
    ])
  })

  it('exports the plan as a file and remembers which state is in it', async () => {
    renderBar()
    addExampleTeams()
    expect(fileDot()).not.toBeNull()

    chooseFromFileMenu('Export plan file')

    expect(downloads).toHaveLength(1)
    const [download] = downloads
    expect(download?.fileName).toMatch(/^office-plan-\d{4}-\d{2}-\d{2}\.json$/)
    expect(download?.blob.type).toBe('application/json')
    const saved = JSON.parse((await download?.blob.text()) ?? '') as { app: string; project: { teams: unknown[] } }
    expect(saved.app).toBe('team-day-planner')
    expect(saved.project.teams).toHaveLength(10)
    expect(screen.getByText(`Exported ${download?.fileName}`)).toBeTruthy()
    expect(fileDot()).toBeNull()

    // A change after the export shows again; going back to the exported state does not.
    act(() => dispatch({ type: 'project/rename', name: 'Another name' }))
    expect(fileDot()).not.toBeNull()
    act(() => undo())
    expect(fileDot()).toBeNull()
  })

  it('exports the seating as a CSV file, byte for byte as it was written', async () => {
    // The writer starts the text with a byte order mark, so that Excel reads it as UTF-8.
    fake.csv = `${String.fromCharCode(0xfeff)}Day,Team\r\nTuesday,Zoë\r\n`
    renderBar()

    chooseFromFileMenu('Export seating as CSV')

    const [download] = downloads
    expect(download?.fileName).toMatch(/^office-plan-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(download?.blob.type).toBe('text/csv')
    const bytes = new Uint8Array((await download?.blob.arrayBuffer()) ?? new ArrayBuffer(0))
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(fake.csv)
    expect(screen.getByText(`Exported ${download?.fileName}`)).toBeTruthy()
  })

  it('opens a plan file, forgets what was selected in the old plan, and can undo it', async () => {
    const opened = testProject(
      [floor('g', row(['a1', 'a2'], 4))],
      [team('alpha', 6, ['tue'], { a1: 4, a2: 2 })],
    )
    fake.parse = () => ({ ok: true, project: opened })
    renderBar()
    addExampleTeams()
    const before = getProject()
    act(() => setUi({ floorId: 'floor-4', activeTeamId: before.teams[0]?.id ?? null, selectedAreaId: 'f4-ne1' }))

    const input = screen.getByLabelText<HTMLInputElement>('Plan file to open')
    fireEvent.change(input, { target: { files: [new File(['{}'], 'plan.json', { type: 'application/json' })] } })

    await waitFor(() => expect(getProject()).toBe(opened))
    expect(getUi()).toMatchObject({ floorId: null, activeTeamId: null, selectedAreaId: null })
    // What was just read from a file has no changes to export.
    expect(fileDot()).toBeNull()

    const toast = screen.getByText('Opened Test plan').closest('.toast')
    fireEvent.click(within(toast as HTMLElement).getByRole('button', { name: 'Undo' }))

    expect(getProject()).toBe(before)
  })

  it('gets the same plan back from a file it exported itself', async () => {
    renderBar()
    addExampleTeams()
    const firstTeam = getProject().teams[0]?.id ?? ''
    act(() => dispatch({ type: 'seat/set', teamId: firstTeam, areaId: 'f4-ne1', seats: 4, scope: 'all' }))
    const exported = getProject()
    chooseFromFileMenu('Export plan file')
    const text = (await downloads[0]?.blob.text()) ?? ''
    // A cleaned browser: the plan is gone, the file is what is left.
    act(() => projectStore.load(startingProject()))

    const input = screen.getByLabelText<HTMLInputElement>('Plan file to open')
    fireEvent.change(input, { target: { files: [new File([text], 'plan.json', { type: 'application/json' })] } })

    await waitFor(() => expect(getProject().teams).toHaveLength(10))
    expect(getProject()).toEqual(exported)
  })

  it('says why a file cannot be opened and leaves the plan alone', async () => {
    fake.parse = () => ({ ok: false, error: 'This is not a planner file.' })
    renderBar()
    const before = getProject()

    const input = screen.getByLabelText<HTMLInputElement>('Plan file to open')
    fireEvent.change(input, { target: { files: [new File(['hello'], 'notes.json')] } })

    const dialog = await screen.findByRole('dialog', { name: 'This file cannot be opened' })
    expect(within(dialog).getByText('This is not a planner file.')).toBeTruthy()
    expect(getProject()).toBe(before)

    const close = within(dialog).getAllByRole('button', { name: 'Close' })
    fireEvent.click(close[close.length - 1] as HTMLElement)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the print dialog', () => {
    renderBar()

    chooseFromFileMenu('Print')

    expect(getPrintState().dialogOpen).toBe(true)
  })

  it('starts over only after a confirmation, and can undo it', () => {
    renderBar()
    addExampleTeams()
    const before = getProject()
    act(() => setUi({ floorId: 'floor-4', activeTeamId: before.teams[0]?.id ?? null, selectedAreaId: 'f4-ne1' }))

    chooseFromFileMenu('Start over')
    let dialog = screen.getByRole('dialog', { name: 'Start over?' })
    expect(
      within(dialog).getByText(
        'This removes every team and every floor you added and brings back the starting floor. You can undo it.',
      ),
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getProject()).toBe(before)

    chooseFromFileMenu('Start over')
    dialog = screen.getByRole('dialog', { name: 'Start over?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start over' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getProject().teams).toHaveLength(0)
    expect(getProject().floors.map((each) => each.id)).toEqual(['floor-4'])
    expect(getUi()).toMatchObject({ floorId: null, activeTeamId: null, selectedAreaId: null })

    const toast = screen.getByText('Started over').closest('.toast')
    fireEvent.click(within(toast as HTMLElement).getByRole('button', { name: 'Undo' }))

    expect(getProject()).toBe(before)
  })
})
