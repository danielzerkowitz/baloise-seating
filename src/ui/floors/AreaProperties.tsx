import { useId } from 'react'
import { AREA_KIND_NAME, type Area, type AreaKind, type Project } from '../../domain/types'
import { dispatch } from '../../state/store'
import { daysShort } from '../format'
import { IconCopy, IconTrash } from '../icons'
import { Field, SeverityIcon, TeamChip } from '../primitives'
import { DraftInput } from './DraftInput'
import { duplicateArea, removeArea, teamsUsing } from './edits'
import type { RequestFocus } from './useFocusAfterRender'

const KINDS: readonly AreaKind[] = ['desks', 'overflow', 'no-seating']

const KIND_EXPLANATION: Record<AreaKind, string> = {
  desks: 'Regular workplaces. Teams are seated here.',
  overflow: 'Touchdown benches and open tables. Only used when desks run out.',
  'no-seating': 'Meeting rooms, lounges and pods. Teams are never placed here.',
}

const isCount = (text: string) => /^\d+$/.test(text)

/** The right-hand panel while an area is selected: its name, use and seats, who sits there,
 *  and the buttons to duplicate or remove it. Mount it with the area's id as `key`. */
export function AreaProperties(props: { project: Project; area: Area; focusTarget: RequestFocus }) {
  const { project, area, focusTarget } = props
  const useGroup = useId()
  const uses = teamsUsing(project, [area.id])

  return (
    <>
      <div className="panel__header">
        <h2 className="subtitle">Area</h2>
      </div>

      <div className="panel__body">
        <div className="stack stack--loose">
          <Field label="Name">
            {({ id }) => (
              <DraftInput
                id={id}
                className="input"
                value={area.name}
                onChange={(name) =>
                  dispatch(
                    { type: 'area/update', id: area.id, patch: { name } },
                    { coalesce: `area-name-${area.id}` },
                  )
                }
              />
            )}
          </Field>

          <fieldset className="floors-use">
            <legend className="field__label floors-use__legend">Use</legend>
            <div className="stack">
              {KINDS.map((kind) => (
                <label key={kind} className="floors-use__option">
                  <input
                    className="floors-use__radio"
                    type="radio"
                    name={useGroup}
                    checked={area.kind === kind}
                    aria-labelledby={`${useGroup}-${kind}`}
                    aria-describedby={`${useGroup}-${kind}-about`}
                    onChange={() => dispatch({ type: 'area/update', id: area.id, patch: { kind } })}
                  />
                  <span className="floors-use__text">
                    <span className="floors-use__name" id={`${useGroup}-${kind}`}>
                      {AREA_KIND_NAME[kind]}
                    </span>
                    <span className="field__hint" id={`${useGroup}-${kind}-about`}>
                      {KIND_EXPLANATION[kind]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field
            label="Seats"
            hint={area.kind === 'no-seating' ? 'Chairs in the room. Not counted as seats.' : undefined}
          >
            {({ id, describedBy }) => (
              <DraftInput
                id={id}
                className="input input--num"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                data-focus-target="seats"
                aria-describedby={describedBy}
                value={String(area.capacity)}
                accepts={isCount}
                onChange={(seats) =>
                  dispatch(
                    { type: 'area/update', id: area.id, patch: { capacity: Number(seats) } },
                    { coalesce: `area-seats-${area.id}` },
                  )
                }
              />
            )}
          </Field>

          {uses.length > 0 ? (
            <div>
              <h3 className="list-heading">Used by</h3>
              <ul className="floors-used">
                {uses.map(({ team, days }) => (
                  <li key={team.id} className="floors-used__item">
                    <TeamChip color={team.color}>{team.code}</TeamChip>
                    <span className="truncate">{team.name}</span>
                    <span className="floors-used__days muted small">{daysShort(days)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {area.kind === 'no-seating' && uses.length > 0 ? (
            <p className="note note--warning">
              <SeverityIcon severity="warning" />
              <span>Teams are still placed here. They show up as conflicts until you move them.</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="panel__footer">
        <div className="row row--wrap">
          <button
            type="button"
            className="btn"
            onClick={() => {
              // The copy is selected; with the focus on its box the arrow keys place it.
              if (duplicateArea(area.id)) focusTarget('selected-area')
            }}
          >
            <IconCopy />
            Duplicate
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              removeArea(area.id)
              // This panel, with the button that was pressed, closes.
              focusTarget('tool', 'if-lost')
            }}
          >
            <IconTrash />
            Remove area
          </button>
        </div>
      </div>
    </>
  )
}
