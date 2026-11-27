import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { WEEKDAYS, WEEKDAY_NAME, WEEKDAY_SHORT, type Id, type Project } from '../../domain/types'
import { useUi } from '../../state/ui'
import { DayLoadHeader } from './DayLoadHeader'
import { QuickAddRow } from './QuickAddRow'
import { TeamRow } from './TeamRow'

/** The columns before Monday: colour, team, code, domain, ART, people, seats. */
const LEADING_COLUMNS = 7

/** Arrow keys walk the grid of day cells: left and right along a team's week, up and down
 *  along a weekday. The day buttons of the row for adding a team are part of the grid. */
function moveBetweenDayCells(event: ReactKeyboardEvent<HTMLTableSectionElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const from = event.target
  // Keys pressed in a cell's menu also arrive here; only a day cell itself counts.
  if (!(from instanceof HTMLElement) || !from.matches('[data-day-cell]')) return
  const row = from.closest('tr')
  const at = WEEKDAYS.findIndex((day) => day === from.dataset.dayCell)
  if (!row || at < 0) return

  let to: HTMLElement | null = null
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const day = WEEKDAYS[event.key === 'ArrowLeft' ? at - 1 : at + 1]
    to = day ? row.querySelector<HTMLElement>(`[data-day-cell="${day}"]`) : null
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const next = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling
    to = next?.querySelector<HTMLElement>(`[data-day-cell="${WEEKDAYS[at]}"]`) ?? null
  } else {
    return
  }
  // Also at the edge of the grid, where there is nowhere to go: the page must not scroll
  // under a key that is used for moving between cells.
  event.preventDefault()
  to?.focus()
}

/** The matrix: one row per team, one column per weekday, the load of each day on top and a
 *  row for adding a team at the bottom. */
export function TeamsTable(props: {
  project: Project
  /** The name field of the row for adding a team. */
  quickAddNameRef: RefObject<HTMLInputElement | null>
  onOpenNotes: (teamId: Id) => void
  /** Called right before the only team that is left is removed from its row. */
  onRemoveLast: () => void
  onEditOrg: () => void
}) {
  const { project } = props
  const { focusTeamId } = useUi()

  // A preferred floor is only a question when there is more than one floor.
  const withFloor = project.floors.length > 1
  const trailingColumns = withFloor ? 3 : 2

  return (
    <div className="teams-scroll">
      <table
        className={withFloor ? 'table teams-table teams-table--floors' : 'table teams-table'}
        aria-label="Teams and their team days"
      >
        <colgroup>
          <col className="teams-col--color" />
          <col />
          <col className="teams-col--code" />
          <col className="teams-col--domain" />
          <col className="teams-col--art" />
          <col className="teams-col--people" />
          <col className="teams-col--seats" />
          {WEEKDAYS.map((day) => (
            <col key={day} className="teams-col--day" />
          ))}
          {withFloor ? <col className="teams-col--floor" /> : null}
          <col className="teams-col--where" />
          <col className="teams-col--menu" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="teams-th">
              <span className="visually-hidden">Colour</span>
            </th>
            <th scope="col" className="teams-th">
              Team
            </th>
            <th scope="col" className="teams-th">
              Code
            </th>
            <th scope="col" className="teams-th">
              Domain
            </th>
            <th scope="col" className="teams-th">
              ART
            </th>
            <th scope="col" className="teams-th num">
              People
            </th>
            <th scope="col" className="teams-th num">
              Seats
            </th>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col" className="teams-th teams-th--day">
                <span aria-hidden="true">{WEEKDAY_SHORT[day]}</span>
                <span className="visually-hidden">{WEEKDAY_NAME[day]}</span>
              </th>
            ))}
            {withFloor ? (
              <th scope="col" className="teams-th">
                Floor
              </th>
            ) : null}
            <th scope="col" className="teams-th">
              Where
            </th>
            <th scope="col" className="teams-th">
              <span className="visually-hidden">More</span>
            </th>
          </tr>
          <DayLoadHeader project={project} leadingColumns={LEADING_COLUMNS} trailingColumns={trailingColumns} />
        </thead>
        <tbody onKeyDown={moveBetweenDayCells}>
          {project.teams.map((team) => (
            <TeamRow
              key={team.id}
              project={project}
              team={team}
              onEditOrg={props.onEditOrg}
              focusName={team.id === focusTeamId}
              withFloor={withFloor}
              onOpenNotes={props.onOpenNotes}
              onRemoveLast={props.onRemoveLast}
            />
          ))}
          <QuickAddRow nameRef={props.quickAddNameRef} trailingColumns={trailingColumns} />
        </tbody>
      </table>
    </div>
  )
}
