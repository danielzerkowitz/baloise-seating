// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { suggestDayMoves, type DayMove } from '../../domain/dayMoves'
import { parseTeamsText, type ParsedTeamRow, type ParsedTeams } from '../../domain/files'
import { copyFloor } from '../../domain/model'
import { reduce } from '../../domain/reducer'
import { floor, project as testProject, row, team as testTeam, violations } from '../../domain/testkit'
import { WEEKDAYS, type Team } from '../../domain/types'
import { exampleTeams, startingProject } from '../../state/seed'
import { dispatch, getProject, projectStore, undo } from '../../state/store'
import { getUi, resetUi, setUi } from '../../state/ui'
import { ToastRegion } from '../primitives'
import { pasteSummary, planPaste } from './pasteTeams'
import { TeamsView } from './TeamsView'

// Two functions of the engine can be replaced per test: which team it proposes to move
// first, and how it reads a pasted line, are its business and not this view's. Unless a
// test says otherwise they are the engine's own.
vi.mock('../../domain/dayMoves', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../domain/dayMoves')>()
  return { ...original, suggestDayMoves: vi.fn() }
})
vi.mock('../../domain/files', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../domain/files')>()
  return { ...original, parseTeamsText: vi.fn() }
})
const engine = {
  ...(await vi.importActual<typeof import('../../domain/dayMoves')>('../../domain/dayMoves')),
  ...(await vi.importActual<typeof import('../../domain/files')>('../../domain/files')),
}

/** A plain stand-in for the engine's parser: "name; size; days; domain; ART", one team per line,
 *  days as English three-letter names. A line without a size is a problem. */
function readLines(text: string): ParsedTeams {
  const parsed: ParsedTeams = { rows: [], problems: [] }
  text.split('\n').forEach((lineText, index) => {
    const [name = '', size = '', days = '', domain = '', art = ''] = lineText.split(';').map((part) => part.trim())
    const line = index + 1
    if (name === '') return
    if (size === '') parsed.problems.push(`Line ${line}: no team size found for ${name}`)
    else {
      const listed = WEEKDAYS.filter((day) => days.toLowerCase().includes(day))
      parsed.rows.push({ name, size: Number(size), days: listed, domain, art, line })
    }
  })
  return parsed
}

/** The view as the app shows it: in strict mode, with the toasts next to it. */
function renderView() {
  render(
    <StrictMode>
      <TeamsView />
      <ToastRegion />
    </StrictMode>,
  )
  return userEvent.setup()
}

function addExampleTeams() {
  dispatch(exampleTeams(getProject()).action)
}

function teamNamed(name: string): Team {
  const found = getProject().teams.find((team) => team.name === name)
  if (!found) throw new Error(`There is no team called ${name}`)
  return found
}

