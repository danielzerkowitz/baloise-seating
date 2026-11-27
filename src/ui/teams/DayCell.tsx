import { useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { teamStyle } from '../../domain/color'
import { teamDayStatus, type TeamDayStatus } from '../../domain/model'
import {
  DAY_WISH_NAME,
  WEEKDAYS,
  WEEKDAY_NAME,
  type DayWish,
  type Project,
  type Team,
  type Weekday,
} from '../../domain/types'
import { dispatch } from '../../state/store'
import { IconCheck, IconChevronDown, IconClose, IconDesk, IconWarning } from '../icons'
import { PopoverMenu, type PopoverMenuItem } from './Popover'
import { moveTeamDay, seatOnPlan, teamLabel } from './teamActions'

/* One team on one weekday. The cell shows two things at once: what the team said about the
   day, and whether the day is planned. A click switches the day on or off; the menu and the
   letter keys are for everything finer. */

const WISHES: readonly DayWish[] = ['want', 'can', 'none', 'cannot']

/** The key that records each answer, on a focused cell and in its menu. */
const WISH_KEY: Record<DayWish, string> = { want: 'W', can: 'C', none: 'N', cannot: 'X' }

const WISH_WORDS: Record<DayWish, string> = {
  want: 'wanted',
  can: 'could also come',
  none: 'not asked',
  cannot: 'cannot come',
}

function seatWords(status: TeamDayStatus): string {
  if (status.needed === 0) return 'no seats needed'
  if (status.seated === 0) return 'not seated yet'
  return `${status.seated} of ${status.needed} seats`
}

/** The whole state in words: "Claims Intake, Tuesday: planned team day, wanted, 7 of 9 seats". */
function describeDay(team: Team, day: Weekday, status: TeamDayStatus): string {
  const subject = `${teamLabel(team)}, ${WEEKDAY_NAME[day]}`
  const said = WISH_WORDS[team.wishes[day]]
  return status.planned
    ? `${subject}: planned team day, ${said}, ${seatWords(status)}`
    : `${subject}: not planned, ${said}`
}

/** How far the seating of a planned day is: done, partly, or not started. */
function SeatMark({ status }: { status: TeamDayStatus }) {
  if (status.state === 'unseated') return <IconDesk className="teams-day__icon" />
  if (status.state === 'short') {
    return (
      <span className="sign teams-day__count">
        {status.seated}/{status.needed}
      </span>
    )
  }
  return <IconCheck className="teams-day__icon" />
}

export function DayCell(props: { project: Project; team: Team; day: Weekday }) {
  const { project, team, day } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const cellRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const wish = team.wishes[day]
  const status = teamDayStatus(project, team, day)
  const planned = status.planned
  // Filled when planned, hatched when wanted but not planned, otherwise an empty slot.
  const look = planned ? ' teams-slot--planned' : wish === 'want' ? ' teams-slot--wanted' : ''
  const label = describeDay(team, day, status)

  const setWish = (said: DayWish) => dispatch({ type: 'team/setWish', id: team.id, day, wish: said })
  const setPlanned = (on: boolean) => dispatch({ type: 'team/setPlanned', id: team.id, day, planned: on })

  const toggle = () => {
    setMenuOpen(false)
    if (planned) {
      // Switching a wanted day off takes the wish back with it. A day that was planned
      // without being wanted only leaves the plan: what the team said stays.
      if (wish === 'want') setWish('none')
      else setPlanned(false)
    } else if (wish === 'want') setPlanned(true)
    else setWish('want')
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      setMenuOpen(true)
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const said = WISHES.find((w) => WISH_KEY[w].toLowerCase() === event.key.toLowerCase())
    if (said) {
      event.preventDefault()
      setWish(said)
    }
  }

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const items: PopoverMenuItem[] = [
    ...WISHES.map(
      (said): PopoverMenuItem => ({
        key: `wish-${said}`,
        label: DAY_WISH_NAME[said],
        current: said === wish,
        shortcut: WISH_KEY[said],
        onSelect: () => setWish(said),
      }),
    ),
    {
      key: 'plan',
      label: planned ? 'Take off the plan' : 'Plan this day',
      separated: true,
      onSelect: () => setPlanned(!planned),
    },
  ]
  if (planned) {
    for (const to of WEEKDAYS) {
      if (team.days.includes(to)) continue
      items.push({
        key: `move-${to}`,
        label: `Move this team day to ${WEEKDAY_NAME[to]}`,
        onSelect: () => moveTeamDay(team, day, to),
      })
    }
    items.push({
      key: 'show',
      label: 'Show on the plan',
      separated: true,
      onSelect: () => seatOnPlan(project, team, day),
    })
  }

  return (
    <td
      className="teams-td"
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      <div
        ref={cellRef}
        className={planned ? 'teams-day teams-day--planned' : 'teams-day'}
        style={teamStyle(team.color) as CSSProperties}
      >
        <button
          ref={buttonRef}
          type="button"
          className={`teams-slot${look} teams-day__btn`}
          aria-pressed={planned}
          aria-label={label}
          title={label}
          data-day-cell={day}
          onClick={toggle}
          onKeyDown={onKeyDown}
        >
          {planned ? (
            <>
              {wish === 'cannot' ? <IconWarning className="teams-day__icon" /> : null}
              <SeatMark status={status} />
            </>
          ) : wish === 'can' ? (
            <span className="teams-day__ring" />
          ) : wish === 'cannot' ? (
            <IconClose className="teams-day__icon" />
          ) : null}
        </button>
        {/* Not a tab stop: from the keyboard the menu opens on the cell itself (Shift+F10 or
            the menu key), and five more stops in every row would double the way through
            the table. */}
        <button
          type="button"
          tabIndex={-1}
          className="teams-day__more"
          aria-label={`More for ${teamLabel(team)} on ${WEEKDAY_NAME[day]}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <IconChevronDown className="teams-day__chevron" />
        </button>
      </div>
      {menuOpen ? (
        <PopoverMenu
          anchorRef={cellRef}
          label={`${teamLabel(team)} on ${WEEKDAY_NAME[day]}`}
          items={items}
          onClose={closeMenu}
        />
      ) : null}
    </td>
  )
}
