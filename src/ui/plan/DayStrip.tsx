import { useRef } from 'react'
import type { Issue } from '../../domain/conflicts'
import { dayLoad, type DayLoad } from '../../domain/model'
import { WEEKDAYS, WEEKDAY_NAME, WEEKDAY_SHORT, type Id, type Project, type Weekday } from '../../domain/types'
import { setUi } from '../../state/ui'
import { plural } from '../format'
import { IconError, IconWarning } from '../icons'
import { Meter } from '../primitives'

/** How the seats needed on a day compare with the building, in a few words. */
function dayStatusText(load: DayLoad): string {
  switch (load.level) {
    case 'fits':
      return `${load.plannableDesks - load.needed} free`
    case 'reserve':
      return 'eats into the reserve'
    case 'overflow':
      return 'needs overflow seats'
    case 'over':
      return `${load.needed - load.capacity.desks - load.capacity.overflow} short`
  }
}

/** The day fits, but not the way it should: it eats into the reserve or needs overflow
 *  seats. A warning, where a day that cannot fit at all is a conflict. */
function isWarning(load: DayLoad): boolean {
  return load.level === 'reserve' || load.level === 'overflow'
}

function DayStatus({ load }: { load: DayLoad }) {
  const text = dayStatusText(load)
  if (isWarning(load)) {
    return (
      <span className="plan-day__status plan-day__status--warning">
        <IconWarning className="plan-icon" />
        {text}
      </span>
    )
  }
  if (load.level === 'over') {
    return (
      <span className="plan-day__status plan-day__status--over">
        <IconError className="plan-icon" />
        {text}
      </span>
    )
  }
  return <span className="plan-day__status muted">{text}</span>
}

/** What a day's badges count: its conflicts, and the teams that still need seats. */
function dayCounts(issues: readonly Issue[], day: Weekday): { conflicts: number; teamsToSeat: number } {
  let conflicts = 0
  const teams = new Set<Id>()
  for (const issue of issues) {
    if (issue.day !== day) continue
    if (issue.severity === 'error') conflicts += 1
    else if (issue.severity === 'todo') for (const id of issue.teamIds) teams.add(id)
  }
  return { conflicts, teamsToSeat: teams.size }
}

/** The week as five buttons: pick the day to plan and see at a glance how full each is. */
export function DayStrip(props: { project: Project; issues: readonly Issue[]; day: Weekday }) {
  const { project, issues } = props
  const buttons = useRef(new Map<Weekday, HTMLButtonElement>())

  /** Arrow keys: show the day next door and take the focus along, so the arrows keep working. */
  const showNeighbour = (day: Weekday | undefined) => {
    if (!day) return
    setUi({ day })
    buttons.current.get(day)?.focus()
  }

  return (
    <div className="plan-days" role="group" aria-label="Day">
      {WEEKDAYS.map((day, index) => {
        const load = dayLoad(project, day)
        const { conflicts, teamsToSeat } = dayCounts(issues, day)
        const label = [
          `${WEEKDAY_NAME[day]}: ${plural(load.needed, 'seat')} needed`,
          plural(load.plannableDesks, 'desk'),
          dayStatusText(load),
          conflicts > 0 ? plural(conflicts, 'conflict') : null,
          teamsToSeat > 0 ? `${plural(teamsToSeat, 'team')} to seat` : null,
        ]
          .filter(Boolean)
          .join(', ')
        return (
          <button
            key={day}
            ref={(el) => {
              if (el) buttons.current.set(day, el)
              else buttons.current.delete(day)
            }}
            type="button"
            className="plan-day"
            aria-pressed={day === props.day}
            aria-label={label}
            onClick={() => setUi({ day })}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              showNeighbour(WEEKDAYS[e.key === 'ArrowLeft' ? index - 1 : index + 1])
            }}
          >
            {/* Both names are rendered; plan.css shows the short one in narrow windows. */}
            <span className="plan-day__name plan-day__name--full">{WEEKDAY_NAME[day]}</span>
            <span className="plan-day__name plan-day__name--short">{WEEKDAY_SHORT[day]}</span>
            <span className="plan-day__load">
              <span className="plan-day__needed sign">{load.needed}</span>
              <span className="plan-day__of muted">of {plural(load.plannableDesks, 'desk')}</span>
            </span>
            {/* The meter hatches once more seats are needed than may be planned. Only a day
                that cannot fit at all is a conflict; until then plan.css makes the hatching
                the amber of a warning. */}
            <span className={isWarning(load) ? 'plan-day__meter plan-day__meter--warning' : 'plan-day__meter'}>
              <Meter value={load.needed} max={load.plannableDesks} />
            </span>
            <DayStatus load={load} />
            {/* Always there, also empty: its line is kept free so the plan below does not jump
                when the first badge of the week appears or the last one goes. */}
            <span className="plan-day__badges">
              {conflicts > 0 ? <span className="badge badge--error">{plural(conflicts, 'conflict')}</span> : null}
              {teamsToSeat > 0 ? <span className="badge badge--quiet">{teamsToSeat} to seat</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
