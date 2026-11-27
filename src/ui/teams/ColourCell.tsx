import { useRef, useState } from 'react'
import type { Team } from '../../domain/types'
import { dispatch } from '../../state/store'
import { ColorPicker, Swatch } from '../primitives'
import { Popover } from './Popover'
import { teamLabel } from './teamActions'

/** The team's colour as a button that opens the colour picker. */
export function ColourCell({ team }: { team: Team }) {
  const [open, setOpen] = useState(false)
  // The colour the team had when typing in the hex field began, for as long as the typing
  // lasts. The picker rewrites that field whenever the colour it is given changes, which
  // would turn a half-typed "#abc" into "#aabbcc" under the cursor. So while a value is
  // being typed, the picker keeps seeing the colour from before.
  const [typingFrom, setTypingFrom] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const label = `Colour of ${teamLabel(team)}`

  const close = (refocus: boolean) => {
    setOpen(false)
    setTypingFrom(null)
    if (refocus) buttonRef.current?.focus()
  }

  const choose = (color: string) => {
    dispatch({ type: 'team/update', id: team.id, patch: { color } }, { coalesce: `team-color-${team.id}` })
    // A swatch is a choice and closes the picker. A typed value may not be finished.
    if (typingFrom === null) close(true)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="teams-swatch"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Swatch color={team.color} large />
      </button>
      {open ? (
        <Popover
          anchorRef={buttonRef}
          label={label}
          onClose={close}
          initialFocus={(popover) => popover.querySelector<HTMLElement>('[aria-pressed="true"]')}
        >
          <div
            onFocus={(event) => {
              if (event.target instanceof HTMLInputElement) setTypingFrom(team.color)
            }}
            onBlur={(event) => {
              if (event.target instanceof HTMLInputElement) setTypingFrom(null)
            }}
          >
            <ColorPicker value={typingFrom ?? team.color} onChange={choose} />
          </div>
        </Popover>
      ) : null}
    </>
  )
}
