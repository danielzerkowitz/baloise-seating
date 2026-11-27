import { useEffect, useMemo, useRef, useState } from 'react'
import { suggestDayMoves } from '../../domain/dayMoves'
import { dayLoad, findTeam, type DayLoad } from '../../domain/model'
import { WEEKDAYS, WEEKDAY_NAME, WEEKDAY_SHORT, type Project, type Weekday } from '../../domain/types'
import { plural } from '../format'
import { Meter, SeverityIcon } from '../primitives'
import { moveTeamDay, teamLabel } from './teamActions'

/* The second row of the table's header: how full each weekday gets, before a single seat is
   placed, and which team could move when a day is too full. */

/** How the day compares with the building, in a few words, and for a day that does not
 *  simply fit a sentence with the numbers behind those words. */
function describeLevel(load: DayLoad): { words: string; numbers?: string } {
  const { needed, plannableDesks, capacity } = load
  const seats = `${plural(needed, 'seat')} needed`
  const desks = plural(capacity.desks, 'desk')
  switch (load.level) {
    case 'fits':
      return { words: `${plannableDesks - needed} free` }
    case 'reserve': {
      const toPlan = plural(plannableDesks, 'desk')
      return {
        words: 'eats into the reserve',
        numbers: `${seats}. ${toPlan} to plan with, ${capacity.desks - plannableDesks} kept free.`,
      }
    }
    case 'overflow':
      return {
        words: 'needs overflow seats',
        numbers: `${seats}, ${needed - capacity.desks} more than the ${desks} in the building.`,
      }
    case 'over': {
      const overflow = plural(capacity.overflow, 'overflow seat')
      return {
        words: `${needed - capacity.desks - capacity.overflow} short`,
        numbers: `${seats}. The building has ${desks} and ${overflow}.`,
      }
    }
  }
}

function LoadLevel({ load }: { load: DayLoad }) {
  const { words, numbers } = describeLevel(load)
  if (load.level === 'fits') return <p className="tiny muted teams-load__level">{words}</p>
  return (
    <p className="tiny teams-load__level" title={numbers}>
      <SeverityIcon severity={load.level === 'over' ? 'error' : 'warning'} withTitle />
      <span>{words}</span>
    </p>
  )
}

function DayLoadCell({ project, day }: { project: Project; day: Weekday }) {
  const load = dayLoad(project, day)
  const dayName = WEEKDAY_NAME[day]
  const desks = plural(load.plannableDesks, 'desk')
  const cellRef = useRef<HTMLTableCellElement>(null)
  // True from the click on a suggestion until the focus has found its new place.
  const [justMoved, setJustMoved] = useState(false)
  const moves = useMemo(
    () => (load.level === 'fits' ? [] : suggestDayMoves(project, day, 3)),
    [project, day, load.level],
  )

  // The button that was pressed is gone after the move. The focus goes to the next
  // suggestion for this day or, when there is none any more, to the cell itself: it stays
  // where the planner was working, and a screen reader reads how the day stands now.
  useEffect(() => {
    if (!justMoved) return
    const cell = cellRef.current
    const next = cell?.querySelector<HTMLElement>('[data-move]') ?? cell
    next?.focus()
    setJustMoved(false)
  }, [justMoved])

  return (
    <td ref={cellRef} className="teams-load" tabIndex={-1}>
      <div>
        <span className="sign teams-load__needed">{load.needed}</span>{' '}
        <span className="tiny muted">of {load.plannableDesks}</span>
      </div>
      <div className="teams-load__meter">
        <Meter
          value={load.needed}
          max={load.plannableDesks}
          tone={load.level === 'over' ? 'conflict' : 'warning'}
          label={`${dayName}: ${plural(load.needed, 'seat')} needed, ${desks} to plan with`}
        />
      </div>
      <LoadLevel load={load} />
      {moves.length > 0 ? (
        <ul className="teams-load__moves" aria-label={`Ways to relieve ${dayName}`}>
          {moves.map((move) => {
            const team = findTeam(project, move.teamId)
            if (!team) return null
            return (
              <li key={`${move.teamId}-${move.to}`}>
                <button
                  type="button"
                  className="btn btn--sm teams-move"
                  title={move.reason}
                  data-move=""
                  onClick={() => {
                    moveTeamDay(team, move.from, move.to)
                    setJustMoved(true)
                  }}
                >
                  <span className="teams-move__label">
                    Move {teamLabel(team)} to {WEEKDAY_SHORT[move.to]}
                    {move.agreed ? '' : ', ask first'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </td>
  )
}

export function DayLoadHeader(props: {
  project: Project
  /** The number of columns before Monday and after Friday. */
  leadingColumns: number
  trailingColumns: number
}) {
  return (
    <tr>
      <th scope="row" colSpan={props.leadingColumns} className="teams-load-label">
        Seats needed
      </th>
      {WEEKDAYS.map((day) => (
        <DayLoadCell key={day} project={props.project} day={day} />
      ))}
      <td colSpan={props.trailingColumns} className="teams-load-rest" />
    </tr>
  )
}