/** The cell of a team on a weekday, e.g. dayCell('Claims Intake', 'Tuesday'). */
function dayCell(team: string, weekday: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${team}, ${weekday}:`) })
}

beforeEach(() => {
  projectStore.load(startingProject())
  resetUi()
  vi.mocked(suggestDayMoves).mockImplementation(engine.suggestDayMoves)
  vi.mocked(parseTeamsText).mockImplementation(engine.parseTeamsText)
})

afterEach(() => {
  // Toasts live outside the view; none may be left for the next test to find.
  for (const button of screen.queryAllByRole('button', { name: 'Dismiss' })) fireEvent.click(button)
  cleanup()
})

describe('without teams', () => {
  it('invites to add teams', () => {
    renderView()
    expect(screen.getByRole('heading', { name: 'Teams and days' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'No teams yet' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try with example teams' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    // The assumptions stay.
    expect(screen.getByLabelText('Expected attendance')).toBeTruthy()
    expect(screen.getByLabelText('Keep free')).toBeTruthy()
  })

  it('"Add team" shows the table with the focus in the row for a new team', async () => {
    const user = renderView()
    const [inHeader] = screen.getAllByRole('button', { name: 'Add team' })
    await user.click(inHeader!)
    expect(screen.getByRole('table', { name: 'Teams and their team days' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('New team'))
    expect(screen.queryByRole('heading', { name: 'No teams yet' })).toBeNull()
  })

  it('"Try with example teams" adds the examples and says so', async () => {
    const user = renderView()
    await user.click(screen.getByRole('button', { name: 'Try with example teams' }))
    expect(getProject().teams).toHaveLength(10)
    expect(screen.getByText('Added 10 example teams')).toBeTruthy()
    expect(screen.getAllByLabelText('Team name')).toHaveLength(10)
    // The button that was pressed is gone with the invitation; the focus is not.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add team' }))
  })

  it('has nothing to remove', async () => {
    const user = renderView()
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Remove all teams' })).toHaveProperty('disabled', true)
  })
})

describe('with the example teams', () => {
  beforeEach(addExampleTeams)

  it('shows every team, its week and how full each day gets', () => {
    renderView()
    const names = screen.getAllByLabelText<HTMLInputElement>('Team name').map((input) => input.value)
    expect(names).toEqual(getProject().teams.map((team) => team.name))

    // Tuesday is wanted by eight teams with 69 people; the floor has 66 desks.
    expect(screen.getByRole('img', { name: 'Tuesday: 69 seats needed, 66 desks to plan with' })).toBeTruthy()
    expect(screen.getByText('needs overflow seats')).toBeTruthy()
    expect(screen.getByText('52 free')).toBeTruthy()

    expect(dayCell('Claims Intake', 'Tuesday').getAttribute('aria-label')).toBe(
      'Claims Intake, Tuesday: planned team day, wanted, not seated yet',
    )
    expect(dayCell('Claims Intake', 'Tuesday').getAttribute('aria-pressed')).toBe('true')
    expect(dayCell('Claims Intake', 'Wednesday').getAttribute('aria-label')).toBe(
      'Claims Intake, Wednesday: not planned, could also come',
    )
    expect(dayCell('Claims Intake', 'Friday').getAttribute('aria-label')).toBe(
      'Claims Intake, Friday: not planned, not asked',
    )
    expect(screen.getAllByText('Not seated yet')).toHaveLength(10)
    expect(screen.getByText('Click a day to switch it on or off. Right-click for more.')).toBeTruthy()
    // One floor: nobody is asked which floor they prefer.
    expect(screen.queryByRole('columnheader', { name: 'Floor' })).toBeNull()
  })

  it('describes where a team sits and how far its seating is', () => {
    const intake = teamNamed('Claims Intake')
    dispatch({ type: 'seat/set', teamId: intake.id, areaId: 'f4-nw1', seats: 6, scope: 'all' })
    dispatch({ type: 'seat/set', teamId: intake.id, areaId: 'f4-ne1', seats: 1, scope: 'thu' })
    renderView()
    expect(dayCell('Claims Intake', 'Tuesday').getAttribute('aria-label')).toBe(
      'Claims Intake, Tuesday: planned team day, wanted, 6 of 9 seats',
    )
    expect(within(dayCell('Claims Intake', 'Tuesday')).getByText('6/9')).toBeTruthy()
    expect(dayCell('Claims Intake', 'Thursday').getAttribute('aria-label')).toBe(
      'Claims Intake, Thursday: planned team day, wanted, 7 of 9 seats',
    )
    // "Where" is the normal seating; the day that differs is named.
    expect(screen.getByRole('button', { name: 'Floor 4: NW 1' })).toBeTruthy()
    expect(screen.getByText('differs on Thu')).toBeTruthy()
  })

  describe('a day cell', () => {
    it('switches a day on and off with a click', async () => {
      const user = renderView()
      await user.click(dayCell('Claims Intake', 'Monday'))
      expect(teamNamed('Claims Intake').days).toEqual(['mon', 'tue', 'thu'])
      expect(teamNamed('Claims Intake').wishes.mon).toBe('want')

      await user.click(dayCell('Claims Intake', 'Monday'))
      expect(teamNamed('Claims Intake').days).toEqual(['tue', 'thu'])
      expect(teamNamed('Claims Intake').wishes.mon).toBe('none')
      expect(violations(getProject())).toEqual([])
    })

    it('keeps what the team said when a day the planner chose is switched off', async () => {
      const intake = teamNamed('Claims Intake')
      dispatch({ type: 'team/setPlanned', id: intake.id, day: 'wed', planned: true })
      const user = renderView()
      expect(dayCell('Claims Intake', 'Wednesday').getAttribute('aria-label')).toBe(
        'Claims Intake, Wednesday: planned team day, could also come, not seated yet',
      )
      await user.click(dayCell('Claims Intake', 'Wednesday'))
      expect(teamNamed('Claims Intake').days).toEqual(['tue', 'thu'])
      expect(teamNamed('Claims Intake').wishes.wed).toBe('can')
    })

    it('plans a wanted day that was taken off the plan without touching the wish', async () => {
      const intake = teamNamed('Claims Intake')
      dispatch({ type: 'team/setPlanned', id: intake.id, day: 'tue', planned: false })
      const user = renderView()
      expect(dayCell('Claims Intake', 'Tuesday').getAttribute('aria-label')).toBe(
        'Claims Intake, Tuesday: not planned, wanted',
      )
      await user.click(dayCell('Claims Intake', 'Tuesday'))
      expect(teamNamed('Claims Intake').days).toEqual(['tue', 'thu'])
      expect(teamNamed('Claims Intake').wishes.tue).toBe('want')
    })

    it('records what the team said with the letter keys', async () => {
      const user = renderView()
      dayCell('Claims Intake', 'Friday').focus()
      await user.keyboard('x')
      expect(teamNamed('Claims Intake').wishes.fri).toBe('cannot')
      await user.keyboard('c')
      expect(teamNamed('Claims Intake').wishes.fri).toBe('can')
      await user.keyboard('w')
      expect(teamNamed('Claims Intake').wishes.fri).toBe('want')
      expect(teamNamed('Claims Intake').days).toEqual(['tue', 'thu', 'fri'])
      await user.keyboard('n')
      expect(teamNamed('Claims Intake').wishes.fri).toBe('none')
      expect(teamNamed('Claims Intake').days).toEqual(['tue', 'thu'])
    })

    it('opens a menu on right click, with what the team said and the ways to move the day', async () => {
      const user = renderView()
      fireEvent.contextMenu(dayCell('Claims Intake', 'Tuesday'))
      const menu = screen.getByRole('menu', { name: 'Claims Intake on Tuesday' })
      const labels = within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
      expect(labels).toEqual([
        'Wants this dayW',
        'Could also comeC',
        'Not askedN',
        'Cannot comeX',
        'Take off the plan',
        'Move this team day to Monday',
        'Move this team day to Wednesday',
        'Move this team day to Friday',
        'Show on the plan',
      ])
      expect(within(menu).getByRole('menuitem', { name: 'Wants this day' }).getAttribute('aria-current')).toBe('true')
      expect(within(menu).getByRole('menuitem', { name: 'Cannot come' }).getAttribute('aria-current')).toBeNull()

      await user.click(within(menu).getByRole('menuitem', { name: 'Move this team day to Friday' }))
      expect(teamNamed('Claims Intake').days).toEqual(['thu', 'fri'])
      // The wishes stay: Tuesday is now a wanted day that is not planned.
      expect(teamNamed('Claims Intake').wishes.tue).toBe('want')
      expect(screen.queryByRole('menu')).toBeNull()
      expect(screen.getByText('Moved Claims Intake from Tuesday to Friday')).toBeTruthy()
      expect(document.activeElement).toBe(dayCell('Claims Intake', 'Tuesday'))
    })

    it('offers less for a day that is not planned', () => {
      renderView()
      fireEvent.contextMenu(dayCell('Claims Intake', 'Friday'))
      const labels = screen.getAllByRole('menuitem').map((item) => item.textContent)
      expect(labels).toEqual(['Wants this dayW', 'Could also comeC', 'Not askedN', 'Cannot comeX', 'Plan this day'])
    })

    it('sets what the team said from the menu, also with its letter', async () => {
      const user = renderView()
      fireEvent.contextMenu(dayCell('Claims Intake', 'Friday'))
      await user.click(screen.getByRole('menuitem', { name: 'Cannot come' }))
      expect(teamNamed('Claims Intake').wishes.fri).toBe('cannot')

      fireEvent.contextMenu(dayCell('Claims Intake', 'Friday'))
      await user.keyboard('c')
      expect(teamNamed('Claims Intake').wishes.fri).toBe('can')
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('plans a day against what the team said, and shows that', async () => {
      const intake = teamNamed('Claims Intake')
      dispatch({ type: 'team/setWish', id: intake.id, day: 'fri', wish: 'cannot' })
      const user = renderView()
      fireEvent.contextMenu(dayCell('Claims Intake', 'Friday'))
      await user.click(screen.getByRole('menuitem', { name: 'Plan this day' }))
      expect(teamNamed('Claims Intake').days).toEqual(['tue', 'thu', 'fri'])
      expect(teamNamed('Claims Intake').wishes.fri).toBe('cannot')
      expect(dayCell('Claims Intake', 'Friday').getAttribute('aria-label')).toBe(
        'Claims Intake, Friday: planned team day, cannot come, not seated yet',
      )
    })

    it('takes a wanted day off the plan and keeps the wish', async () => {
      const user = renderView()
      fireEvent.contextMenu(dayCell('Claims Intake', 'Tuesday'))
      await user.click(screen.getByRole('menuitem', { name: 'Take off the plan' }))
      expect(teamNamed('Claims Intake').days).toEqual(['thu'])
      expect(teamNamed('Claims Intake').wishes.tue).toBe('want')
    })

    it('works the menu from the keyboard and gives the focus back to the cell', async () => {
      const user = renderView()
      const cell = dayCell('Claims Intake', 'Tuesday')
      cell.focus()
      await user.keyboard('{Shift>}{F10}{/Shift}')
      const items = screen.getAllByRole('menuitem')
      expect(document.activeElement).toBe(items[0])
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(items[1])
      await user.keyboard('{ArrowUp}{ArrowUp}')
      expect(document.activeElement).toBe(items[items.length - 1])
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(cell)
      // The arrow keys in the menu did not move anything in the table.
      expect(teamNamed('Claims Intake').days).toEqual(['tue', 'thu'])
    })

    it('leaves the menu with Tab and carries on from the cell', async () => {
      const user = renderView()
      dayCell('Claims Intake', 'Tuesday').focus()
      await user.keyboard('{ContextMenu}')
      expect(screen.getByRole('menu')).toBeTruthy()
      await user.tab()
      expect(screen.queryByRole('menu')).toBeNull()
      // The small menu button in the cell is not a stop: the next stop is the next day.
      expect(document.activeElement).toBe(dayCell('Claims Intake', 'Wednesday'))
    })

    it('opens the menu from the small button in the cell and closes it on a press elsewhere', async () => {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'More for Claims Intake on Tuesday' }))
      expect(screen.getByRole('menu', { name: 'Claims Intake on Tuesday' })).toBeTruthy()
      await user.click(screen.getByRole('heading', { name: 'Teams and days' }))
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('shows the team on the plan', async () => {
      const user = renderView()
      fireEvent.contextMenu(dayCell('Claims Intake', 'Thursday'))
      await user.click(screen.getByRole('menuitem', { name: 'Show on the plan' }))
      const ui = getUi()
      expect(ui.view).toBe('plan')
      expect(ui.day).toBe('thu')
      expect(ui.activeTeamId).toBe(teamNamed('Claims Intake').id)
      expect(ui.spotlight?.teamId).toBe(teamNamed('Claims Intake').id)
    })

    it('moves the focus between the cells with the arrow keys', async () => {
      const user = renderView()
      dayCell('Claims Intake', 'Tuesday').focus()
      await user.keyboard('{ArrowRight}')
      expect(document.activeElement).toBe(dayCell('Claims Intake', 'Wednesday'))
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(dayCell('Claims Handling', 'Wednesday'))
      await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}')
      expect(document.activeElement).toBe(dayCell('Claims Handling', 'Monday'))
      await user.keyboard('{ArrowUp}{ArrowUp}')
      expect(document.activeElement).toBe(dayCell('Claims Intake', 'Monday'))

      // Below the last team are the day buttons of the row for a new team.
      dayCell('Architecture', 'Friday').focus()
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Friday for the new team' }))
    })
  })

  describe('a team row', () => {
    it('edits name, code, domain, ART and size', async () => {
      const user = renderView()
      const id = teamNamed('Claims Intake').id
      const current = () => getProject().teams.find((team) => team.id === id)!

      const name = screen.getByDisplayValue('Claims Intake')
      await user.clear(name)
      await user.type(name, 'Claims Desk')
      expect(current().name).toBe('Claims Desk')

      const code = screen.getByLabelText('Code of Claims Desk')
      await user.clear(code)
      await user.type(code, 'DESKS')
      expect(current().code).toBe('DESK')

      const domainOf = (name: string) => getProject().domains.find((domain) => domain.name === name)?.id
      const artOf = (name: string) => getProject().arts.find((art) => art.name === name)?.id
      expect(current()).toMatchObject({ domainId: domainOf('Non-Life'), artId: artOf('Claims ART') })
      // Another domain takes the team off its ART, which is in the old one.
      await user.selectOptions(screen.getByLabelText('Domain of Claims Desk'), 'Digital')
      expect(current()).toMatchObject({ domainId: domainOf('Digital'), artId: null })
      await user.selectOptions(screen.getByLabelText('ART of Claims Desk'), 'Digital Channels')
      expect(current()).toMatchObject({ domainId: domainOf('Digital'), artId: artOf('Digital Channels') })
      // A domain without an ART, as a management team has.
      await user.selectOptions(screen.getByLabelText('Domain of Claims Desk'), 'Corporate')
      expect(current()).toMatchObject({ domainId: domainOf('Corporate'), artId: null })

      const people = screen.getByLabelText<HTMLInputElement>('People in Claims Desk')
      await user.clear(people)
      // An emptied field is not a team of nobody.
      expect(current().size).toBe(9)
      await user.type(people, '14')
      expect(current().size).toBe(14)
      expect(screen.getByRole('button', { name: 'Seats for Claims Desk: 14' })).toBeTruthy()
      expect(violations(getProject())).toEqual([])
    })

    it('shows the stored size again when the field is left empty', async () => {
      const user = renderView()
      const people = screen.getByLabelText<HTMLInputElement>('People in Claims Intake')
      await user.clear(people)
      await user.tab()
      expect(people.value).toBe('9')
      expect(teamNamed('Claims Intake').size).toBe(9)
    })

    it('follows an undo that happens while a size is being typed, and does not redo it on leaving', async () => {
      const user = renderView()
      const people = screen.getByLabelText<HTMLInputElement>('People in Claims Intake')
      await user.clear(people)
      await user.type(people, '14')
      expect(teamNamed('Claims Intake').size).toBe(14)
      act(() => undo())
      expect(teamNamed('Claims Intake').size).toBe(9)
      expect(people.value).toBe('9')
      await user.tab()
      expect(teamNamed('Claims Intake').size).toBe(9)
    })

    it('puts the focus in the name of a team that asks for it', () => {
      const handling = teamNamed('Claims Handling')
      setUi({ focusTeamId: handling.id })
      renderView()
      expect(document.activeElement).toBe(screen.getByDisplayValue('Claims Handling'))
      expect(getUi().focusTeamId).toBeNull()
    })

    it('sets a colour from the picker', async () => {
      const user = renderView()
      const swatch = screen.getByRole('button', { name: 'Colour of Claims Intake' })
      await user.click(swatch)
      const picker = screen.getByRole('dialog', { name: 'Colour of Claims Intake' })
      await user.click(within(picker).getByRole('button', { name: 'Colour #3f6c8f' }))
      expect(teamNamed('Claims Intake').color).toBe('#3f6c8f')
      expect(screen.queryByRole('dialog', { name: 'Colour of Claims Intake' })).toBeNull()
      expect(document.activeElement).toBe(swatch)
    })

    it('closes the picker on Escape and when the focus is tabbed out of it', async () => {
      const user = renderView()
      const swatch = screen.getByRole('button', { name: 'Colour of Claims Intake' })
      await user.click(swatch)
      // The focus starts on the colour the team has.
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Colour #0f8b8d', pressed: true }))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog', { name: 'Colour of Claims Intake' })).toBeNull()
      expect(document.activeElement).toBe(swatch)
      expect(teamNamed('Claims Intake').color).toBe('#0f8b8d')

      await user.click(swatch)
      screen.getByLabelText('Hex colour').focus()
      await user.tab()
      expect(screen.queryByRole('dialog', { name: 'Colour of Claims Intake' })).toBeNull()
      // On from the swatch, as if the picker stood right behind it.
      expect(document.activeElement).toBe(screen.getByDisplayValue('Claims Intake'))
    })

    it('lets a hex colour be typed to the end before the picker closes', async () => {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'Colour of Claims Intake' }))
      const hex = screen.getByLabelText<HTMLInputElement>('Hex colour')
      await user.clear(hex)
      await user.type(hex, '#12ab9f')
      expect(hex.value).toBe('#12ab9f')
      expect(teamNamed('Claims Intake').color).toBe('#12ab9f')
      await user.keyboard('{Enter}')
      expect(screen.queryByRole('dialog', { name: 'Colour of Claims Intake' })).toBeNull()
    })

    it('gives a team its own expected attendance and takes it back', async () => {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'Seats for Claims Intake: 9' }))
      const popover = screen.getByRole('dialog', { name: 'Expected attendance for Claims Intake' })
      const field = within(popover).getByRole<HTMLInputElement>('spinbutton')
      expect(document.activeElement).toBe(field)
      expect(field.value).toBe('100')
      await user.clear(field)
      await user.type(field, '50')
      expect(teamNamed('Claims Intake').attendance).toBe(0.5)
      expect(screen.getByRole('button', { name: 'Seats for Claims Intake: 5, at 50%' })).toBeTruthy()

      await user.click(within(popover).getByRole('button', { name: "Use the plan's setting" }))
      expect(teamNamed('Claims Intake').attendance).toBeNull()
      expect(screen.queryByRole('dialog', { name: 'Expected attendance for Claims Intake' })).toBeNull()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Seats for Claims Intake: 9' }))
    })

    it('closes the attendance of a team on Enter and stays closed', async () => {
      const user = renderView()
      const seats = screen.getByRole('button', { name: 'Seats for Claims Intake: 9' })
      await user.click(seats)
      await user.keyboard('{Enter}')
      expect(screen.queryByRole('dialog', { name: 'Expected attendance for Claims Intake' })).toBeNull()
      expect(document.activeElement).toBe(seats)
    })

    it('duplicates a team and asks for the name of the copy', async () => {
      const intake = teamNamed('Claims Intake')
      dispatch({ type: 'team/moveDay', id: intake.id, from: 'thu', to: 'wed' })
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'More for Claims Intake' }))
      await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))

      const copy = teamNamed('Claims Intake copy')
      const original = teamNamed('Claims Intake')
      expect(copy.id).not.toBe(original.id)
      expect(copy.size).toBe(9)
      expect(copy.domainId).toBe(original.domainId)
      expect(copy.artId).toBe(original.artId)
      expect(copy.artId).not.toBeNull()
      expect(copy.days).toEqual(['tue', 'wed'])
      expect(copy.wishes).toEqual(original.wishes)
      expect(copy.seating).toEqual({})
      expect(copy.code).not.toBe(original.code)
      expect(document.activeElement).toBe(screen.getByDisplayValue('Claims Intake copy'))
      expect(violations(getProject())).toEqual([])
    })

    it('removes a team, says so, and takes it back with Undo', async () => {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'More for Claims Intake' }))
      await user.click(screen.getByRole('menuitem', { name: 'Remove team' }))
      expect(getProject().teams.map((team) => team.name)).not.toContain('Claims Intake')
      expect(getProject().teams).toHaveLength(9)
      // The focus went on to the next row instead of getting lost with the removed one.
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More for Claims Handling' }))

      const toast = screen.getByText('Removed Claims Intake').closest('.toast') as HTMLElement
      await user.click(within(toast).getByRole('button', { name: 'Undo' }))
      expect(getProject().teams.map((team) => team.name)).toContain('Claims Intake')
    })

    it('saves notes and shows that a team has some', async () => {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'More for Claims Intake' }))
      await user.click(screen.getByRole('menuitem', { name: 'Notes' }))
      const dialog = screen.getByRole('dialog', { name: 'Notes for Claims Intake' })
      await user.type(within(dialog).getByLabelText('Notes'), 'Needs two standing desks')
      // Nothing is saved before "Save notes".
      expect(teamNamed('Claims Intake').notes).toBe('')
      await user.click(within(dialog).getByRole('button', { name: 'Save notes' }))
      expect(teamNamed('Claims Intake').notes).toBe('Needs two standing desks')
      expect(screen.getByRole('button', { name: 'Notes for Claims Intake' }).getAttribute('title')).toBe(
        'Needs two standing desks',
      )
    })

    it('opens the plan to seat a team', async () => {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'More for Underwriting' }))
      await user.click(screen.getByRole('menuitem', { name: 'Seat on the plan' }))
      const ui = getUi()
      expect(ui.view).toBe('plan')
      // Underwriting's first team day.
      expect(ui.day).toBe('tue')
      expect(ui.activeTeamId).toBe(teamNamed('Underwriting').id)
    })
  })

  describe('the row for a new team', () => {
    it('adds a team on Enter and is ready for the next one', async () => {
      const user = renderView()
      const name = screen.getByPlaceholderText<HTMLInputElement>('New team')
      const people = screen.getByPlaceholderText<HTMLInputElement>('People')
      await user.type(name, '  Fraud Desk ')
      await user.type(people, '7')
      await user.click(screen.getByRole('button', { name: 'Tuesday for the new team' }))
      await user.click(screen.getByRole('button', { name: 'Thursday for the new team' }))
      await user.type(people, '{Enter}')

      const added = teamNamed('Fraud Desk')
      expect(added.size).toBe(7)
      expect(added.days).toEqual(['tue', 'thu'])
      expect(added.wishes).toEqual({ mon: 'none', tue: 'want', wed: 'none', thu: 'want', fri: 'none' })
      expect(getProject().teams[getProject().teams.length - 1]).toBe(added)

      expect(name.value).toBe('')
      expect(people.value).toBe('')
      const tuesday = screen.getByRole('button', { name: 'Tuesday for the new team' })
      expect(tuesday.getAttribute('aria-pressed')).toBe('false')
      expect(document.activeElement).toBe(name)
      expect(violations(getProject())).toEqual([])
    })

    it('asks for a name and takes one person when no size is given', async () => {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'Add' }))
      expect(getProject().teams).toHaveLength(10)
      const name = screen.getByPlaceholderText<HTMLInputElement>('New team')
      expect(screen.getByRole('alert').textContent).toBe('Give the team a name')
      expect(name.getAttribute('aria-invalid')).toBe('true')
      expect(document.activeElement).toBe(name)

      await user.type(name, 'Solo')
      expect(screen.queryByRole('alert')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Add' }))
      expect(teamNamed('Solo').size).toBe(1)
      expect(teamNamed('Solo').days).toEqual([])
    })
  })

  describe('the header', () => {
    it('removes all teams as one step that Undo takes back', async () => {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'More' }))
      await user.click(screen.getByRole('menuitem', { name: 'Remove all teams' }))
      expect(getProject().teams).toEqual([])
      expect(screen.getByText('Removed all teams')).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'No teams yet' })).toBeTruthy()

      act(() => undo())
      expect(getProject().teams).toHaveLength(10)
      expect(screen.getAllByLabelText('Team name')).toHaveLength(10)
    })

    it('adds the example teams once more from the menu', async () => {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'More' }))
      await user.click(screen.getByRole('menuitem', { name: 'Add example teams' }))
      expect(getProject().teams).toHaveLength(20)
      expect(violations(getProject())).toEqual([])
    })

  })

  describe('the assumptions', () => {
    it('plans seats for the expected attendance', async () => {
      const user = renderView()
      const attendance = screen.getByLabelText<HTMLInputElement>('Expected attendance')
      expect(attendance.value).toBe('100')
      await user.clear(attendance)
      await user.type(attendance, '8')
      // "8" on the way to "80" is below the range: nothing changes yet.
      expect(getProject().settings.attendance).toBe(1)
      await user.type(attendance, '0')
      expect(getProject().settings.attendance).toBe(0.8)
      // 9 people at 80% need 8 seats.
      expect(screen.getByRole('button', { name: 'Seats for Claims Intake: 8' })).toBeTruthy()
    })

    it('pulls a number outside the range into it when the field is left', async () => {
      const user = renderView()
      const attendance = screen.getByLabelText<HTMLInputElement>('Expected attendance')
      await user.clear(attendance)
      await user.type(attendance, '5')
      await user.tab()
      expect(getProject().settings.attendance).toBe(0.1)
      expect(attendance.value).toBe('10')
    })

    it('holds desks back', async () => {
      const user = renderView()
      const reserve = screen.getByLabelText<HTMLInputElement>('Keep free')
      await user.clear(reserve)
      await user.type(reserve, '10')
      expect(getProject().settings.reserve).toBe(0.1)
      // 66 desks, a tenth kept free: 59 to plan with.
      expect(screen.getByRole('img', { name: 'Monday: 14 seats needed, 59 desks to plan with' })).toBeTruthy()
    })
  })

  describe('a day that is too full', () => {
    it('offers to move a team and moves it', async () => {
      const portal = teamNamed('Customer Portal')
      const move: DayMove = {
        teamId: portal.id,
        from: 'tue',
        to: 'wed',
        seats: 7,
        fromAfter: 62,
        toAfter: 35,
        agreed: false,
        resolves: true,
        reason: 'Wednesday has 38 desks free',
      }
      vi.mocked(suggestDayMoves).mockImplementation((_project, day) => (day === 'tue' ? [move] : []))
      const user = renderView()
      const button = screen.getByRole('button', { name: 'Move Customer Portal to Wed, ask first' })
      expect(button.getAttribute('title')).toBe('Wednesday has 38 desks free')
      await user.click(button)

      expect(teamNamed('Customer Portal').days).toEqual(['wed', 'thu'])
      expect(screen.getByText('Moved Customer Portal from Tuesday to Wednesday')).toBeTruthy()
      // Tuesday fits now, so there is nothing more to suggest. The focus stays with Tuesday's numbers.
      expect(screen.queryByRole('button', { name: /^Move Customer Portal/ })).toBeNull()
      const tuesday = screen.getByRole('img', { name: 'Tuesday: 62 seats needed, 66 desks to plan with' }).closest('td')
      expect(document.activeElement).toBe(tuesday)
      expect(tuesday?.textContent).toContain('4 free')
    })

    it('goes on to the next suggestion while the day is still too full', async () => {
      const moves: DayMove[] = ['Data Platform', 'Customer Portal'].map((name) => ({
        teamId: teamNamed(name).id,
        from: 'tue',
        to: 'fri',
        seats: 1,
        fromAfter: 68,
        toAfter: 12,
        agreed: true,
        resolves: false,
        reason: 'Friday has room',
      }))
      vi.mocked(suggestDayMoves).mockImplementation((project, day) => {
        // Whoever is still in on Tuesday can still be moved.
        const inOnTuesday = (id: string) => project.teams.some((team) => team.id === id && team.days.includes('tue'))
        return day === 'tue' ? moves.filter((move) => inOnTuesday(move.teamId)) : []
      })
      // 80 people want Tuesday now: moving one team away does not make it fit.
      dispatch({ type: 'team/update', id: teamNamed('Claims Handling').id, patch: { size: 23 } })
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'Move Data Platform to Fri' }))
      expect(teamNamed('Data Platform').days).toEqual(['wed', 'fri'])
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Customer Portal to Fri' }))
    })

    it('shows whatever the engine suggests for it', () => {
      renderView()
      const suggestions = suggestDayMoves(getProject(), 'tue', 3)
      const list = screen.queryByRole('list', { name: 'Ways to relieve Tuesday' })
      if (suggestions.length === 0) expect(list).toBeNull()
      else expect(within(list!).getAllByRole('button')).toHaveLength(suggestions.length)
    })
  })

  describe('with a second floor', () => {
    beforeEach(() => {
      const first = getProject().floors[0]!
      dispatch({ type: 'floor/add', floor: copyFloor(first, 'Floor 5') })
    })

    it('asks which floor a team prefers', async () => {
      const user = renderView()
      expect(screen.getByRole('columnheader', { name: 'Floor' })).toBeTruthy()
      const select = screen.getByLabelText<HTMLSelectElement>('Preferred floor of Claims Intake')
      expect(select.value).toBe('')
      await user.selectOptions(select, 'Floor 5')
      const floor5 = getProject().floors[1]!
      expect(teamNamed('Claims Intake').homeFloorId).toBe(floor5.id)
      await user.selectOptions(select, 'No preference')
      expect(teamNamed('Claims Intake').homeFloorId).toBeNull()
    })

    it('opens the plan on the floor where the team sits', async () => {
      const floor5 = getProject().floors[1]!
      const desks = floor5.areas.find((area) => area.kind === 'desks')!
      dispatch({ type: 'seat/set', teamId: teamNamed('Underwriting').id, areaId: desks.id, seats: 4, scope: 'all' })
      const user = renderView()
      await user.click(screen.getByRole('button', { name: `Floor 5: ${desks.name}` }))
      const ui = getUi()
      expect(ui.view).toBe('plan')
      expect(ui.floorId).toBe(floor5.id)
      expect(ui.day).toBe('tue')
      expect(ui.activeTeamId).toBe(teamNamed('Underwriting').id)
    })
  })

  describe('pasting teams', () => {
    beforeEach(() => {
      vi.mocked(parseTeamsText).mockImplementation(readLines)
    })

    async function openDialog() {
      const user = renderView()
      await user.click(screen.getByRole('button', { name: 'Paste from a spreadsheet' }))
      const dialog = screen.getByRole('dialog', { name: 'Paste teams from a spreadsheet' })
      return { user, dialog, text: within(dialog).getByLabelText('List of teams') }
    }

    it('has nothing to do for an empty text', async () => {
      const { dialog, text } = await openDialog()
      expect(document.activeElement).toBe(text)
      expect(within(dialog).getByRole('button', { name: 'Add teams' })).toHaveProperty('disabled', true)
      expect(within(dialog).getByLabelText<HTMLInputElement>('Update teams that already exist').checked).toBe(true)
    })

    it('adds new teams and updates the ones that exist, as one step', async () => {
      const { user, dialog, text } = await openDialog()
      fireEvent.change(text, { target: { value: 'Fraud Desk; 5; Tue Thu; Non-Life; Claims ART\nclaims intake; 12; Mon' } })

      const preview = within(dialog).getByRole('table', { name: 'Teams found in the text' })
      const cells = within(preview)
        .getAllByRole('row')
        .slice(1)
        .map((line) => within(line).getAllByRole('cell').map((cell) => cell.textContent))
      expect(cells).toEqual([
        ['Fraud Desk', '5', 'Tue, Thu', 'Non-Life', 'Claims ART', 'New team'],
        ['claims intake', '12', 'Mon', '', '', 'Updates the team in the plan'],
      ])

      await user.click(within(dialog).getByRole('button', { name: 'Add 1 team and update 1' }))
      expect(screen.queryByRole('dialog', { name: 'Paste teams from a spreadsheet' })).toBeNull()
      expect(screen.getByText('Added 1 team and updated 1')).toBeTruthy()

      const added = teamNamed('Fraud Desk')
      expect(added.size).toBe(5)
      expect(added.days).toEqual(['tue', 'thu'])
      const intake = teamNamed('Claims Intake')
      // Joins the ART that is there; nothing is made twice.
      expect(added).toMatchObject({ domainId: intake.domainId, artId: intake.artId })
      expect(getProject().arts.filter((art) => art.name === 'Claims ART')).toHaveLength(1)

      expect(intake.size).toBe(12)
      // No domain or ART in the row: the team keeps its own. The days are exactly the pasted
      // ones; what the team said about other days stays.
      expect(intake.artId).not.toBeNull()
      expect(intake.wishes).toEqual({ mon: 'want', tue: 'none', wed: 'can', thu: 'none', fri: 'none' })
      expect(intake.days).toEqual(['mon'])
      expect(violations(getProject())).toEqual([])

      act(() => undo())
      expect(getProject().teams).toHaveLength(10)
      expect(teamNamed('Claims Intake').size).toBe(9)
      expect(teamNamed('Claims Intake').days).toEqual(['tue', 'thu'])
    })

    it('leaves existing teams alone when asked to', async () => {
      const { user, dialog, text } = await openDialog()
      fireEvent.change(text, { target: { value: 'Fraud Desk; 5; Tue Thu; Claims\nClaims Intake; 12; Mon' } })
      await user.click(within(dialog).getByLabelText('Update teams that already exist'))
      expect(within(dialog).getByText('Already in the plan, left as it is')).toBeTruthy()
      await user.click(within(dialog).getByRole('button', { name: 'Add 1 team' }))
      expect(getProject().teams).toHaveLength(11)
      expect(teamNamed('Claims Intake').size).toBe(9)
      expect(screen.getByText('Added 1 team')).toBeTruthy()
    })

    it('lists the lines it could not use', async () => {
      const { dialog, text } = await openDialog()
      fireEvent.change(text, { target: { value: 'Fraud Desk; 5\nNo size here' } })
      expect(within(dialog).getByText('1 line could not be used')).toBeTruthy()
      expect(within(dialog).getByText('Line 2: no team size found for No size here')).toBeTruthy()
      expect(within(dialog).getByRole('button', { name: 'Add 1 team' })).toHaveProperty('disabled', false)
    })

    it('says so when it finds no team in the text', async () => {
      vi.mocked(parseTeamsText).mockReturnValue({ rows: [], problems: [] })
      const { dialog, text } = await openDialog()
      fireEvent.change(text, { target: { value: 'something' } })
      expect(within(dialog).getByText(/^No teams found in this text\./)).toBeTruthy()
      expect(within(dialog).getByRole('button', { name: 'Add teams' })).toHaveProperty('disabled', true)
    })

    it('shows whatever the engine reads from the text', async () => {
      vi.mocked(parseTeamsText).mockImplementation(engine.parseTeamsText)
      const pasted = 'Fraud Desk; 5; Tue Thu; Claims\nNo size here'
      const read = engine.parseTeamsText(pasted)
      const { dialog, text } = await openDialog()
      fireEvent.change(text, { target: { value: pasted } })
      const preview = within(dialog).queryByRole('table', { name: 'Teams found in the text' })
      const lines = preview ? within(preview).getAllByRole('row').slice(1) : []
      expect(lines.map((line) => within(line).getAllByRole('cell')[0]?.textContent)).toEqual(
        read.rows.map((team) => team.name),
      )
      for (const problem of read.problems) expect(within(dialog).getByText(problem)).toBeTruthy()
    })

    it('is empty again the next time it opens', async () => {
      const { user, dialog, text } = await openDialog()
      fireEvent.change(text, { target: { value: 'Fraud Desk; 5' } })
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(getProject().teams).toHaveLength(10)
      await user.click(screen.getByRole('button', { name: 'Paste from a spreadsheet' }))
      const again = screen.getByRole('dialog', { name: 'Paste teams from a spreadsheet' })
      expect(within(again).getByLabelText<HTMLTextAreaElement>('List of teams').value).toBe('')
    })
  })
})

describe('with a single team', () => {
  beforeEach(() => dispatch({ type: 'team/add', team: testTeam('solo', 4, ['mon']) }))

  it('keeps the table when that team is removed from its row', async () => {
    const user = renderView()
    await user.click(screen.getByRole('button', { name: 'More for Solo' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove team' }))
    expect(getProject().teams).toEqual([])
    expect(screen.getByRole('table', { name: 'Teams and their team days' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('New team'))
  })

  it('shows nothing under "Where" while the team has no team day', async () => {
    const user = renderView()
    expect(screen.getByRole('button', { name: 'Not seated yet' })).toBeTruthy()
    await user.click(dayCell('Solo', 'Monday'))
    expect(getProject().teams[0]?.days).toEqual([])
    expect(screen.queryByRole('button', { name: 'Not seated yet' })).toBeNull()
  })
})

describe('planPaste', () => {
  function pasted(name: string, size: number, days: ParsedTeamRow['days'] = [], domain = '', art = '', line = 1): ParsedTeamRow {
    return { name, size, days, domain, art, line }
  }
  const plan = () =>
    testProject(
      [floor('f1', row(['a', 'b'], 6))],
      [
        testTeam('alpha', 8, ['tue', 'thu'], { a: 6 }, { domainId: 'claims' }),
        testTeam('beta', 5, ['mon'], {}, { color: '#e2711d' }),
      ],
    )

  it('adds what is new, with colours and codes that differ from each other', () => {
    const before = plan()
    const result = planPaste(before, [pasted('Gamma One', 4, ['wed']), pasted('Gamma Two', 6)], true)
    expect(result.rows.map((planned) => planned.effect)).toEqual(['add', 'add'])
    expect(result.added).toBe(2)
    expect(result.updated).toBe(0)
    const after = reduce(before, { type: 'batch', actions: result.actions })
    const [one, two] = after.teams.slice(2)
    expect(one?.name).toBe('Gamma One')
    expect(one?.days).toEqual(['wed'])
    expect(two?.size).toBe(6)
    expect(one?.code).not.toBe(two?.code)
    expect(new Set(after.teams.map((team) => team.color)).size).toBe(4)
    expect(violations(after)).toEqual([])
  })

  it('updates a team of the same name: size, domain and ART when given, and exactly the given days', () => {
    const before = plan()
    const result = planPaste(before, [pasted(' ALPHA ', 10, ['wed', 'thu'], 'Policy', 'Policy ART')], true)
    expect(result.rows.map((planned) => planned.effect)).toEqual(['update'])
    expect(result.added).toBe(0)
    expect(result.updated).toBe(1)
    const after = reduce(before, { type: 'batch', actions: result.actions })
    const alpha = after.teams[0]
    expect(alpha?.size).toBe(10)
    // Domain and ART are made, as part of the same edit.
    expect(after.domains.map((domain) => domain.name)).toEqual(['claims', 'Policy'])
    expect(after.arts).toEqual([{ id: alpha?.artId, name: 'Policy ART', domainId: alpha?.domainId }])
    expect(after.domains.find((domain) => domain.id === alpha?.domainId)?.name).toBe('Policy')
    expect(violations(after)).toEqual([])
    expect(alpha?.wishes).toEqual({ mon: 'none', tue: 'none', wed: 'want', thu: 'want', fri: 'none' })
    expect(alpha?.days).toEqual(['wed', 'thu'])
    // The seats the team holds are not touched.
    expect(alpha?.seating).toEqual({ a: 6 })
  })

  it('keeps domain, ART and days that the row does not mention', () => {
    const before = plan()
    const result = planPaste(before, [pasted('Alpha', 9)], true)
    const alpha = reduce(before, { type: 'batch', actions: result.actions }).teams[0]
    expect(alpha?.size).toBe(9)
    expect(alpha?.domainId).toBe('claims')
    expect(alpha?.days).toEqual(['tue', 'thu'])
  })

  it('does nothing for a team that already is as pasted', () => {
    const result = planPaste(plan(), [pasted('Alpha', 8, ['tue', 'thu'], 'Claims')], true)
    expect(result.rows.map((planned) => planned.effect)).toEqual(['same'])
    expect(result.actions).toEqual([])
    expect(pasteSummary(result, 'present')).toBeNull()
  })

  it('leaves existing teams alone when updating is off', () => {
    const result = planPaste(plan(), [pasted('Alpha', 10), pasted('Gamma', 3, [], '', '', 2)], false)
    expect(result.rows.map((planned) => planned.effect)).toEqual(['kept', 'add'])
    expect(result.actions).toHaveLength(1)
    expect(result.updated).toBe(0)
  })

  it('says what it does and what it did', () => {
    expect(pasteSummary({ added: 6, updated: 2 }, 'present')).toBe('Add 6 teams and update 2')
    expect(pasteSummary({ added: 6, updated: 2 }, 'past')).toBe('Added 6 teams and updated 2')
    expect(pasteSummary({ added: 1, updated: 0 }, 'present')).toBe('Add 1 team')
    expect(pasteSummary({ added: 0, updated: 1 }, 'past')).toBe('Updated 1 team')
    expect(pasteSummary({ added: 0, updated: 0 }, 'present')).toBeNull()
  })
})

describe('domains and ARTs', () => {
  beforeEach(() => {
    addExampleTeams()
  })

  it('lists them with their teams, and adds, renames, moves and removes them with undo', async () => {
    const user = renderView()
    await user.click(screen.getByRole('button', { name: 'Domains and ARTs' }))
    const dialog = screen.getByRole('dialog', { name: 'Domains and ARTs' })

    const nonLife = within(dialog).getByRole('region', { name: 'Domain Non-Life' })
    expect(within(nonLife).getByText('4 teams')).toBeTruthy()
    expect(within(dialog).getByRole('region', { name: 'Domain Corporate' }).textContent).toContain('2 teams')

    await user.click(within(dialog).getByRole('button', { name: 'Add domain' }))
    const added = getProject().domains.at(-1)!
    expect(added.name).toBe('New domain')
    const name = within(dialog).getByLabelText<HTMLInputElement>('Name of the domain New domain')
    await user.clear(name)
    await user.type(name, 'Life')
    expect(getProject().domains.at(-1)?.name).toBe('Life')

    await user.click(within(dialog).getByRole('button', { name: 'Add ART to Life' }))
    const art = getProject().arts.at(-1)!
    expect(art).toMatchObject({ name: 'New ART', domainId: added.id })

    // Moving the Claims ART moves its teams along.
    const claimsArt = getProject().arts.find((a) => a.name === 'Claims ART')!
    await user.selectOptions(within(dialog).getByLabelText('Domain of the ART Claims ART'), 'Life')
    expect(teamNamed('Claims Intake')).toMatchObject({ domainId: added.id, artId: claimsArt.id })

    await user.click(within(dialog).getByRole('button', { name: 'Remove the domain Life' }))
    expect(getProject().domains.some((d) => d.id === added.id)).toBe(false)
    expect(teamNamed('Claims Intake')).toMatchObject({ domainId: null, artId: claimsArt.id })
    expect(violations(getProject())).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(teamNamed('Claims Intake')).toMatchObject({ domainId: added.id, artId: claimsArt.id })
  })

  it('opens from a team row', async () => {
    const user = renderView()
    await user.selectOptions(screen.getByLabelText('ART of Architecture'), 'Edit domains and ARTs…')
    expect(screen.getByRole('dialog', { name: 'Domains and ARTs' })).toBeTruthy()
    // Choosing the option changes nothing about the team.
    expect(teamNamed('Architecture')).toMatchObject({ domainId: null, artId: null })
  })

  it('offers a team in a domain the ARTs of that domain, and a team in none every ART', () => {
    renderView()
    const options = (label: string) =>
      within(screen.getByLabelText(label))
        .getAllByRole('option')
        .map((option) => option.textContent)
    expect(options('ART of Claims Intake')).toEqual(['–', 'Claims ART', 'Policy ART', 'Edit domains and ARTs…'])
    expect(options('ART of Finance Operations')).toEqual(['–', 'Edit domains and ARTs…'])
    expect(options('ART of Architecture')).toEqual(['–', 'Claims ART', 'Policy ART', 'Digital Channels', 'Edit domains and ARTs…'])
  })
})
