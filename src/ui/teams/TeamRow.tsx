import { useEffect, useRef, useState } from 'react'
import { artsOf, describeSeating, hasDayException } from '../../domain/model'
import type { TeamPatch } from '../../domain/reducer'
import { WEEKDAYS, type Id, type Project, type Team } from '../../domain/types'
import { dispatch } from '../../state/store'
import { setUi } from '../../state/ui'
import { daysShort } from '../format'
import { IconDots, IconFile } from '../icons'
import { ColourCell } from './ColourCell'
import { DayCell } from './DayCell'
import { MAX_NAME_LENGTH, MAX_TEAM_SIZE } from './limits'
import { NumberInput } from './NumberInput'
import { PopoverMenu, type PopoverMenuItem } from './Popover'
import { SeatsCell } from './SeatsCell'
import { duplicateTeam, removeTeam, seatOnPlan, teamLabel } from './teamActions'

/** The value of the option that opens the dialog for editing domains and ARTs; never an id. */
const EDIT_ORG = '#edit'
const NONE = '–'

/** The ARTs a team can be put on. A team in a domain picks one of that domain's ARTs (to
 *  change domain, it changes the domain first). A team in no domain can pick any ART, and
 *  so joins the ART's domain: the ARTs are listed under their domains. */
function artChoices(project: Project, domainId: Id | null) {
  const option = (art: { id: Id; name: string }) => (
    <option key={art.id} value={art.id}>
      {art.name.trim() || 'Unnamed ART'}
    </option>
  )
  if (domainId !== null) return artsOf(project, domainId).map(option)
  const loose = artsOf(project, null)
  return (
    <>
      {loose.map(option)}
      {project.domains.map((domain) => {
        const arts = artsOf(project, domain.id)
        return arts.length > 0 ? (
          <optgroup key={domain.id} label={domain.name.trim() || 'Unnamed domain'}>
            {arts.map(option)}
          </optgroup>
        ) : null
      })}
    </>
  )
}

