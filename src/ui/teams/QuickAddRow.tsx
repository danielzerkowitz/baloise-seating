import { useId, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { makeTeam } from '../../domain/model'
import { WEEKDAYS, WEEKDAY_NAME, WEEKDAY_SHORT, type Weekday } from '../../domain/types'
import { dispatch, getProject } from '../../state/store'
import { IconPlus } from '../icons'
import { MAX_NAME_LENGTH, MAX_TEAM_SIZE } from './limits'

/** The last row of the table: type a name, a size and the days, press Enter, and the next
 *  team can be typed straight away. */
export function QuickAddRow(props: {
  /** The name field, so that "Add team" elsewhere in the view can put the focus in it. */
  nameRef: RefObject<HTMLInputElement | null>
  /** The number of columns after the weekdays. */
  trailingColumns: number
}) {
  const { nameRef } = props
  const [name, setName] = useState('')
  const [size, setSize] = useState('')
  const [days, setDays] = useState<Weekday[]>([])
  const [nameMissing, setNameMissing] = useState(false)
  const nameId = useId()
  const errorId = useId()

  const add = () => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setNameMissing(true)
      nameRef.current?.focus()
      return
    }
    // A team has at least one person unless the planner says otherwise.
    const people = size.trim() === '' ? 1 : Math.min(MAX_TEAM_SIZE, Number(size))
    const team = makeTeam(getProject(), { name: trimmed, size: people, days })
    dispatch({ type: 'team/add', team })
    setName('')
    setSize('')
    setDays([])
    setNameMissing(false)
    nameRef.current?.focus()
  }

  const addOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Not the Enter that picks a word while typing with an input method.
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) add()
  }

  const toggleDay = (day: Weekday) =>
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]))

  return (
    <tr>
      <td className="teams-td">
        {/* A label, so that a click on the plus lands in the name field. */}
        <label htmlFor={nameId} className="teams-add__plus">
          <IconPlus />
        </label>
      </td>
      <td className="teams-td">
        <input
          ref={nameRef}
          id={nameId}
          className="input"
          aria-label="Name of the new team"
          aria-invalid={nameMissing}
          aria-describedby={nameMissing ? errorId : undefined}
          placeholder="New team"
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          spellCheck={false}
          data-row-focus=""
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (event.target.value.trim() !== '') setNameMissing(false)
          }}
          onKeyDown={addOnEnter}
        />
        {nameMissing ? (
          <span className="field__error teams-add__error" id={errorId} role="alert">
            Give the team a name
          </span>
        ) : null}
      </td>
      {/* A new team gets its code from its name; the group can be filled in once it is there. */}
      <td className="teams-td" colSpan={2} />
      <td className="teams-td">
        <input
          className="input input--num"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_TEAM_SIZE}
          aria-label="People in the new team"
          placeholder="People"
          value={size}
          onChange={(event) => setSize(event.target.value)}
          onKeyDown={addOnEnter}
        />
      </td>
      <td className="teams-td" />
      {WEEKDAYS.map((day) => (
        <td key={day} className="teams-td">
          <button
            type="button"
            className="btn btn--sm teams-add__day"
            aria-pressed={days.includes(day)}
            aria-label={`${WEEKDAY_NAME[day]} for the new team`}
            data-day-cell={day}
            onClick={() => toggleDay(day)}
          >
            {WEEKDAY_SHORT[day]}
          </button>
        </td>
      ))}
      <td className="teams-td" colSpan={props.trailingColumns}>
        <button type="button" className="btn" onClick={add}>
          Add
        </button>
      </td>
    </tr>
  )
}