/** One team: who it is, how many seats it needs, its week, and where it sits. */
export function TeamRow(props: {
  project: Project
  team: Team
  /** Opens the dialog for editing the domains and ARTs. */
  onEditOrg: () => void
  /** Put the focus in the name field (the team was just added). */
  focusName: boolean
  /** Show the column for the preferred floor. */
  withFloor: boolean
  onOpenNotes: (teamId: Id) => void
  /** Called right before this row removes the only team that is left. */
  onRemoveLast: () => void
}) {
  const { project, team, focusName } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const name = teamLabel(team)

  useEffect(() => {
    if (!focusName) return
    nameRef.current?.focus()
    nameRef.current?.select()
    setUi({ focusTeamId: null })
  }, [focusName])

  /** Typing arrives letter by letter; one field's letters undo as one step. */
  const update = (patch: TeamPatch, field: string) =>
    dispatch({ type: 'team/update', id: team.id, patch }, { coalesce: `team-${field}-${team.id}` })

  // "Where" describes the normal seating: that of the first team day without a seating of
  // its own (or, when every day has its own, simply that of the first day). The days on
  // which the team sits somewhere else are named next to it.
  const shownDay = team.days.find((day) => !hasDayException(team, day)) ?? team.days[0]
  const otherDays = WEEKDAYS.filter((day) => day !== shownDay && hasDayException(team, day))
  const where = shownDay ? describeSeating(project, team, shownDay) : ''
  const openOnPlan = () => seatOnPlan(project, team, shownDay)

  const remove = () => {
    // This row is about to go. The focus moves on to the row below it: the next team, or
    // the row for adding a team, which is always there.
    rowRef.current?.nextElementSibling?.querySelector<HTMLElement>('[data-row-focus]')?.focus()
    if (project.teams.length === 1) props.onRemoveLast()
    removeTeam(team)
  }

  const menuItems: PopoverMenuItem[] = [
    { key: 'seat', label: 'Seat on the plan', onSelect: openOnPlan },
    { key: 'duplicate', label: 'Duplicate', onSelect: () => duplicateTeam(team) },
    { key: 'notes', label: 'Notes', onSelect: () => props.onOpenNotes(team.id) },
    { key: 'remove', label: 'Remove team', danger: true, separated: true, onSelect: remove },
  ]

  return (
    <tr ref={rowRef}>
      <td className="teams-td">
        <ColourCell team={team} />
      </td>
      <td className="teams-td">
        <div className="teams-name">
          <input
            ref={nameRef}
            className="input teams-quiet teams-name__input"
            aria-label="Team name"
            placeholder="Team name"
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            spellCheck={false}
            value={team.name}
            onChange={(event) => update({ name: event.target.value }, 'name')}
          />
          {team.notes.trim() === '' ? null : (
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label={`Notes for ${name}`}
              title={team.notes}
              onClick={(event) => {
                // Not every browser gives a clicked button the focus, and the dialog hands
                // the focus back to wherever it was.
                event.currentTarget.focus()
                props.onOpenNotes(team.id)
              }}
            >
              <IconFile />
            </button>
          )}
        </div>
      </td>
      <td className="teams-td">
        <input
          className="input teams-quiet"
          aria-label={`Code of ${name}`}
          maxLength={4}
          autoComplete="off"
          spellCheck={false}
          value={team.code}
          onChange={(event) => update({ code: event.target.value }, 'code')}
        />
      </td>
      <td className="teams-td">
        <select
          className="select teams-quiet"
          aria-label={`Domain of ${name}`}
          value={team.domainId ?? ''}
          onChange={(event) => {
            if (event.target.value === EDIT_ORG) props.onEditOrg()
            else update({ domainId: event.target.value || null }, 'domain')
          }}
        >
          <option value="">{NONE}</option>
          {project.domains.map((domain) => (
            <option key={domain.id} value={domain.id}>
              {domain.name.trim() || 'Unnamed domain'}
            </option>
          ))}
          <option value={EDIT_ORG}>Edit domains and ARTs…</option>
        </select>
      </td>
      <td className="teams-td">
        <select
          className="select teams-quiet"
          aria-label={`ART of ${name}`}
          value={team.artId ?? ''}
          onChange={(event) => {
            if (event.target.value === EDIT_ORG) props.onEditOrg()
            else update({ artId: event.target.value || null }, 'art')
          }}
        >
          <option value="">{NONE}</option>
          {artChoices(project, team.domainId)}
          <option value={EDIT_ORG}>Edit domains and ARTs…</option>
        </select>
      </td>
      <td className="teams-td">
        <NumberInput
          className="input input--num teams-quiet"
          aria-label={`People in ${name}`}
          min={0}
          max={MAX_TEAM_SIZE}
          value={team.size}
          onChange={(size) => update({ size }, 'size')}
        />
      </td>
      <td className="teams-td">
        <SeatsCell project={project} team={team} />
      </td>
      {WEEKDAYS.map((day) => (
        <DayCell key={day} project={project} team={team} day={day} />
      ))}
      {props.withFloor ? (
        <td className="teams-td">
          <select
            className="select teams-quiet"
            aria-label={`Preferred floor of ${name}`}
            value={team.homeFloorId ?? ''}
            onChange={(event) =>
              dispatch({ type: 'team/update', id: team.id, patch: { homeFloorId: event.target.value || null } })
            }
          >
            <option value="">No preference</option>
            {project.floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name}
              </option>
            ))}
          </select>
        </td>
      ) : null}
      <td className="teams-td teams-td--where">
        <div className="teams-where">
          {shownDay ? (
            <button type="button" className="link teams-where__link" onClick={openOnPlan}>
              {where === '' ? <span className="muted">Not seated yet</span> : where}
            </button>
          ) : null}
          {otherDays.length > 0 ? (
            <span className="badge badge--quiet">differs on {daysShort(otherDays)}</span>
          ) : null}
        </div>
      </td>
      <td className="teams-td">
        <button
          ref={menuButtonRef}
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label={`More for ${name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-row-focus=""
          onClick={() => setMenuOpen((open) => !open)}
        >
          <IconDots />
        </button>
        {menuOpen ? (
          <PopoverMenu
            anchorRef={menuButtonRef}
            label={`More for ${name}`}
            align="end"
            items={menuItems}
            onClose={(refocus) => {
              setMenuOpen(false)
              if (refocus) menuButtonRef.current?.focus()
            }}
          />
        ) : null}
      </td>
    </tr>
  )
}
